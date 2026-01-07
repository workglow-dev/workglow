/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, JobQueueTaskConfig, TaskRegistry, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model:TextSummaryTask");

export const TextSummaryInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to summarize",
    },
    model: modelSchema,
  },
  required: ["text", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextSummaryOutputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The summarized text",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextSummaryTaskInput = FromSchema<typeof TextSummaryInputSchema>;
export type TextSummaryTaskOutput = FromSchema<typeof TextSummaryOutputSchema>;

/**
 * This summarizes a piece of text
 */

export class TextSummaryTask extends AiTask<TextSummaryTaskInput, TextSummaryTaskOutput> {
  public static type = "TextSummaryTask";
  public static category = "AI Text Model";
  public static title = "Text Summary";
  public static description =
    "Summarizes text into a shorter form while preserving key information";
  public static inputSchema(): DataPortSchema {
    return TextSummaryInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return TextSummaryOutputSchema as DataPortSchema;
  }
}

TaskRegistry.registerTask(TextSummaryTask);

/**
 * Convenience function to run text summary tasks.
 * Creates and executes a text summary task with the provided input.
 * @param input The input parameters for text summary (text and model)
 * @returns Promise resolving to the summarized text output(s)
 */
export const textSummary = async (input: TextSummaryTaskInput, config?: JobQueueTaskConfig) => {
  return new TextSummaryTask({} as TextSummaryTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textSummary: CreateWorkflow<TextSummaryTaskInput, TextSummaryTaskOutput, JobQueueTaskConfig>;
  }
}

Workflow.prototype.textSummary = CreateWorkflow(TextSummaryTask);
