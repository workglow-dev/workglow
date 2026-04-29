/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskConfig, TaskOutput } from "@workglow/task-graph";
import type { GpuImage } from "@workglow/util/media";

import { AiJobInput } from "../../job/AiJob";
import type { ModelConfig } from "../../model/ModelSchema";
import { AiTask, AiTaskInput } from "./AiTask";

/**
 * A base class for AI vision tasks.
 * Materializes GpuImage to raw pixels/bitmap at the worker boundary so the
 * worker (which doesn't import GPU code) receives transferable binary data.
 */
export class AiVisionTask<
  Input extends AiTaskInput = AiTaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig<Input> = TaskConfig<Input>,
> extends AiTask<Input, Output, Config> {
  public static override type: string = "AiVisionTask";

  protected override async getJobInput(input: Input): Promise<AiJobInput<Input>> {
    const jobInput = await super.getJobInput(input);
    if (!input.image) return jobInput;

    const provider = (input.model as ModelConfig).provider as string | undefined;
    const wantsBitmap =
      typeof provider === "string" &&
      provider.startsWith("TENSORFLOW_MEDIAPIPE") &&
      typeof ImageBitmap !== "undefined";

    const materializeOne = async (img: GpuImage): Promise<unknown> => {
      if (wantsBitmap) {
        const bin = await img.materialize();
        const id = new ImageData(bin.data as unknown as Uint8ClampedArray<ArrayBuffer>, bin.width, bin.height);
        return createImageBitmap(id);
      }
      return img.materialize();
    };

    const value = input.image as GpuImage | GpuImage[];
    const materialized = Array.isArray(value)
      ? await Promise.all(value.map(materializeOne))
      : await materializeOne(value);

    // @ts-expect-error narrowing across the worker boundary
    jobInput.taskInput.image = materialized;
    return jobInput;
  }
}
