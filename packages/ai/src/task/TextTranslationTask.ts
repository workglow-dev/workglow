/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  DeReplicateFromSchema,
  JobQueueTaskConfig,
  TaskRegistry,
  TypeReplicateArray,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { AiTask } from "./base/AiTask";
import { TypeLanguage, TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeReplicateArray(TypeModel("model:TextTranslationTask"));

const translationTextSchema = {
  type: "string",
  title: "Text",
  description: "The translated text",
} as const;

export const TextTranslationInputSchema = {
  type: "object",
  properties: {
    text: TypeReplicateArray({
      type: "string",
      title: "Text",
      description: "The text to translate",
    }),
    source_lang: TypeReplicateArray(
      TypeLanguage({
        title: "Source Language",
        description: "The source language",
        minLength: 2,
        maxLength: 2,
      })
    ),
    target_lang: TypeReplicateArray(
      TypeLanguage({
        title: "Target Language",
        description: "The target language",
        minLength: 2,
        maxLength: 2,
      })
    ),
    model: modelSchema,
  },
  required: ["text", "source_lang", "target_lang", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextTranslationOutputSchema = {
  type: "object",
  properties: {
    text: {
      oneOf: [translationTextSchema, { type: "array", items: translationTextSchema }],
      title: translationTextSchema.title,
      description: translationTextSchema.description,
    },
    target_lang: TypeLanguage({
      title: "Output Language",
      description: "The output language",
      minLength: 2,
      maxLength: 2,
    }),
  },
  required: ["text", "target_lang"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextTranslationTaskInput = FromSchema<typeof TextTranslationInputSchema>;
export type TextTranslationTaskOutput = FromSchema<typeof TextTranslationOutputSchema>;
export type TextTranslationTaskExecuteInput = DeReplicateFromSchema<
  typeof TextTranslationInputSchema
>;
export type TextTranslationTaskExecuteOutput = DeReplicateFromSchema<
  typeof TextTranslationOutputSchema
>;

/**
 * This translates text from one language to another
 */
export class TextTranslationTask extends AiTask<
  TextTranslationTaskInput,
  TextTranslationTaskOutput
> {
  public static type = "TextTranslationTask";
  public static category = "AI Text Model";
  public static title = "Text Translation";
  public static description = "Translates text from one language to another using language models";
  public static inputSchema(): DataPortSchema {
    return TextTranslationInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return TextTranslationOutputSchema as DataPortSchema;
  }
}

TaskRegistry.registerTask(TextTranslationTask);

/**
 * Convenience function to run text translation tasks.
 * Creates and executes a TextTranslationCompoundTask with the provided input.
 * @param input The input parameters for text translation (text, model, source_lang, and target_lang)
 * @returns Promise resolving to the translated text output(s)
 */
export const textTranslation = (input: TextTranslationTaskInput, config?: JobQueueTaskConfig) => {
  return new TextTranslationTask({} as TextTranslationTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textTranslation: CreateWorkflow<
      TextTranslationTaskInput,
      TextTranslationTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.textTranslation = CreateWorkflow(TextTranslationTask);
