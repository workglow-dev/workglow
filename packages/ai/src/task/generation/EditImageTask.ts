/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, Workflow } from "@workglow/task-graph";
import type { TaskConfig } from "@workglow/task-graph";
import { GpuImageSchema } from "@workglow/util/media";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

import { TypeModel } from "../base/AiTaskSchemas";
import { AiImageOutputTask } from "../base/AiImageOutputTask";
import type { AiImageOutput } from "../base/AiImageOutputTask";
import { AiImageOptionsProperties, AiImageOutputSchema } from "./AiImageSchemas";

const modelSchema = TypeModel("model:EditImageTask");

export const EditImageInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    prompt: {
      type: "string",
      title: "Prompt",
      description: "Text describing the edit to apply",
    },
    image: GpuImageSchema({
      title: "Image",
      description: "Primary image to edit",
    }),
    mask: GpuImageSchema({
      title: "Mask",
      description:
        "Optional inpainting mask. Transparent regions indicate where to edit. Supported by OpenAI and HF inpainting models.",
    }),
    additionalImages: {
      type: "array",
      title: "Additional Images",
      description:
        "Optional reference / composite images. Used by gpt-image-2 and Gemini 2.5 Flash Image for multi-image edits.",
      items: GpuImageSchema(),
    },
    ...AiImageOptionsProperties,
  },
  required: ["model", "prompt", "image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const EditImageOutputSchema = AiImageOutputSchema;

export type EditImageTaskInput = FromSchema<typeof EditImageInputSchema>;
export type EditImageTaskOutput = AiImageOutput;
export type EditImageTaskConfig = TaskConfig<EditImageTaskInput>;

export class EditImageTask extends AiImageOutputTask<
  EditImageTaskInput,
  EditImageTaskConfig
> {
  public static override type = "EditImageTask";
  public static override category = "AI / Image";
  public static override title = "Edit Image";
  public static override description =
    "Edits an input image guided by a prompt. Optionally accepts a mask (inpaint) and/or additional reference images (composite).";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return EditImageInputSchema as DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return EditImageOutputSchema as DataPortSchema;
  }

  public override async validateInput(input: EditImageTaskInput): Promise<boolean> {
    const ok = await super.validateInput(input);
    if (!ok) return false;
    await this.validateProviderImageInput(input);
    return true;
  }
}

export const editImage = (
  input: EditImageTaskInput,
  config?: EditImageTaskConfig,
) => new EditImageTask(config).run(input);

declare module "@workglow/task-graph" {
  interface Workflow {
    editImage: CreateWorkflow<EditImageTaskInput, EditImageTaskOutput, EditImageTaskConfig>;
  }
}

Workflow.prototype.editImage = CreateWorkflow(EditImageTask);
