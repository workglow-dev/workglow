/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { TaskConfig } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

import { TypeModel } from "../base/AiTaskSchemas";
import { AiImageOutputTask } from "../base/AiImageOutputTask";
import type { AiImageOutput } from "../base/AiImageOutputTask";
import { AiImageOptionsProperties, AiImageOutputSchema } from "./AiImageSchemas";

const modelSchema = TypeModel("model:GenerateImageTask");

export const GenerateImageInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    prompt: {
      type: "string",
      title: "Prompt",
      description: "Text describing the image to generate",
    },
    ...AiImageOptionsProperties,
  },
  required: ["model", "prompt"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const GenerateImageOutputSchema = AiImageOutputSchema;

export type GenerateImageTaskInput = FromSchema<typeof GenerateImageInputSchema>;
export type GenerateImageTaskOutput = AiImageOutput;
export type GenerateImageTaskConfig = TaskConfig<GenerateImageTaskInput>;

export class GenerateImageTask extends AiImageOutputTask<
  GenerateImageTaskInput,
  GenerateImageTaskConfig
> {
  public static override type = "GenerateImageTask";
  public static override category = "AI / Image";
  public static override title = "Generate Image";
  public static override description =
    "Generates an image from a text prompt using configurable AI image-generation models.";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return GenerateImageInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return GenerateImageOutputSchema as DataPortSchema;
  }

  public override async validateInput(input: GenerateImageTaskInput): Promise<boolean> {
    const ok = await super.validateInput(input);
    if (!ok) return false;
    await this.validateProviderImageInput(input);
    return true;
  }
}

export const generateImage = (
  input: GenerateImageTaskInput,
  config?: GenerateImageTaskConfig,
) => new GenerateImageTask(config).run(input);

declare module "@workglow/task-graph" {
  interface Workflow {
    generateImage: CreateWorkflow<
      GenerateImageTaskInput,
      GenerateImageTaskOutput,
      GenerateImageTaskConfig
    >;
  }
}

Workflow.prototype.generateImage = CreateWorkflow(GenerateImageTask);
