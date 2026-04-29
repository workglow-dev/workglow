/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import {
  Task,
  type IExecuteContext,
  type IExecutePreviewContext,
  type TaskConfig,
} from "@workglow/task-graph";
import { type GpuImage, GpuImageFactory, getGpuImageFactory, previewSource, CpuImage } from "@workglow/util/media";
import { applyFilter, hasFilterOp } from "./imageOp";

export interface ImageFilterInput { image: GpuImage; }
export interface ImageFilterOutput { image: GpuImage; }

export abstract class ImageFilterTask<
  P,
  Input extends ImageFilterInput & Record<string, unknown> = ImageFilterInput & Record<string, unknown>,
  Output extends ImageFilterOutput & Record<string, unknown> = ImageFilterOutput & Record<string, unknown>,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  protected abstract readonly filterName: string;
  protected abstract opParams(input: Input): P;

  /** Override in subclasses with pixel-space params. Default is identity.
   *  Always called before applyFilter; multiply-by-1 in run mode is a no-op. */
  protected scalePreviewParams(params: P, _scale: number): P {
    return params;
  }

  /**
   * Ensure `input.image` is a real GpuImage instance. The format:"image"
   * input resolver in @workglow/util/media is string-only, and the
   * task-graph InputResolver passes raw object shapes through to the task
   * (see InputResolver.ts:207-209). When an upstream task produces a raw
   * shape, this method wraps it via the platform's preferred backend
   * (WebGpuImage on browser when GPU is available, SharpImage on node,
   * CpuImage as fallback) so the rest of the chain stays on the fastest
   * available backend.
   *
   * Handles all the shapes GpuImage's factory registry knows how to convert:
   * GpuImage instance, raw ImageBinary, Blob, ImageBitmap, and data: URI
   * strings. For anything else, throws an informative error.
   */
  private async hydrateInput(image: unknown): Promise<GpuImage> {
    // Already a real GpuImage? Pass through.
    if (
      image !== null &&
      typeof image === "object" &&
      "backend" in image &&
      "retain" in image &&
      "release" in image &&
      "materialize" in image
    ) {
      return image as GpuImage;
    }
    // data: URI string — use the registered async factory.
    if (typeof image === "string" && image.startsWith("data:")) {
      return GpuImageFactory.fromDataUri(image);
    }
    // Blob — has fromBlob factory in browser/node entries.
    if (typeof Blob !== "undefined" && image instanceof Blob) {
      return GpuImageFactory.fromBlob(image);
    }
    // ImageBitmap — browser only; the factory entry registers fromImageBitmap.
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
      const fromImageBitmap = getGpuImageFactory("fromImageBitmap");
      if (!fromImageBitmap) {
        throw new Error(
          "ImageFilterTask: received ImageBitmap but GpuImage.fromImageBitmap is not registered " +
            "in this runtime. ImageBitmap inputs require the browser entry point.",
        );
      }
      return fromImageBitmap(image);
    }
    // Raw ImageBinary / MediaRawImage shape — wrap via the async factory
    // (which routes to the GPU backend when available) or fall back to sync.
    if (
      image !== null &&
      typeof image === "object" &&
      "data" in image &&
      "width" in image &&
      "height" in image &&
      "channels" in image
    ) {
      const bin = image as Parameters<typeof GpuImageFactory.fromImageBinary>[0];
      // Prefer the async factory which routes to the GPU-capable backend.
      // Fall back to the sync factory (CpuImage) if the async factory isn't
      // registered (e.g., in a stripped-down worker context).
      const asyncFactory = getGpuImageFactory("fromImageBinaryAsync");
      if (asyncFactory) return asyncFactory(bin);
      return GpuImageFactory.fromImageBinary(bin);
    }

    // Build a more useful diagnostic — typeof "object" alone is unhelpful when
    // the object could be anything from an HTMLImageElement to a stale snapshot.
    const ctor =
      image && typeof image === "object" && (image as object).constructor
        ? (image as object).constructor.name
        : typeof image;
    const keys =
      image && typeof image === "object"
        ? Object.keys(image as object).slice(0, 10).join(", ")
        : "";
    throw new Error(
      `ImageFilterTask: input.image is not a recognized image shape (got ${ctor}` +
        (keys ? ` with keys [${keys}]` : "") +
        `). Expected one of: GpuImage instance, raw ImageBinary, Blob, ImageBitmap, ` +
        `or a data: URI string.`,
    );
  }

  override async execute(input: Input, ctx: IExecuteContext): Promise<Output | undefined> {
    let inputImage = await this.hydrateInput(input.image);
    // Fallback pre-flight: if the input image's backend has no registered op for
    // this filter (e.g., a WebGpuImage for a filter whose WGSL hasn't been
    // written yet), materialize to CPU and dispatch the cpu arm instead. This
    // releases the original GPU/Sharp ref and swaps in a fresh CpuImage; the
    // final inputImage.release() below remains correct because CpuImage's
    // retain/release are no-ops.
    if (!hasFilterOp(inputImage.backend, this.filterName)) {
      const bin = await inputImage.materialize();
      const cpu = CpuImage.fromImageBinary(bin, inputImage.previewScale) as unknown as GpuImage;
      inputImage.release();
      inputImage = cpu;
    }
    // If applyFilter throws, this task's ref of inputImage is leaked until
    // FinalizationRegistry catches it. The leak is bounded — upstream tasks'
    // resourceScope disposers cover the input via their own output registration.
    const params = this.scalePreviewParams(this.opParams(input), inputImage.previewScale);
    const out = applyFilter(inputImage, this.filterName, params);
    // Refcount: this task held one ref of inputImage (delivered by the runner);
    // applyFilter is done with it, so decrement. Other consumers of the same
    // upstream output still have their own refs (runner's fanout retain).
    inputImage.release();
    // Belt-and-suspenders error path: register the output's release with the
    // run's resourceScope so a thrown error mid-chain doesn't leak the texture
    // until FinalizationRegistry catches up. First-registration-wins, so the
    // per-task-id key is unique.
    //
    // In the happy path the output reaches refcount 0 via downstream consumers'
    // release() before the run's scope drains. The disposer below then throws
    // "called on a released image"; ResourceScope.disposeAll swallows that
    // rejection via Promise.allSettled. Behavior is correct (pool integrity
    // preserved); the asymmetry is intentional — the disposer is for the
    // abort/error case, not the success case.
    ctx.resourceScope?.register(
      `gpuimage:${String(this.id)}:image`,
      async () => out.release(),
    );
    return { image: out } as Output;
  }

  override async executePreview(input: Input, _ctx: IExecutePreviewContext): Promise<Output | undefined> {
    const inputImage = await this.hydrateInput(input.image);
    // Scale-then-effect: the first filter in a chain pays a single resize when
    // the input is over the preview budget. Downstream filters see already-small
    // images and previewSource is a no-op (returns the input unchanged).
    let sourced = previewSource(inputImage);
    // Fallback runs AFTER previewSource so a missing webgpu arm doesn't defeat
    // the preview budget by materializing a full-resolution image.
    if (!hasFilterOp(sourced.backend, this.filterName)) {
      const bin = await sourced.materialize();
      const cpu = CpuImage.fromImageBinary(bin, sourced.previewScale) as unknown as GpuImage;
      if (sourced !== inputImage) sourced.release();
      sourced = cpu;
    }
    const params = this.scalePreviewParams(this.opParams(input), sourced.previewScale);
    const out = applyFilter(sourced, this.filterName, params);
    // Release the resize transient when one was created; not the original input
    // (the builder's useGpuImage hook holds a ref through display, and other
    // consumers — property viewers, downstream filters — also retain).
    if (sourced !== inputImage) sourced.release();
    return { image: out } as Output;
  }
}
