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
import { applyFilter, type FilterOpOptions } from "./imageOp";

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

  private runFilter(input: Input, opts: FilterOpOptions): Output {
    return { image: applyFilter(input.image, this.filterName, this.opParams(input), opts) } as Output;
  }

  override async execute(input: Input, _ctx: IExecuteContext): Promise<Output | undefined> {
    // Production chain: source isn't observed by any UI; the backend op
    // may reclaim its texture/buffer immediately for pool reuse.
    return this.runFilter(input, { releaseSource: true });
  }

  override async executePreview(input: Input, _ctx: IExecutePreviewContext): Promise<Output | undefined> {
    // Builder UI keeps references to intermediate task outputs to render
    // them in property editors after the chain completes — leave sources
    // alive so toCanvas / materialize don't see released textures.
    return this.runFilter(input, { releaseSource: false });
  }
}
