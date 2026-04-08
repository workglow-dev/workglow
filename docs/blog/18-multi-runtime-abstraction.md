<!--
@license
Copyright 2025 Steven Roussey <sroussey@gmail.com>
SPDX-License-Identifier: Apache-2.0
-->

# Multi-Runtime Platform Abstraction: One Codebase, Three Worlds

*How Workglow ships the same TypeScript to browsers, Node.js, and Bun -- without polyfills, without runtime detection, and without losing native performance.*

---

## The Runtime Problem

JavaScript promised us universality. Write once, run anywhere. The reality is messier.

You write a library that processes images. In the browser, you reach for `OffscreenCanvas` and `createImageBitmap`. In Node.js, you reach for Sharp. In both, you need compression -- but the browser has `CompressionStream` while Node.js has `zlib`. You need workers, but the browser has `Web Workers`, Node.js has `worker_threads`, and Bun has its own worker implementation with different constructor semantics.

The instinct is to reach for polyfills. Shim the differences away. Pretend everything is a browser, or pretend everything is Node.js, and paper over the gaps.

This approach fails in two predictable ways. First, polyfills add weight. A `CompressionStream` polyfill in Node.js is pointless overhead when `zlib` is right there, compiled in C++, ready to go. Second, polyfills erase capability. The browser's `ImageBitmap` can be transferred to a worker with zero-copy semantics. Sharp can decode formats the browser has never heard of. A polyfill reduces both to the lowest common denominator, and your library pays the performance tax on every platform.

Workglow takes a different approach. Instead of pretending the platforms are the same, it embraces the fact that they are different -- and pushes that difference to the edges.

## Three Entry Points, One Shared Core

Every package in Workglow follows the same structural pattern. At the root of each package's `src/` directory sit three files:

```
src/
  browser.ts
  node.ts
  bun.ts
  common.ts
```

The `common.ts` file is where the real work happens. It exports everything that is platform-independent -- and in a typical Workglow package, that is the vast majority of the code. Event emitters, dependency injection, the DAG execution engine, schema validation, task classes, storage interfaces -- none of this cares whether it is running in a browser tab or a Bun process.

The three entry-point files are thin. Here is the entire content of `packages/util/src/browser.ts`:

```typescript
export * from "./common";
export * from "./worker/Worker.browser";
```

That is it. Two lines of re-exports. `node.ts` and `bun.ts` look nearly identical, differing only in which platform-specific worker module they pull in. The common code flows through unchanged. The platform-specific code is a surgical addition at the entry point, not a conditional branch scattered through the codebase.

This pattern repeats across the monorepo. The `storage` package's browser entry adds `IndexedDbTabularStorage`, `IndexedDbKvStorage`, and `IndexedDbVectorStorage`. Its Node.js and Bun entries add `SqliteTabularStorage`, `PostgresTabularStorage`, and `FsFolderKvStorage`. The `task-graph` package's browser entry adds Chrome DevTools custom formatters for debugging task graphs. In each case, the shared `common.ts` carries 95% of the code, and the platform entry points contribute the 5% that genuinely differs.

## Conditional Exports: Let the Bundler Decide

The mechanism that ties these entry points to the right runtime is `package.json` conditional exports -- a feature of the Node.js module resolution algorithm that bundlers like Webpack, Vite, esbuild, and Bun all respect.

Here is a simplified view of `@workglow/util`'s export map:

```json
{
  "exports": {
    ".": {
      "react-native": {
        "types": "./dist/browser.d.ts",
        "import": "./dist/browser.js"
      },
      "browser": {
        "types": "./dist/browser.d.ts",
        "import": "./dist/browser.js"
      },
      "bun": {
        "types": "./dist/bun.d.ts",
        "import": "./dist/bun.js"
      },
      "types": "./dist/node.d.ts",
      "import": "./dist/node.js"
    }
  }
}
```

When a bundler targeting the browser resolves `import { WorkerManager } from "@workglow/util"`, it follows the `"browser"` condition and loads `dist/browser.js`. When Bun resolves the same import, it follows the `"bun"` condition and loads `dist/bun.js`. Node.js falls through to the default `"import"` condition and gets `dist/node.js`.

The consuming code never changes. There is no `if (typeof window !== 'undefined')`. No `process.browser` flag. No `navigator.userAgent` sniffing. The correct implementation is selected at build time by the module resolver, before a single line of application code runs.

This works for sub-path exports too. The `@workglow/util/media` import resolves to `media-browser.js` in browsers and `media-node.js` on the server. The `@workglow/util/compress` import follows the same branching. Even the `@workglow/util/worker` sub-path has three distinct entry points:

```json
{
  "./worker": {
    "browser": { "import": "./dist/worker-browser.js" },
    "bun":     { "import": "./dist/worker-bun.js" },
    "import":  "./dist/worker-node.js"
  }
}
```

The storage package pushes this further with sub-paths like `./sqlite` and `./postgres`, where even the database engine depends on the runtime -- `@sqlite.org/sqlite-wasm` in the browser, `better-sqlite3` on Node.js, and Bun's built-in SQLite on Bun.

## Platform-Specific Implementations: Same Contract, Native Code

The places where platforms genuinely diverge deserve a closer look, because the abstraction strategy is consistent across all of them.

### Compression: Streams vs. zlib

Both the browser and Node.js implementations export the same two functions: `compress` and `decompress`. Both accept the same arguments: an input (string or `Uint8Array`) and an algorithm (`"gzip"` or `"br"`). Both return the same types.

The browser implementation uses the Web Streams API:

```typescript
export async function compress(
  input: string | Uint8Array,
  algorithm: "gzip" | "br" = "gzip"
): Promise<Uint8Array> {
  const sourceBlob = new Blob([typeof input === "string" ? input : new Uint8Array(input)]);
  const compressedStream = sourceBlob
    .stream()
    .pipeThrough(new CompressionStream(algorithm as CompressionFormat));
  const compressedBuffer = await new Response(compressedStream).arrayBuffer();
  return new Uint8Array(compressedBuffer);
}
```

The Node.js implementation uses `zlib`:

```typescript
export async function compress(
  input: string | Uint8Array,
  algorithm: "gzip" | "br" = "gzip"
): Promise<Uint8Array> {
  const compressFn = algorithm === "br" ? zlib.brotliCompress : zlib.gzip;
  const compressAsync = promisify(compressFn);
  const sourceBuffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const result: Buffer = await compressAsyncTyped(sourceBuffer);
  return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
}
```

Both are async. Both return `Uint8Array`. But under the hood, the browser version is using streaming decompression designed for fetch responses, while the Node.js version is using the V8-integrated zlib bindings that operate on Buffers. Each is the natural, performant choice for its environment. A polyfill would force one pattern onto both, and both would be worse for it.

### Media: Canvas vs. the File System

Image handling is where the platform gap is widest. The browser has a rich multimedia API surface -- `ImageBitmap`, `OffscreenCanvas`, `VideoFrame`, `createImageBitmap` -- all designed for GPU-accelerated compositing in a visual environment. Node.js has none of these. It deals in byte buffers and file I/O.

Workglow defines a shared `ImageBinary` interface in the platform-independent `image.ts`:

```typescript
export interface ImageBinary {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  channels: ImageChannels;
}
```

Both the browser and Node.js modules export a `convertImageDataToUseableForm` function. The browser version handles `ImageBitmap`, `OffscreenCanvas`, `VideoFrame`, and `Blob`, converting between them as needed. The Node.js version handles `Blob`, `ImageBinary`, and `DataUri` -- the subset of formats that make sense without a GPU and a display.

The function signature is identical. The supported format list is a discriminated union (`ImageDataSupport`), so AI provider code can declare which formats it accepts, and the conversion layer routes to the right implementation automatically. An image segmentation task running on MediaPipe in the browser can request `ImageBitmap` and get zero-copy GPU textures. The same task running on a server through a different provider can request `ImageBinary` and get a raw pixel buffer.

### Workers: One Manager, Three Runtimes

Workers are the most structurally interesting case because the abstraction operates at two levels.

**Level one: the `WorkerManager`.** This is entirely platform-independent. It lives in `common.ts`, gets exported from all three entry points, and provides the API that the rest of the system uses -- `registerWorker`, `callWorkerFunction`, `callWorkerStreamFunction`, `callWorkerReactiveFunction`. It manages lifecycle (lazy initialization, ready handshakes with timeouts), routes messages by request ID, handles abort signals, and extracts transferable objects for zero-copy data transfer. None of this code changes between platforms.

**Level two: the platform-specific `Worker` and `WorkerServer`.** This is where the runtime differences live, and they are surprisingly contained.

The browser version is the simplest -- it just re-exports the global `Worker` and `self`:

```typescript
const Worker = globalThis.Worker;
const parentPort = self;
export { Worker, parentPort };
```

The Node.js version wraps `worker_threads` to match the browser Worker API:

```typescript
import { Worker as NodeWorker, isMainThread, parentPort } from "worker_threads";

class WorkerPolyfill extends NodeWorker {
  constructor(scriptUrl: string | NodeURL, options?: WorkerOptions) {
    const resolved = scriptUrl instanceof NodeURL
      ? scriptUrl.toString()
      : pathToFileURL(scriptUrl).toString();
    super(resolved, options);
  }

  addEventListener(event: "message" | "error", listener: (...args: any[]) => void) {
    if (event === "message") this.on("message", listener);
    if (event === "error") this.on("error", listener);
  }

  removeEventListener(event: "message" | "error", listener: (...args: any[]) => void) {
    if (event === "message") this.off("message", listener);
    if (event === "error") this.off("error", listener);
  }
}
```

This is not a polyfill in the traditional sense. It is a thin adapter -- 15 lines of code -- that gives Node.js `worker_threads` the `addEventListener`/`removeEventListener` interface the `WorkerManager` expects. The URL resolution is different (Node needs `file://` URLs). The event model is different (Node uses EventEmitter's `.on`/`.off`, browsers use `.addEventListener`). But the shape of the API converges, and the `WorkerManager` never has to know which runtime it is talking to.

The `WorkerServerBase` class, meanwhile, is fully platform-independent. It handles the message protocol -- routing calls to registered functions, managing `AbortController` lifecycles, extracting transferable objects from results, and sending progress/streaming/error responses. The platform-specific `WorkerServer` subclasses just wire up the message event listener, which amounts to about four lines of code each.

## The Build Strategy

Each entry point gets compiled separately with `bun build --target=X`:

```bash
bun build --target=browser --outdir ./dist ./src/browser.ts
bun build --target=node    --outdir ./dist ./src/node.ts
bun build --target=bun     --outdir ./dist ./src/bun.ts
```

These run in parallel via `concurrently`. The `--target` flag tells Bun's bundler which platform globals to assume exist, which polyfills to inject (if any), and how to handle Node.js built-in modules. The `--packages=external` flag ensures that dependencies are not inlined -- they remain as bare specifiers, resolved at runtime by the consuming bundler or runtime.

For packages like `@workglow/util` with multiple sub-path exports, the build matrix expands. The media sub-path needs browser and node builds. The compress sub-path needs browser and node builds. The worker sub-path needs all three. The schema and graph sub-paths are platform-independent, so they build once with `--target=browser` (the most conservative target). In total, `@workglow/util` runs ten parallel builds to produce its full output.

Types are built separately with `tsc` (or `tsgo` for speed), using composite and incremental compilation. This means the type declarations are always complete -- they reflect the full union of all platform-specific types -- while the runtime code is split precisely along platform boundaries.

## Why Not Just Polyfills?

It is worth explicitly addressing the polyfill alternative, because it is the first thing most library authors reach for.

**Bundle size.** A `CompressionStream` polyfill for Node.js pulls in a JavaScript reimplementation of gzip. Node.js already has gzip in native code via `zlib`. The polyfill adds kilobytes to do what zero kilobytes can do better. Multiply this across compression, crypto, image processing, and workers, and you are shipping a substantial amount of dead code to every platform.

**Performance.** The browser's `createImageBitmap` decodes images on a background thread and produces a GPU-transferable texture. A polyfill that decodes images in JavaScript on the main thread is not equivalent -- it is a regression. Node.js's `zlib` bindings call into the same C library that nginx uses. A JavaScript reimplementation will never match it. Polyfills approximate behavior; native APIs deliver it.

**Capability loss.** `OffscreenCanvas` can be transferred to a Web Worker, enabling off-main-thread rendering. There is no polyfill for this -- the capability is architectural, not behavioral. By targeting each platform natively, Workglow can use transferable objects, zero-copy buffer sharing, and GPU textures where they are available, without those capabilities bleeding into a lowest-common-denominator interface.

**Maintenance burden.** Polyfills are snapshot-in-time implementations of evolving standards. They fall out of sync. They have edge-case bugs in the long tail of the spec. They need updating when the standard changes. A native implementation needs none of this maintenance -- it is maintained by the platform vendors.

## 95% Shared, 5% Strategic

The ratio matters. In `@workglow/util`, the `common.ts` file re-exports twelve modules: dependency injection, event emitters, logging, telemetry, cryptography, error handling, utility functions, type utilities, credential management, and the platform-independent `WorkerManager`. The platform-specific entry points each add exactly one import: the appropriate `Worker` module.

Across the broader monorepo, the pattern holds. The `storage` package shares all its interfaces, base classes, caching logic, event systems, and in-memory implementations across platforms. Only the concrete backend bindings -- IndexedDB for browsers, SQLite/Postgres/filesystem for servers -- are platform-specific. The `task-graph` package shares its entire DAG engine, every task base class, the workflow builder, serialization, and schema utilities. Only the Chrome DevTools formatters are browser-specific.

This is not accidental. It is the result of a deliberate architectural decision: platform-specific code must not infect the module graph of platform-independent code. If a utility function needs `Buffer`, it goes in the node entry point. If a debug formatter needs `console.groupCollapsed` with CSS styling, it goes in the browser entry point. Everything else stays in common, where it is written once, tested once, and shipped to all three targets.

The worker system illustrates this most clearly. The `WorkerManager` class is 360 lines of platform-independent TypeScript that handles lazy initialization, function dispatch, streaming, reactive calls, abort signals, and transferable extraction. The three platform-specific `WorkerServer` subclasses total about twelve lines combined. The `WorkerServerBase` adds another 320 lines of platform-independent protocol handling. The ratio is not 95/5 -- it is closer to 99/1.

## The Payoff

When a Workglow user writes an AI pipeline, they write it once:

```typescript
import { Workflow } from "@workglow/task-graph";
import { TextGenerationTask } from "@workglow/ai";
```

These imports resolve to the correct platform builds automatically. The task graph runs with Web Workers in the browser, `worker_threads` in Node.js, and native workers in Bun. Images are processed with Canvas APIs or Sharp. Compression uses streams or zlib. Storage adapts from IndexedDB to SQLite to Postgres.

The application code never branches. The library code barely branches. The platform differences are resolved at build time by conditional exports and at the module boundary by three thin entry points. The rest -- the engine, the tasks, the storage interfaces, the schema system, the event system, the dependency injection framework -- is one codebase, tested once, running everywhere.

That is the promise JavaScript made. Conditional exports and a disciplined module architecture are how you actually deliver it.
