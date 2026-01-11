/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, JobQueueTaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model:TextRewriterTask");

export const TextRewriterInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to rewrite",
    },
    prompt: {
      type: "string",
      title: "Prompt",
      description: "The prompt to direct the rewriting",
    },
    model: modelSchema,
  },
  required: ["text", "prompt", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextRewriterOutputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The rewritten text",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextRewriterTaskInput = FromSchema<typeof TextRewriterInputSchema>;
export type TextRewriterTaskOutput = FromSchema<typeof TextRewriterOutputSchema>;

/**
 * This is a special case of text generation that takes a prompt and text to rewrite
 */
export class TextRewriterTask extends AiTask<TextRewriterTaskInput, TextRewriterTaskOutput> {
  public static type = "TextRewriterTask";
  public static category = "AI Text Model";
  public static title = "Text Rewriter";
  public static description = "Rewrites text according to a given prompt using language models";
  public static inputSchema(): DataPortSchema {
    return TextRewriterInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return TextRewriterOutputSchema as DataPortSchema;
  }
}

/**
 * Convenience function to run text rewriter tasks.
 * Creates and executes a TextRewriterCompoundTask with the provided input.
 * @param input The input parameters for text rewriting (text, prompt, and model)
 * @returns Promise resolving to the rewritten text output(s)
 */
export const textRewriter = (input: TextRewriterTaskInput, config?: JobQueueTaskConfig) => {
  return new TextRewriterTask({} as TextRewriterTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textRewriter: CreateWorkflow<TextRewriterTaskInput, TextRewriterTaskOutput, JobQueueTaskConfig>;
  }
}

Workflow.prototype.textRewriter = CreateWorkflow(TextRewriterTask);
