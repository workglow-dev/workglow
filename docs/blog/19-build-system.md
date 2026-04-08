<!--
@license Copyright 2025 Steven Roussey
SPDX-License-Identifier: Apache-2.0
-->

# Building Workglow: How We Tamed a Multi-Runtime Monorepo

When your library needs to run in Node.js, Bun, and the browser -- and it's
split across ten packages with a deep dependency graph -- the build system
stops being a chore and becomes architecture. This is the story of how
Workglow's build system holds it all together, and why we made the choices
we did.

## The Problem: 10 Packages, 3 Runtimes, 1 Repository

Workglow is a DAG pipeline engine for AI workflows. It ships as a monorepo
containing ten published packages:

```
util, storage               (foundation)
    |
job-queue                   (scheduling, rate-limiting)
    |
task-graph                  (core DAG pipeline engine)
    |
knowledge-base, tasks       (documents, chunks; utility tasks)
    |
ai                          (AI task base classes, model registry)
    |
ai-provider                 (concrete provider implementations)
    |
test                        (integration tests across all packages)
workglow                    (meta-package re-exporting everything)
```

Every one of those packages -- except `ai-provider` and the meta-package --
needs to produce three separate JavaScript bundles: one for browsers, one for
Node.js, and one for Bun. That is because runtime differences are real and
pervasive. Node.js and Bun have different native SQLite bindings. Browsers use
IndexedDB where servers use the filesystem. Compression, image handling, and
worker APIs all diverge across platforms.

A naive build would mean manually tracking dozens of build steps and hoping
you got the ordering right. Instead, we lean on three tools working in
concert: **Turborepo** for orchestration, **Bun** for blazing-fast JavaScript
bundling, and **tsgo** (the native TypeScript compiler) for type declarations.

## Turbo: The Conductor

Turborepo is the backbone. It does not compile a single line of code itself,
but it makes sure the right things happen in the right order, and it
remembers what it already did.

Our `turbo.json` defines a small set of tasks:

```json
{
  "tasks": {
    "build-clean": { "cache": false },
    "build-package": {
      "dependsOn": ["build-clean", "^build-package"],
      "outputs": ["dist/**/*.js", "dist/**/*.d.ts", "tsconfig.tsbuildinfo"]
    },
    "build-js": {
      "dependsOn": ["build-clean", "^build-js"],
      "outputs": ["dist/**/*.js", "dist/**/*.js.map"]
    },
    "build-types": {
      "dependsOn": ["build-clean", "^build-types"],
      "outputs": ["dist/**/*.d.ts", "dist/**/*.d.ts.map", "tsconfig.tsbuildinfo"]
    }
  }
}
```

The `^` prefix is the key insight. When `build-js` declares
`"dependsOn": ["^build-js"]`, that caret means "run this task in all of my
upstream dependencies first." Turbo reads the workspace dependency graph from
each package's `package.json`, and it topologically sorts the work. `util`
builds before `storage`. `storage` builds before `job-queue`. And so on, all
the way up the chain.

This means a developer never thinks about build ordering. You type
`bun run build` and Turbo figures it out. It parallelizes where it can: `util`
and `sqlite` have no interdependence, so they build simultaneously. Packages
that share a dependency tier fan out across available cores.

The root `package.json` exposes this through clean commands:

```bash
bun run build              # Full build: all packages + examples
bun run build:packages     # Just packages, skip examples
bun run build:js           # JavaScript only, no type declarations
bun run build:types        # Type declarations only
```

Notice the separation. You can rebuild just the JavaScript when you are
iterating on runtime behavior, or just the types when you are fixing an
interface. This is not just convenience -- it is a meaningful time saver when
you realize the two pipelines have very different performance characteristics.

## The Split: Bun Build for JS, tsgo for Types

Here is the central design decision of the whole build system: **JavaScript
compilation and type declaration generation are completely separate
pipelines.**

Each package's `build-package` script makes this explicit:

```json
"build-package": "bun run build-js && bun run build-types"
```

Or, in the case of `task-graph`, they run in parallel:

```json
"build-package": "concurrently -c 'auto' -n 'browser,node,bun,types'
  'bun run build-browser' 'bun run build-node' 'bun run build-bun' 'bun run build-types'"
```

**Why not just use `tsc` for everything?** Speed. Bun's bundler is
astonishingly fast for JavaScript output. It takes TypeScript source, strips
the types, resolves the module graph, and emits optimized JavaScript in a
fraction of the time `tsc` would need. For a monorepo this size, that
difference compounds.

**Why not just use Bun for everything?** Correctness. Bun's bundler does not
emit type declarations. You still need a proper type checker to produce
`.d.ts` files that downstream consumers (and your own IDE) can use. That is
where `tsgo` comes in.

The project uses `tsgo`, the native Go port of the TypeScript compiler from
the `@typescript/native-preview` package. It is dramatically faster than
standard `tsc` while producing identical declaration output. Every package's
`build-types` script follows the same pattern:

```json
"build-types": "rm -f tsconfig.tsbuildinfo && tsgo"
```

The `tsconfig.json` is configured with `emitDeclarationOnly: true` and
`composite: true` at the root level. This means `tsgo` never emits JavaScript
-- it just validates the types and produces `.d.ts` files. The `composite`
flag enables project references and incremental builds, while
`declarationMap: true` generates source maps so that "Go to Definition" in
your editor jumps to the original `.ts` source rather than the generated
declaration.

The result: you get the raw speed of Bun for the JavaScript that actually
ships to users, and the full rigor of the TypeScript compiler for the type
contracts that hold the monorepo together.

## Multi-Target Builds: One Source, Three Runtimes

The standard Workglow package has three entry points:

- `src/browser.ts` -- for browser environments
- `src/node.ts` -- for Node.js
- `src/bun.ts` -- for Bun

These all re-export from `src/common.ts` (shared, platform-agnostic code) and
add platform-specific implementations. For example, `storage` provides an
IndexedDB backend in its browser build and a `better-sqlite3` backend in its
Node build.

Each entry point gets its own `bun build` invocation with the appropriate
`--target` flag:

```bash
bun build --target=browser --sourcemap=external --packages=external --outdir ./dist ./src/browser.ts
bun build --target=node    --sourcemap=external --packages=external --outdir ./dist ./src/node.ts
bun build --target=bun     --sourcemap=external --packages=external --outdir ./dist ./src/bun.ts
```

The `--target` flag is doing real work here. It tells Bun how to resolve
platform-specific APIs, which globals to assume are available, and how to
handle module formats. The `--packages=external` flag is equally important: it
tells Bun to leave all `node_modules` imports as external references rather
than bundling them in. This keeps the output lean and lets the consumer's
bundler or runtime handle dependency resolution.

The builds run concurrently via `concurrently`, so all three targets compile
in parallel. On a modern machine, the JavaScript build for a typical package
completes in well under a second.

## Conditional Exports: The Runtime Router

The multi-target builds would be useless without a way for consumers to
automatically get the right one. That is the job of the `exports` field in
`package.json`:

```json
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
```

When Bun resolves `import { Task } from "@workglow/task-graph"`, it matches
the `"bun"` condition and loads `dist/bun.js`. A browser bundler like Vite
matches `"browser"` and loads `dist/browser.js`. Node.js falls through to the
default `"import"` and gets `dist/node.js`. React Native gets the browser
build, which makes sense since it shares the same limitations around native
modules.

Each condition also carries a `"types"` entry pointing to the matching `.d.ts`
file. This means TypeScript sees the correct type definitions for the platform
you are targeting -- important when platform-specific APIs differ in their
type signatures.

## Specialized Sub-Exports: When One Entry Point Is Not Enough

The `@workglow/util` package is the most complex in terms of build surface.
Beyond the standard browser/node/bun split, it exposes six sub-path exports:

| Sub-path | What it contains | Platform-specific? |
|---|---|---|
| `@workglow/util` | Core infra: DI, events, logging, crypto | Yes (browser/node/bun) |
| `@workglow/util/schema` | JSON Schema types, vector math | No |
| `@workglow/util/graph` | Graph data structures, DAG | No |
| `@workglow/util/worker` | Worker entry, DI + logging re-exports | Yes (browser/node/bun) |
| `@workglow/util/media` | Image handling | Yes (browser/node) |
| `@workglow/util/compress` | Compression | Yes (browser/node) |

Each of these is its own build target. The `build-js` script for `util` runs
eight concurrent build commands:

```json
"build-js": "concurrently -c 'auto' -n 'browser,node,bun,worker,schema,graph,media,compress'
  'bun run build-browser' 'bun run build-node' 'bun run build-bun'
  'bun run build-worker' 'bun run build-schema' 'bun run build-graph'
  'bun run build-media' 'bun run build-compress'"
```

And several of those (like `build-worker`, `build-media`, `build-compress`)
fan out into further parallel sub-builds for each platform target. The
`build-worker` command alone produces three files: `worker-browser.js`,
`worker-node.js`, and `worker-bun.js`.

The `@workglow/storage` package follows a similar pattern with sub-exports for
`./sqlite` and `./postgres`, each with its own per-platform builds. This
modular approach means consumers only pay for what they import. If you are
building a browser app and you only need in-memory storage, you never pull in
the SQLite or PostgreSQL code.

## The ai-provider Exception: Per-Provider Sub-Paths

The `@workglow/ai-provider` package breaks the browser/node/bun pattern
entirely. Instead of three runtime targets, it exposes sub-paths for each AI
provider:

```
./anthropic, ./gemini, ./openai, ./ollama,
./hf-transformers, ./hf-inference, ./llamacpp,
./tf-mediapipe, ./chrome
```

Each provider gets its own `index.ts` and `runtime.ts` entry point. The build
uses `--root ./src` to preserve the directory structure in the output:

```bash
bun build --sourcemap=external --packages=external --root ./src --outdir ./dist \
  ./src/provider-anthropic/index.ts ./src/provider-anthropic/runtime.ts \
  ./src/provider-openai/index.ts  ./src/provider-openai/runtime.ts \
  ...
```

Some providers (Ollama, OpenAI) additionally have browser-specific builds
because they can run client-side. TensorFlow MediaPipe is browser-only. This
per-provider architecture means your app's bundle never includes code for
providers you are not using -- and every provider SDK is an optional peer
dependency.

## Incremental Builds and Caching

Two layers of caching keep rebuilds fast.

**Turbo's remote-capable cache.** Every task in `turbo.json` declares its
`outputs`. When Turbo runs `build-js` for a package, it hashes the inputs
(source files, dependencies, environment) and stores the outputs. On the next
run, if nothing changed, Turbo skips the work entirely and restores from
cache. The root scripts use `--force` for clean builds, but incremental runs
during development skip unchanged packages automatically.

**TypeScript's incremental compilation.** The root `tsconfig.json` sets
`"incremental": true` and `"tsBuildInfoFile": "./tsconfig.tsbuildinfo"`. Each
package's `tsconfig.json` adds `"composite": true`. Together, these tell
`tsgo` to write a build info file that tracks which source files changed since
the last compilation. On subsequent runs, only the affected files get
re-checked and re-emitted. For a monorepo with thousands of source files, this
turns a multi-second type check into a sub-second one.

## Developer Experience: Watch Mode and Fast Iteration

During development, you do not want to run full builds. Workglow provides
two modes for fast feedback:

**Watch mode** (`bun run watch`) first does a complete `build-package --force`
to establish a clean baseline, then launches persistent watchers for every
package at a concurrency of 15:

```json
"watch": "turbo run build-package --force && turbo run watch --concurrency 15"
```

Inside each package, the watch script uses `bun build --watch` for JavaScript
and `tsc --watch --preserveWatchOutput` for types. Change a file, and within
milliseconds the affected outputs are regenerated. The
`--preserveWatchOutput` flag keeps the terminal readable by not clearing
previous output.

**Dev mode** (`bun run dev`) launches Turbo's dev task, configured as
persistent and uncached. This is useful for examples and apps that have their
own dev servers.

There is also a JS-only watch mode (`bun run watch:js`) for when you are
focused on runtime behavior and do not need type declarations updating
continuously. Since type checking is the slower half, skipping it during
hot iteration loops makes a noticeable difference.

## Why This Architecture Works

The Workglow build system is not clever for the sake of being clever. Each
decision solves a specific problem:

**Splitting JS and types** means you can iterate on runtime logic at Bun's
native speed without waiting for type checking, and you can fix type errors
without re-bundling JavaScript. The two concerns have different performance
profiles and different failure modes, so they deserve separate pipelines.

**Multi-target builds from a single source** eliminate the alternative, which
would be maintaining three copies of every package or using runtime feature
detection everywhere. The entry-point pattern (browser.ts, node.ts, bun.ts
all re-exporting from common.ts) keeps platform-specific code isolated and
the shared core clean.

**Conditional exports** make the multi-target builds transparent to consumers.
You import from `@workglow/storage` and the right code loads. No
configuration, no bundler plugins, no special flags.

**Turbo's dependency-aware orchestration** means nobody has to maintain a
build script that knows `util` builds before `storage` builds before
`job-queue`. The dependency graph is declared once in each package's
`package.json`, and Turbo derives the rest.

**tsgo for type emission** pushes the last remaining bottleneck -- TypeScript's
own compiler -- as far as it will go. By using the native-speed Go port of
`tsc`, type declaration builds that previously took several seconds now
complete in a fraction of that time.

The net result is a build system where a full clean build of ten packages
across three runtimes completes fast enough that you do not dread it, and
incremental rebuilds during development are near-instant. For a library that
aspires to run everywhere -- servers, browsers, edge workers, native apps --
that build infrastructure is not a luxury. It is what makes the whole thing
possible.
