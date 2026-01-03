/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, JobQueueTaskConfig, TaskRegistry, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { AiTask } from "./base/AiTask";
import { DeReplicateFromSchema, TypeModel, TypeReplicateArray } from "./base/AiTaskSchemas";

const modelSchema = TypeReplicateArray(TypeModel("model"));

const DownloadModelInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const DownloadModelOutputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type DownloadModelTaskRunInput = FromSchema<typeof DownloadModelInputSchema>;
export type DownloadModelTaskRunOutput = FromSchema<typeof DownloadModelOutputSchema>;
export type DownloadModelTaskExecuteInput = DeReplicateFromSchema<typeof DownloadModelInputSchema>;
export type DownloadModelTaskExecuteOutput = DeReplicateFromSchema<
  typeof DownloadModelOutputSchema
>;

/**
 * Download a model from a remote source and cache it locally.
 *
 * @remarks
 * This task has a side effect of downloading the model and caching it locally outside of the task system
 */
export class DownloadModelTask extends AiTask<
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  JobQueueTaskConfig
> {
  public static type = "DownloadModelTask";
  public static category = "AI Text Model";
  public static title = "Download Model";
  public static description = "Downloads and caches AI models locally with progress tracking";
  public static inputSchema(): DataPortSchema {
    return DownloadModelInputSchema satisfies DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return DownloadModelOutputSchema satisfies DataPortSchema;
  }
  public static cacheable = false;

  public files: { file: string; progress: number }[] = [];

  constructor(input: Partial<DownloadModelTaskRunInput>, config: JobQueueTaskConfig = {}) {
    super(input as DownloadModelTaskRunInput, config);
    this.on("progress", this.processProgress.bind(this));
    this.on("start", () => {
      this.files = [];
    });
  }

  /**
   * Handles progress updates for the download task
   * @param progress - The progress value (0-100)
   * @param message - The message to display
   * @param details - Additional details about the progress
   */
  processProgress(
    progress: number,
    message: string = "",
    details?: { file?: string; progress: number; text?: number }
  ): void {
    if (details?.file) {
      const file = this.files.find((f) => f.file === details.file);
      if (file) {
        file.progress = details.progress;
      } else {
        this.files.push({ file: details.file, progress: details.progress });
      }
      this.progress = this.files.reduce((acc, f) => acc + f.progress, 0) / this.files.length;
    } else {
      this.progress = progress;
    }
  }
}

TaskRegistry.registerTask(DownloadModelTask);

/**
 * Download a model from a remote source and cache it locally.
 *
 * @param input - Input containing model(s) to download
 * @returns Promise resolving to the downloaded model(s)
 */
export const downloadModel = (input: DownloadModelTaskRunInput, config?: JobQueueTaskConfig) => {
  return new DownloadModelTask({} as DownloadModelTaskRunInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    downloadModel: CreateWorkflow<
      DownloadModelTaskRunInput,
      DownloadModelTaskRunOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.downloadModel = CreateWorkflow(DownloadModelTask);
