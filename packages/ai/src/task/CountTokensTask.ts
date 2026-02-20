/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { estimateTokens } from "@workglow/dataset";
import {
  CreateWorkflow,
  IExecuteReactiveContext,
  JobQueueTaskConfig,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model");

export const CountTokensInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to count tokens for",
    },
    model: modelSchema,
  },
  required: ["text", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const CountTokensOutputSchema = {
  type: "object",
  properties: {
    count: {
      type: "number",
      title: "Token Count",
      description: "The number of tokens in the text",
    },
  },
  required: ["count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type CountTokensTaskInput = FromSchema<typeof CountTokensInputSchema>;
export type CountTokensTaskOutput = FromSchema<typeof CountTokensOutputSchema>;

/**
 * A task that counts the number of tokens in a text string using a specified model's tokenizer.
 * Token counts are model-specific and are useful for managing context window limits and
 * budgeting token usage in RAG pipelines.
 *
 * @extends AiTask
 */
export class CountTokensTask extends AiTask<CountTokensTaskInput, CountTokensTaskOutput> {
  public static type = "CountTokensTask";
  public static category = "AI Text Model";
  public static title = "Count Tokens";
  public static description =
    "Counts the number of tokens in a text string using the model's tokenizer";
  public static cacheable = true;
  public static inputSchema(): DataPortSchema {
    return CountTokensInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return CountTokensOutputSchema as DataPortSchema;
  }

  /**
   * Returns the real count already produced by execute(), or falls back to
   * estimateTokens so the reactive phase never makes a network call.
   */
  async executeReactive(
    input: CountTokensTaskInput,
    output: CountTokensTaskOutput,
    _context: IExecuteReactiveContext
  ): Promise<CountTokensTaskOutput> {
    if (output?.count !== undefined) {
      return output;
    }
    return { count: estimateTokens(input.text) };
  }
}

/**
 * Convenience function to create and run a count tokens task.
 * @param input - Input containing text and model for token counting
 * @returns Promise resolving to the token count
 */
export const countTokens = async (input: CountTokensTaskInput, config?: JobQueueTaskConfig) => {
  return new CountTokensTask({} as CountTokensTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    countTokens: CreateWorkflow<CountTokensTaskInput, CountTokensTaskOutput, JobQueueTaskConfig>;
  }
}

Workflow.prototype.countTokens = CreateWorkflow(CountTokensTask);
