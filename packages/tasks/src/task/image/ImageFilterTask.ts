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
import type { GpuImage } from "@workglow/util/media";
import { previewSource } from "@workglow/util/media";
import { applyFilter } from "./imageOp";

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

  override async execute(input: Input, ctx: IExecuteContext): Promise<Output | undefined> {
    // If applyFilter throws, this task's ref of input.image is leaked until
    // FinalizationRegistry catches it. The leak is bounded — upstream tasks'
    // resourceScope disposers cover the input via their own output registration.
    const out = applyFilter(input.image, this.filterName, this.opParams(input));
    // Refcount: this task held one ref of input.image (delivered by the runner);
    // applyFilter is done with it, so decrement. Other consumers of the same
    // upstream output still have their own refs (runner's fanout retain).
    input.image.release();
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
    // Scale-then-effect: the first filter in a chain pays a single resize when
    // the input is over the preview budget. Downstream filters see already-small
    // images and previewSource is a no-op (returns the input unchanged).
    const sourced = previewSource(input.image);
    const out = applyFilter(sourced, this.filterName, this.opParams(input));
    // Release the resize transient when one was created; not the original input
    // (the builder's useGpuImage hook holds a ref through display, and other
    // consumers — property viewers, downstream filters — also retain).
    if (sourced !== input.image) sourced.release();
    return { image: out } as Output;
  }
}
