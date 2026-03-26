/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, TextEmbeddingTaskInput, TextEmbeddingTaskOutput } from "@workglow/ai";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { getOrCreateEmbeddingContext } from "./LlamaCpp_Runtime";

export const LlamaCpp_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, _signal) => {
  if (!model) throw new Error("Model config is required for TextEmbeddingTask.");

  update_progress(0, "Loading embedding model");
  const context = await getOrCreateEmbeddingContext(model);

  update_progress(10, "Computing embeddings");

  const embedding = await context.getEmbeddingFor(input.text);
  const vector = new Float32Array(embedding.vector);

  update_progress(100, "Embeddings complete");

  return { vector };
};
