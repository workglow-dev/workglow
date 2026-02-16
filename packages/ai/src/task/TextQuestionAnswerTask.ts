/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, JobQueueTaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { TypeModel } from "./base/AiTaskSchemas";
import { StreamingAiTask } from "./base/StreamingAiTask";

const contextSchema = {
  type: "string",
  title: "Context",
  description: "The context of the question",
} as const;

const questionSchema = {
  type: "string",
  title: "Question",
  description: "The question to answer",
} as const;

const textSchema = {
  type: "string",
  title: "Text",
  description: "The generated text",
} as const;

const modelSchema = TypeModel("model:TextQuestionAnswerTask");

export const TextQuestionAnswerInputSchema = {
  type: "object",
  properties: {
    context: contextSchema,
    question: questionSchema,
    model: modelSchema,
  },
  required: ["context", "question", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextQuestionAnswerOutputSchema = {
  type: "object",
  properties: {
    text: textSchema,
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextQuestionAnswerTaskInput = FromSchema<typeof TextQuestionAnswerInputSchema>;
export type TextQuestionAnswerTaskOutput = FromSchema<typeof TextQuestionAnswerOutputSchema>;

/**
 * This is a special case of text generation that takes a context and a question
 */
export class TextQuestionAnswerTask extends StreamingAiTask<
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "TextQuestionAnswerTask";
  public static category = "AI Text Model";
  public static title = "Text Question Answer";
  public static description = "Answers questions based on provided context using language models";
  public static streamable = true;
  public static streamMode = "append" as const;
  public static inputSchema(): DataPortSchema {
    return TextQuestionAnswerInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return TextQuestionAnswerOutputSchema as DataPortSchema;
  }
}

/**
 * Convenience function to run text question answer tasks.
 * Creates and executes a TextQuestionAnswerCompoundTask with the provided input.
 * @param input The input parameters for text question answer (context, question, and model)
 * @returns Promise resolving to the generated answer(s)
 */
export const textQuestionAnswer = (
  input: TextQuestionAnswerTaskInput,
  config?: JobQueueTaskConfig
) => {
  return new TextQuestionAnswerTask({} as TextQuestionAnswerTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textQuestionAnswer: CreateWorkflow<
      TextQuestionAnswerTaskInput,
      TextQuestionAnswerTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.textQuestionAnswer = CreateWorkflow(TextQuestionAnswerTask);
