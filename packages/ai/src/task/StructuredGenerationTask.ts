/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, JobQueueTaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { TypeModel } from "./base/AiTaskSchemas";
import { StreamingAiTask } from "./base/StreamingAiTask";

const modelSchema = TypeModel("model:StructuredGenerationTask");

export const StructuredGenerationInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    prompt: {
      type: "string",
      title: "Prompt",
      description: "The prompt to generate structured output from",
    },
    outputSchema: {
      type: "object",
      title: "Output Schema",
      description: "JSON Schema describing the desired output structure",
      additionalProperties: true,
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
  },
  required: ["model", "prompt", "outputSchema"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const StructuredGenerationOutputSchema = {
  type: "object",
  properties: {
    object: {
      type: "object",
      title: "Structured Output",
      description: "The generated structured object conforming to the provided schema",
      "x-stream": "object",
      "x-structured-output": true,
      additionalProperties: true,
    },
  },
  required: ["object"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StructuredGenerationTaskInput = FromSchema<typeof StructuredGenerationInputSchema>;
export type StructuredGenerationTaskOutput = FromSchema<typeof StructuredGenerationOutputSchema>;

export class StructuredGenerationTask extends StreamingAiTask<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "StructuredGenerationTask";
  public static category = "AI Text Model";
  public static title = "Structured Generation";
  public static description =
    "Generates structured JSON output conforming to a provided schema using language models";
  public static inputSchema(): DataPortSchema {
    return StructuredGenerationInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return StructuredGenerationOutputSchema as DataPortSchema;
  }
}

/**
 * Task for generating structured JSON output using a language model
 */
export const structuredGeneration = (
  input: StructuredGenerationTaskInput,
  config?: JobQueueTaskConfig
) => {
  return new StructuredGenerationTask({} as StructuredGenerationTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    structuredGeneration: CreateWorkflow<
      StructuredGenerationTaskInput,
      StructuredGenerationTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.structuredGeneration = CreateWorkflow(StructuredGenerationTask);
