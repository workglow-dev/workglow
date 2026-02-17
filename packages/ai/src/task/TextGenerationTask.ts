/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, JobQueueTaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { TypeModel } from "./base/AiTaskSchemas";
import { StreamingAiTask } from "./base/StreamingAiTask";

const generatedTextSchema = {
  type: "string",
  title: "Text",
  description: "The generated text",
  "x-stream": "append",
} as const;

const modelSchema = TypeModel("model:TextGenerationTask");

export const TextGenerationInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    prompt: {
      type: "string",
      title: "Prompt",
      description: "The prompt to generate text from",
    },
    maxTokens: {
      type: "number",
      title: "Max Tokens",
      description: "The maximum number of tokens to generate",
      minimum: 1,
      maximum: 4096,
      "x-ui-group": "Configuration",
    },
    temperature: {
      type: "number",
      title: "Temperature",
      description: "The temperature to use for sampling",
      minimum: 0,
      maximum: 2,
      "x-ui-group": "Configuration",
    },
    topP: {
      type: "number",
      title: "Top-p",
      description: "The top-p value to use for sampling",
      minimum: 0,
      maximum: 1,
      "x-ui-group": "Configuration",
    },
    frequencyPenalty: {
      type: "number",
      title: "Frequency Penalty",
      description: "The frequency penalty to use",
      minimum: -2,
      maximum: 2,
      "x-ui-group": "Configuration",
    },
    presencePenalty: {
      type: "number",
      title: "Presence Penalty",
      description: "The presence penalty to use",
      minimum: -2,
      maximum: 2,
      "x-ui-group": "Configuration",
    },
  },
  required: ["model", "prompt"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextGenerationOutputSchema = {
  type: "object",
  properties: {
    text: generatedTextSchema,
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextGenerationTaskInput = FromSchema<typeof TextGenerationInputSchema>;
export type TextGenerationTaskOutput = FromSchema<typeof TextGenerationOutputSchema>;

export class TextGenerationTask extends StreamingAiTask<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "TextGenerationTask";
  public static category = "AI Text Model";
  public static title = "Text Generation";
  public static description =
    "Generates text from a prompt using language models with configurable parameters";
  public static inputSchema(): DataPortSchema {
    return TextGenerationInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return TextGenerationOutputSchema as DataPortSchema;
  }
}

/**
 * Task for generating text using a language model
 */
export const textGeneration = (input: TextGenerationTaskInput, config?: JobQueueTaskConfig) => {
  return new TextGenerationTask({} as TextGenerationTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textGeneration: CreateWorkflow<
      TextGenerationTaskInput,
      TextGenerationTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.textGeneration = CreateWorkflow(TextGenerationTask);
