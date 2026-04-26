# GPU image pipeline — design

- **Date:** 2026-04-25
- **Status:** Draft, awaiting user review
- **Scope:** `@workglow/util/media`, `@workglow/tasks` (image filters), `@workglow/task-graph` (cache + input resolution), `@workglow/ai` + `@workglow/ai-provider` (vision tasks), `builder/packages/app` (preview)

## Context

A 7-stage image filter chain (`Text → Flip → Sepia → Blur → Posterize → Border → Pixelate`) measured in `runPreview` mode currently takes ~5.2 seconds end-to-end. Per-stage `executePreview` runs at 500–1300 ms, against a documented target of `< 1 ms`. The gap is 70–185×.

Root cause:

- The wrapper `produceImageOutput` in `libs/packages/tasks/src/task/image/imageTaskIo.ts` re-encodes each task's output to a data URI when the input was a data URI. With 7 stages this is 7 full encode + decode cycles instead of the 1 cycle that's actually needed at I/O boundaries.
- The dataflow layer between tasks does **not** clone — handles pass by reference. The codec cycles exist purely because the wrapper preserves the wire format.
- All filters are CPU JS loops on the main thread. `OffscreenCanvas` is wired but only used main-thread. No Worker / WebGPU / WASM is in the image path.
- `ImagePreview` re-converts pixel-form input on every render and uses `<img src=dataUri>` for the data-URI form, both per-frame work.

The user's reach goal is webcam-style live preview: pull frames continuously and run the same chain through `runPreview` at decent rates.

## Goals

- **30 fps end-to-end** for the 7-stage chain at 720p in browser `runPreview`. Per-task `executePreview` ≤ 5 ms.
- Optimize all three runtimes (browser, node, bun). Browser uses WebGPU; node/bun uses sharp's pipeline.
- Direct GPU → canvas display in the browser preview path. No CPU readback in the hot loop.
- Single canonical inter-task image type. No dual format, no shims.
- AI/vision tasks remain functional and don't pay the codec cost twice.

## Non-goals

- Webcam capture itself. The pipeline becomes fast enough to support it; adding `WebcamCaptureTask` is separate work.
- Worker-based execution. WebGPU is async; we run on the main thread. Revisit only if perf testing reveals UI jank.
- WebGPU on node (via dawn or similar). Sharp covers node well enough for this round.
- Migrating non-image media (audio, video frames, tensors). Same patterns will apply but are separate decisions.
- Caching the encoded byte form alongside the materialized form. One materialized cache entry per output.
- A "preview at lower resolution" downscale mode. The preview path runs at full resolution; the GPU is fast enough to make scaling unnecessary.

## Approach — single landing

One coordinated change set across the affected packages. No coexistence of old and new image formats; the existing data-URI / `ImageBinary` schemas are pushed to I/O boundaries only and `GpuImage` becomes the canonical inter-task type. This matches the codebase's "no backward-compat shims when refactoring" norm.

## Architecture

### 1. The `GpuImage` abstraction

A single interface in `@workglow/util/media`, with three concrete backends picked at construction time:

```ts
interface GpuImage {
  readonly width: number;
  readonly height: number;
  readonly channels: 1 | 3 | 4;
  readonly backend: "webgpu" | "sharp" | "cpu";
  materialize(): Promise<ImageBinary>;
  toCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void>;
  encode(format: "png" | "jpeg" | "webp", quality?: number): Promise<Uint8Array>;
  release(): void;
}
```

Backends:

- `WebGpuImage` — owns a `GPUTexture` (`rgba8unorm`). `toCanvas` is a passthrough render-shader blit. `materialize` does `copyTextureToBuffer` + map.
- `SharpImage` — wraps a `sharp.Sharp` instance and the dimensions/channels needed without forcing materialization. `materialize` calls `.raw().toBuffer()`. `encode` uses `.png()` / `.jpeg()` / `.webp()`. `toCanvas` is unsupported and throws.
- `CpuImage` — wraps an `ImageBinary`. Used as the universal fallback (no WebGPU available, tiny test images, etc.). `toCanvas` uses `putImageData`.

Constructors: `GpuImage.fromDataUri`, `GpuImage.fromImageBinary`, `GpuImage.fromImageBitmap`, `GpuImage.fromBlob`. Each picks the best backend for the runtime.

Schema: a new `GpuImageSchema` in `@workglow/util/schema` (JSON Schema with `format: "image"`). The TaskRunner's existing schema-driven input resolution layer (the same hook that resolves models / repositories / knowledge bases) recognizes this format and hydrates the dataflow value to a `GpuImage` instance before the task sees it. Filter tasks always receive a hydrated `GpuImage`.

### 2. WebGPU runtime (browser)

Files live in `@workglow/util/media/` alongside the existing browser-only image code (e.g. `imageRasterCodecBrowser.ts`), exported only from `browser.ts`. No new subdirectory.

- `gpuDevice.browser.ts` — singleton `GpuDevice` with lazy `requestAdapter` + `requestDevice`. One device per page. If `requestAdapter` returns `null`, image construction falls back to `CpuImage` and the pipeline runs CPU-side. Listens for `device.lost` and invalidates the singleton.
- `texturePool.browser.ts` — `acquire(w, h, format)` / `release(t)`. Cap each size class at ~8 textures. Lifetime: page session. Bound is what limits VRAM; no per-preview cleanup.
- `webGpuImage.browser.ts` — implements `GpuImage`. `apply(shader, uniforms, outSize?)` returns a new `WebGpuImage` and synchronously releases the source texture back to the pool. Encodes one command per `apply`; the GPU pipelines the chain.
- `shaders/` — `.wgsl` files imported as text. One per filter (`passthrough`, `flip`, `sepia`, `blur`, `posterize`, `border`, `pixelate`, `textOverlay`). Compiled once, cached on the singleton.

Encoder lifecycle: a single `GPUCommandEncoder` per preview run, submitted at the end (just before the canvas blit) so the entire 7-stage chain is one driver round-trip.

Disposal:
- Synchronous `release(sourceTexture)` inside `apply` covers the in-flight chain.
- `FinalizationRegistry` registers each `WebGpuImage` to release the texture on JS-side GC, best-effort.
- The existing per-workflow-run dispose hook drains the pool and shader cache.
- No new per-preview disposal mechanism.

### 3. Sharp pipeline runtime (node/bun)

Files: `sharpImage.node.ts` (with `.bun.ts` re-export) in `@workglow/util/media/`. Sharp is already a transitive dependency.

`SharpImage.apply(op)` returns a new `SharpImage` whose pipeline is `op(this.pipeline.clone())`. `clone()` only forks the operation graph, not buffers. Operations stay deferred. Nothing renders until `materialize()` or `encode()`.

Filter mapping:

| Filter      | Sharp op |
|-------------|----------|
| Flip / flop | `.flip()` / `.flop()` |
| Sepia       | `.recomb([...3×3 matrix...])` |
| Blur        | `.blur(sigma)` |
| Posterize   | `.linear` + LUT chain; raw-buffer LUT fallback if needed |
| Border      | `.extend({top, bottom, left, right, background})` |
| Pixelate    | `.resize(w/N).resize(w, {kernel: 'nearest'})` |
| Text        | `.composite([{input: textPng}])`; text rendered once via a node text renderer + sharp |

Filters without a direct sharp op fall through to `.raw().toBuffer()` materialization, run the existing CPU loop, and re-wrap as a fresh `SharpImage`.

No pool needed; sharp manages its own buffers and is reclaimed by libuv-backed cleanup when the JS object is GC'd. No `FinalizationRegistry` required.

### 4. Filter task adaptation

A filter is a triple of backend-specific ops parameterized by `P`:

```ts
interface ImageOp<P> {
  webgpu(image: WebGpuImage, params: P): WebGpuImage;
  sharp (image: SharpImage,  params: P): SharpImage;
  cpu   (image: CpuImage,    params: P): CpuImage;
}

function applyOp<P>(image: GpuImage, op: ImageOp<P>, params: P): GpuImage {
  switch (image.backend) {
    case "webgpu": return op.webgpu(image as WebGpuImage, params);
    case "sharp":  return op.sharp (image as SharpImage,  params);
    case "cpu":    return op.cpu   (image as CpuImage,    params);
  }
}
```

Each filter lives in a colocated module, e.g. `tasks/src/task/image/blur/blurOp.ts` exports `blurOp: ImageOp<{ sigma: number }>` with all three backend implementations. Math is separated from task plumbing.

Base class for filter tasks:

```ts
abstract class ImageFilterTask<P, In = { image: GpuImage } & P>
  extends Task<In, { image: GpuImage }> {
  protected abstract readonly op: ImageOp<P>;
  protected abstract opParams(input: In): P;

  private runFilter(input: In) {
    return { image: applyOp(input.image, this.op, this.opParams(input)) };
  }
  async execute(input: In)        { return this.runFilter(input); }
  async executePreview(input: In) { return this.runFilter(input); }
}
```

`execute` and `executePreview` call the same internal helper, matching the canonical "shared helper called from both methods" pattern. The only difference between modes is what the runner does at edges (cache materialization on `execute`, none on `executePreview`). Filter authors don't think about modes.

Source tasks (`InputTask` for image schemas, `FetchUrlTask` returning images, etc.) construct a `GpuImage` directly via the appropriate backend. Sink tasks (`ImageOutputTask`) dispatch by destination: canvas → `toCanvas`; download / API → `encode`.

`produceImageOutput` is **deleted**. `imageTaskIo.ts` becomes the schema input resolver.

### 5. Display path

The OutputTask stays generic — passthrough only, no canvas, no blit, no encode. Display work happens in the React component.

```tsx
function ImagePreview({ value }: { value: unknown }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const image = useGpuImage(value);          // hydrates non-GpuImage shapes; cached by ref
  const { width, height } = image ?? {};

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    if (canvas.width  !== width)  canvas.width  = width!;
    if (canvas.height !== height) canvas.height = height!;
    image.toCanvas(canvas);
  }, [image, width, height]);

  return <canvas ref={canvasRef} />;
}
```

`useGpuImage` lives in `builder/packages/app/src/hooks/`. Pass-through if the value is already a `GpuImage`; otherwise wrap via `GpuImage.from*()`. Caches by reference identity.

`WebGpuImage.toCanvas` configures `canvas.getContext("webgpu")` once with the singleton device and preferred format, caches the configured context on the canvas via `WeakMap<HTMLCanvasElement, GPUCanvasContext>`, and renders a passthrough fragment shader over a fullscreen quad. Sub-millisecond at 720p.

`CpuImage.toCanvas` is the existing `putImageData` path, just relocated.

`SharpImage.toCanvas` throws — never reached in browser.

Removed:
- `asPixelShape` / `asImageData` helpers in `ImagePreview.tsx` — logic moves into `CpuImage.toCanvas`.
- The `<img src=dataUri>` branch.
- The `queueMicrotask` wrapping; React effect scheduling handles batching.

`ImagePreview` shrinks from ~150 lines to ~30.

Download / share / non-canvas display calls `image.encode("png" | "jpeg" | "webp")` to get bytes, wrapped in a `Blob` and `URL.createObjectURL`. On-demand only, never per-frame.

### 6. Cache materialization

Schema-annotation-driven serialization. The cache layer recognizes any output port whose schema has `format: "image"` and runs it through:

```ts
async function serializeImagePort(value: GpuImage): Promise<CachedImage> {
  const bin = await value.materialize();
  return { kind: "image-binary", width: bin.width, height: bin.height,
           channels: bin.channels, data: bin.data };
}

function deserializeImagePort(cached: CachedImage): GpuImage {
  return GpuImage.fromImageBinary(cached);  // CpuImage by default; uploads on first apply()
}
```

Cached form is raw bytes plus dims — the cheapest round-trip. We do not re-encode to PNG/JPEG for cache (that's exactly what we just removed from the hot path). Filter task code is untouched by caching; the hooks live entirely in the runner's pre-write / post-read paths.

### 7. AI / vision task interop

Vision tasks need either bytes (for an API POST) or pixels (for a local model). The `GpuImage` interface already exposes both. A vision task whose schema declares an image input receives a `GpuImage` from the input resolver and asks for whatever shape it needs at the call site:

```ts
// remote API:
const png = await input.image.encode("png");
const b64 = bytesToBase64(png);
// fetch ...

// local model:
const bin = await input.image.materialize();
const tensor = imageBinaryToTensor(bin);
```

No special schema hint like `x-resolve-to: ...`. The vision task knows what it wants and asks for it.

Workers: per CLAUDE.md, main-thread state is resolved in `AiTask.getJobInput()` (or analog) before the worker job is dispatched. Image inputs are materialized to `ImageBinary` or encoded byte buffers there. Workers see only bytes; `WebGpuImage` handles never cross the worker boundary. Workers do not import `@workglow/util/media`'s GPU code.

Existing AI vision tasks (Anthropic, OpenAI, Gemini, transformers.js classifier, image embedding) change from "branch on input shape" to "ask for the shape I need". Net code reduction.

`ChunkVectorUpsertTask` and similar storage tasks don't take image inputs directly; image-to-vector goes through `ImageEmbeddingTask`, covered by the AI path.

## Migration order

Done in one branch / one PR series, internally sequenced:

1. `@workglow/util/media` — add `GpuImage` interface + `CpuImage` + `WebGpuImage` + `SharpImage` + `GpuDevice` + `TexturePool` + shaders + constructors. Additive.
2. `@workglow/tasks` — add `ImageFilterTask` base + `ImageOp<P>` + per-filter op modules.
3. `@workglow/tasks` — rewrite the 7 image filter tasks. Delete old per-task filter code in the same commit. Delete `produceImageOutput`. Replace with schema-based input resolver.
4. `@workglow/task-graph` — add schema-driven cache hooks; update input resolver for `format: "image"`.
5. `@workglow/ai` + `@workglow/ai-provider` — update vision/embedding/classification tasks to receive `GpuImage` and call `.encode()` / `.materialize()` at call sites. Update worker job-input boundaries.
6. `builder/packages/app` — replace `ImagePreview`. Add `useGpuImage`. Remove old branching.
7. `@workglow/test` — port image task tests. Add chain-perf benchmark.

Each step compiles green before the next.

## Files added

```
libs/packages/util/src/media/
  gpuImage.ts                  # interface + factory functions (cross-platform)
  cpuImage.ts                  # all platforms
  webGpuImage.browser.ts
  sharpImage.node.ts
  gpuDevice.browser.ts
  texturePool.browser.ts
  shaders/
    passthrough.wgsl
    flip.wgsl
    sepia.wgsl
    blur.wgsl
    posterize.wgsl
    border.wgsl
    pixelate.wgsl
    textOverlay.wgsl

libs/packages/tasks/src/task/image/
  ImageFilterTask.ts
  imageOp.ts
  flip/      { flipOp.ts, ImageFlipTask.ts }
  sepia/     { sepiaOp.ts, ImageSepiaTask.ts }
  blur/      { blurOp.ts, ImageBlurTask.ts }
  posterize/ { posterizeOp.ts, ImagePosterizeTask.ts }
  border/    { borderOp.ts, ImageBorderTask.ts }
  pixelate/  { pixelateOp.ts, ImagePixelateTask.ts }
  text/      { textOp.ts, ImageTextTask.ts }

builder/packages/app/src/
  hooks/useGpuImage.ts
```

## Files removed

- `produceImageOutput` and any "preserve dataUri form" logic in `imageTaskIo.ts`. The file becomes the schema input resolver.
- The pixel-form / data-URI branching in `ImagePreview.tsx`. The component shrinks ~5×.
- Per-filter CPU-loop bodies in the existing `Image*Task` files — the implementations relocate as the `cpu` arm of each `ImageOp`, then the original task files are replaced by the new `ImageFilterTask` subclasses.
- `ImageJson` sentinels that bridge wire-format gaps (`unsynced` markers for `bitmap` / `videoFrame` / `offscreenCanvas`). Redundant once `GpuImage` is the canonical wire type.

## Testing

- **Per-filter unit tests** (vitest, `packages/test/src/test/`): for each filter, run the same input through all three backends and assert outputs match within ≤2/255 per channel. WebGPU tests gated on `describe.skipIf(!navigator.gpu)`. Sharp tests gated to node/bun.
- **Round-trip serialization tests**: `GpuImage` → cache serialize → cache deserialize → equality.
- **Chain integration tests**: 7-stage chain end-to-end on each backend; pixel-equivalence to a golden reference under `packages/test/src/fixtures/`.
- **Schema input resolver tests**: feed each input shape (data-URI, ImageBinary, ImageBitmap, Blob, GpuImage) into a task with `format: "image"` and assert hydration to the expected backend.
- **Vision task tests** (mock provider): receives `GpuImage`, calls `encode("png")`, posts bytes to mocked endpoint.

Per CLAUDE.md, the local loop runs scoped: `bun scripts/test.ts image vitest`.

## Performance validation

A new benchmark at `packages/test/src/perf/imageChainPerf.ts`. Same 7-stage chain (`Text → Flip → Sepia → Blur → Posterize → Border → Pixelate`) measured at 480p / 720p / 1080p across CPU baseline (pre-migration), WebGPU, and sharp.

Targets:

- Browser + WebGPU, 720p, 7-stage `runPreview`: end-to-end ≤ 33 ms (30 fps). Per-task `executePreview` ≤ 5 ms.
- Node + sharp, 7-stage `execute`: ≤ 100 ms at 720p.
- Browser CPU fallback: ≤ 1500 ms at 720p (down from current 5200 ms; the reduction comes from removing the per-stage encode/decode loop, even on CPU).

Run manually (`bun packages/test/src/perf/imageChainPerf.ts`); not in CI by default. Numbers paste into this spec's results section once the implementation lands.

## Out of scope

- Webcam capture (`WebcamCaptureTask`) — separate work.
- Worker-based execution.
- WebGPU on node (dawn / similar).
- Audio / video / tensor pipelines.
- Encoded-byte cache form alongside materialized form.
- Preview-only downscale / preview-resolution mode.
