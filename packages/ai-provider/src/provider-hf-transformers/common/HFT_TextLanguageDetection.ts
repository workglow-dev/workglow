/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  TextClassificationOutput,
  TextClassificationPipeline,
} from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
} from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

export const HFT_TextLanguageDetection: AiProviderRunFn<
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  const TextClassification: TextClassificationPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );
  const result = await TextClassification(input.text as any, {
    top_k: input.maxLanguages || undefined,
  });

  if (isArrayInput) {
    return {
      languages: (result as any[]).map((perInput: any) => {
        const items = Array.isArray(perInput) ? perInput : [perInput];
        return items.map((category: any) => ({
          language: category.label as string,
          score: category.score as number,
        }));
      }),
    };
  }

  if (Array.isArray(result[0])) {
    return {
      languages: result[0].map((category) => ({
        language: category.label,
        score: category.score,
      })),
    };
  }

  return {
    languages: (result as TextClassificationOutput).map((category) => ({
      language: category.label,
      score: category.score,
    })),
  };
};
