/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  EmbeddingModelV3,
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Result,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import type { TextEmbeddingTaskInput } from "@workglow/ai";
import { TFMP_TextEmbedding } from "../common/TFMP_JobRunFns";
import { TFMPModelConfig } from "../common/TFMP_ModelSchema";

export class TFMP_LanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3";
  readonly provider = "tf-mediapipe";
  readonly modelId: string;
  readonly supportedUrls = {};

  constructor(model: TFMPModelConfig) {
    this.modelId = model.model_id || model.provider_config.model_path;
  }

  async doGenerate(_options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    throw new UnsupportedFunctionalityError({
      functionality: `text generation (provider: ${this.provider})`,
    });
  }

  async doStream(_options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    throw new UnsupportedFunctionalityError({
      functionality: `streaming (provider: ${this.provider})`,
    });
  }
}

export class TFMP_EmbeddingModel implements EmbeddingModelV3 {
  readonly specificationVersion = "v3";
  readonly provider = "tf-mediapipe";
  readonly modelId: string;
  readonly maxEmbeddingsPerCall = undefined;
  readonly supportsParallelCalls = false;

  constructor(private readonly model: TFMPModelConfig) {
    this.modelId = model.model_id || model.provider_config.model_path;
  }

  async doEmbed(options: EmbeddingModelV3CallOptions): Promise<EmbeddingModelV3Result> {
    const taskInput = {
      text: options.values,
      model: this.model as Record<string, unknown>,
    } as TextEmbeddingTaskInput;
    const signal = options.abortSignal ?? new AbortController().signal;
    const output = await TFMP_TextEmbedding(taskInput, this.model, () => {}, signal);
    const vectors = Array.isArray(output.vector) ? output.vector : [output.vector];
    return {
      embeddings: vectors.map((vector) => Array.from(vector as ArrayLike<number>)),
      usage: undefined,
      warnings: [],
    };
  }
}
