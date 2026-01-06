/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, JobQueueTaskConfig, TaskRegistry, Workflow } from "@workglow/task-graph";
import {
  DataPortSchema,
  FromSchema,
  TypedArraySchema,
  TypedArraySchemaOptions,
} from "@workglow/util";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model:TextEmbeddingTask");

export const TextEmbeddingInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to embed",
    },
    model: modelSchema,
  },
  required: ["text", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextEmbeddingOutputSchema = {
  type: "object",
  properties: {
    vector: TypedArraySchema({
      title: "Vector",
      description: "The vector embedding of the text",
    }),
  },
  required: ["vector"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextEmbeddingTaskInput = FromSchema<
  typeof TextEmbeddingInputSchema,
  TypedArraySchemaOptions
>;
export type TextEmbeddingTaskOutput = FromSchema<
  typeof TextEmbeddingOutputSchema,
  TypedArraySchemaOptions
>;

/**
 * A task that generates vector embeddings for text using a specified embedding model.
 * Embeddings are numerical representations of text that capture semantic meaning,
 * useful for similarity comparisons and semantic search.
 *
 * @extends AiTask
 */
export class TextEmbeddingTask extends AiTask<TextEmbeddingTaskInput, TextEmbeddingTaskOutput> {
  public static type = "TextEmbeddingTask";
  public static category = "AI Text Model";
  public static title = "Text Embedding";
  public static description = "Generates vector embeddings for text to capture semantic meaning";
  public static inputSchema(): DataPortSchema {
    return TextEmbeddingInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return TextEmbeddingOutputSchema as DataPortSchema;
  }
}

TaskRegistry.registerTask(TextEmbeddingTask);

/**
 * Convenience function to create and run a text embedding task.
 * @param input - Input containing text(s) and model(s) for embedding
 * @returns  Promise resolving to the generated embeddings
 */
export const textEmbedding = async (input: TextEmbeddingTaskInput, config?: JobQueueTaskConfig) => {
  return new TextEmbeddingTask({} as TextEmbeddingTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textEmbedding: CreateWorkflow<
      TextEmbeddingTaskInput,
      TextEmbeddingTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.textEmbedding = CreateWorkflow(TextEmbeddingTask);
