/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description This file contains the implementation of the JobQueueTask class and its derived classes.
 */

import { JobQueueTaskConfig, TaskInput, type TaskOutput } from "@workglow/task-graph";
import { convertImageDataToUseableForm, ImageDataSupport } from "@workglow/util";

import { AiJobInput } from "../../job/AiJob";
import type { ModelConfig } from "../../model/ModelSchema";
import { AiTask } from "./AiTask";

export interface AiVisionTaskSingleInput extends TaskInput {
  model: string | ModelConfig;
}

/**
 * A base class for AI related tasks that run in a job queue.
 * Extends the JobQueueTask class to provide LLM-specific functionality.
 */
export class AiVisionTask<
  Input extends AiVisionTaskSingleInput = AiVisionTaskSingleInput,
  Output extends TaskOutput = TaskOutput,
  Config extends JobQueueTaskConfig = JobQueueTaskConfig,
> extends AiTask<Input, Output, Config> {
  public static type: string = "AiVisionTask";
  /**
   * Get the input to submit to the job queue.
   * Transforms the task input to AiJobInput format.
   * @param input - The task input
   * @returns The AiJobInput to submit to the queue
   */
  protected override async getJobInput(input: Input): Promise<AiJobInput<Input>> {
    const jobInput = await super.getJobInput(input);
    // TODO: if the queue is not memory based, we need to convert to base64 (or blob?)
    const registeredQueue = await this.resolveQueue(input);
    const queueName = registeredQueue?.server.queueName;

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
      if (queueName === "TENSORFLOW_MEDIAPIPE" && "ImageBitmap" in globalThis) {
        supports.push("ImageBitmap");
      } else if (queueName === "TENSORFLOW_MEDIAPIPE" && "VideoFrame" in globalThis) {
        supports.push("VideoFrame");
      }
      const image = await convertImageDataToUseableForm(input.image, supports);
      // @ts-ignore
      jobInput.taskInput.image = image;
    }
    return jobInput;
  }
}
