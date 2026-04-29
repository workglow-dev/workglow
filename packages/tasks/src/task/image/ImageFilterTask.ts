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

  override async execute(input: Input, _ctx: IExecuteContext): Promise<Output | undefined> {
    return { image: applyFilter(input.image, this.filterName, this.opParams(input)) } as Output;
  }

  override async executePreview(input: Input, _ctx: IExecutePreviewContext): Promise<Output | undefined> {
    return { image: applyFilter(input.image, this.filterName, this.opParams(input)) } as Output;
  }
}
