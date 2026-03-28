/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskInput, type TaskConfig, type TaskOutput } from "@workglow/task-graph";
import { convertImageDataToUseableForm, ImageDataSupport } from "@workglow/util/media";

import { AiJobInput } from "../../job/AiJob";
import type { ModelConfig } from "../../model/ModelSchema";
import { AiTask } from "./AiTask";

export interface AiVisionTaskSingleInput extends TaskInput {
  model: string | ModelConfig;
}

/**
 * A base class for AI vision tasks.
 * Handles image format conversion based on the target provider's capabilities.
 */
export class AiVisionTask<
  Input extends AiVisionTaskSingleInput = AiVisionTaskSingleInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends AiTask<Input, Output, Config> {
  public static type: string = "AiVisionTask";

  /**
   * Get the input to submit for execution.
   * Converts image data to a format supported by the target provider.
   */
  protected override async getJobInput(input: Input): Promise<AiJobInput<Input>> {
    const jobInput = await super.getJobInput(input);
    const providerName = (input.model as ModelConfig).provider;

    // Image format support by model type and platform, that are transferable:
    // ┌─────────────────────────┬──────────────────────────────────────────────────────────────┬────────────────────────────────────────────┐
    // │ Model Type              │ Web Support                                                  │ Node Support                               │
    // ├─────────────────────────┼──────────────────────────────────────────────────────────────┼────────────────────────────────────────────┤
    // │ TENSORFLOW_MEDIAPIPE    │ Blob, ImageBitmap, VideoFrame,                               │ (none)                                     │
    // │                         │ OffscreenCanvas (no rendering ctx)                           │                                            │
    // ├─────────────────────────┼──────────────────────────────────────────────────────────────┼────────────────────────────────────────────┤
    // │ HF_TRANSFORMERS_ONNX    │ Blob, OffscreenCanvas (no rendering ctx),                    │ Blob, Tensor, ImageBinary,                 │
    // │                         │ ImageBinary, Tensor, DataUri                                 │ DataUri, Sharp                             │
    // └─────────────────────────┴──────────────────────────────────────────────────────────────┴────────────────────────────────────────────┘
    const supports: ImageDataSupport[] = ["Blob"];
    if (input.image) {
      if (
        typeof providerName === "string" &&
        providerName.startsWith("TENSORFLOW_MEDIAPIPE") &&
        "ImageBitmap" in globalThis
      ) {
        supports.push("ImageBitmap");
      } else if (
        typeof providerName === "string" &&
        providerName.startsWith("TENSORFLOW_MEDIAPIPE") &&
        "VideoFrame" in globalThis
      ) {
        supports.push("VideoFrame");
      }
      const image = Array.isArray(input.image)
        ? await Promise.all(input.image.map((img) => convertImageDataToUseableForm(img, supports)))
        : await convertImageDataToUseableForm(input.image, supports);
      // @ts-ignore
      jobInput.taskInput.image = image;
    }
    return jobInput;
  }
}
