/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
} from "@workglow/ai";
import { getLogger, TypedArray } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for text embedding using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const logger = getLogger();
  const uuid = crypto.randomUUID();
  const timerLabel = `hft:TextEmbedding:${model?.provider_config.model_path}:${uuid}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  const generateEmbedding: FeatureExtractionPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );

  logger.debug("HFT TextEmbedding: pipeline ready, generating embedding", {
    model: model?.provider_config.model_path,
    inputLength: input.text?.length,
  });

  // Generate the embedding
  const hfVector = await generateEmbedding(input.text, {
    pooling: model?.provider_config.pooling || "mean",
    normalize: model?.provider_config.normalize,
  });

  const embeddingDim = model?.provider_config.native_dimensions;

  // Validate dimensions
  if (hfVector.size !== embeddingDim) {
    logger.timeEnd(timerLabel, { status: "error", reason: "dimension mismatch" });
    console.warn(
      `HuggingFace Embedding vector length does not match model dimensions v${hfVector.size} != m${embeddingDim}`,
      input,
      hfVector
    );
    throw new Error(
      `HuggingFace Embedding vector length does not match model dimensions v${hfVector.size} != m${embeddingDim}`
    );
  }

  logger.timeEnd(timerLabel, { dimensions: hfVector.size });
  return { vector: hfVector.data as TypedArray };
};
