/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  EmbeddingModelV3,
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Result,
  ImageModelV3,
  ImageModelV3CallOptions,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import type {
  TextEmbeddingTaskInput,
  TextGenerationTaskInput,
  TextQuestionAnswerTaskInput,
  TextRewriterTaskInput,
  TextSummaryTaskInput,
  TextTranslationTaskInput,
} from "@workglow/ai";
import {
  HFT_TextEmbedding,
  HFT_TextGeneration,
  HFT_TextQuestionAnswer,
  HFT_TextRewriter,
  HFT_TextSummary,
  HFT_TextTranslation,
} from "../common/HFT_JobRunFns";
import { HfTransformersOnnxModelConfig } from "../common/HFT_ModelSchema";

function toPromptText(prompt: LanguageModelV3Prompt): string {
  const texts: string[] = [];
  for (const message of prompt) {
    if (typeof message.content === "string") {
      texts.push(message.content);
      continue;
    }
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "text" && typeof part.text === "string") {
          texts.push(part.text);
        }
      }
    }
  }
  return texts.join("\n");
}

function resultFromText(text: string): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    },
    request: {},
    response: {
      id: undefined,
      timestamp: new Date(),
      modelId: undefined,
    },
    warnings: [],
  };
}

export class HFT_LanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3";
  readonly provider = "hf-transformers";
  readonly modelId: string;
  readonly supportedUrls = {};

  constructor(private readonly model: HfTransformersOnnxModelConfig) {
    this.modelId = model.model_id || model.provider_config.model_path;
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const text = toPromptText(options.prompt);
    const noopProgress = () => {};
    const signal = options.abortSignal ?? new AbortController().signal;
    const pipeline = this.model.provider_config.pipeline;

    const modelRef = this.model as Record<string, unknown>;

    switch (pipeline) {
      case "summarization": {
        const output = await HFT_TextSummary(
          { text, model: modelRef } as TextSummaryTaskInput,
          this.model,
          noopProgress,
          signal
        );
        return resultFromText(output.text);
      }
      case "translation": {
        const output = await HFT_TextTranslation(
          {
            text,
            source_lang: "auto",
            target_lang: "en",
            model: modelRef,
          } as TextTranslationTaskInput,
          this.model,
          noopProgress,
          signal
        );
        return resultFromText(output.text);
      }
      case "question-answering": {
        const output = await HFT_TextQuestionAnswer(
          { context: "", question: text, model: modelRef } as TextQuestionAnswerTaskInput,
          this.model,
          noopProgress,
          signal
        );
        return resultFromText(output.text);
      }
      case "text2text-generation": {
        const output = await HFT_TextRewriter(
          { text, prompt: "", model: modelRef } as TextRewriterTaskInput,
          this.model,
          noopProgress,
          signal
        );
        return resultFromText(output.text);
      }
      case "text-generation":
      default: {
        const output = await HFT_TextGeneration(
          { prompt: text, model: modelRef } as TextGenerationTaskInput,
          this.model,
          noopProgress,
          signal
        );
        return resultFromText(output.text);
      }
    }
  }

  async doStream(_options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    throw new UnsupportedFunctionalityError({
      functionality: `streaming (provider: ${this.provider})`,
    });
  }
}

export class HFT_EmbeddingModel implements EmbeddingModelV3 {
  readonly specificationVersion = "v3";
  readonly provider = "hf-transformers";
  readonly modelId: string;
  readonly maxEmbeddingsPerCall = undefined;
  readonly supportsParallelCalls = false;

  constructor(private readonly model: HfTransformersOnnxModelConfig) {
    this.modelId = model.model_id || model.provider_config.model_path;
  }

  async doEmbed(options: EmbeddingModelV3CallOptions): Promise<EmbeddingModelV3Result> {
    const taskInput = {
      text: options.values,
      model: this.model as Record<string, unknown>,
    } as TextEmbeddingTaskInput;
    const signal = options.abortSignal ?? new AbortController().signal;
    const output = await HFT_TextEmbedding(taskInput, this.model, () => {}, signal);
    const vectors = Array.isArray(output.vector) ? output.vector : [output.vector];
    return {
      embeddings: vectors.map((vector) => Array.from(vector as ArrayLike<number>)),
      usage: undefined,
      warnings: [],
    };
  }
}

export class HFT_ImageModel implements ImageModelV3 {
  readonly specificationVersion = "v3";
  readonly provider = "hf-transformers";
  readonly modelId: string;
  readonly maxImagesPerCall = 1;

  constructor(model: HfTransformersOnnxModelConfig) {
    this.modelId = model.model_id || model.provider_config.model_path;
  }

  async doGenerate(
    _options: ImageModelV3CallOptions
  ): Promise<Awaited<ReturnType<ImageModelV3["doGenerate"]>>> {
    throw new UnsupportedFunctionalityError({
      functionality: `image generation (provider: ${this.provider})`,
    });
  }
}
