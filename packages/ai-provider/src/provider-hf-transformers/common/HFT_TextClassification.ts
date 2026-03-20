/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  TextClassificationOutput,
  TextClassificationPipeline,
  ZeroShotClassificationPipeline,
} from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
} from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

export const HFT_TextClassification: AiProviderRunFn<
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  if (model?.provider_config?.pipeline === "zero-shot-classification") {
    if (
      !input.candidateLabels ||
      !Array.isArray(input.candidateLabels) ||
      input.candidateLabels.length === 0
    ) {
      throw new Error("Zero-shot text classification requires candidate labels");
    }

    const zeroShotClassifier: ZeroShotClassificationPipeline = await getPipeline(
      model!,
      onProgress,
      {},
      signal
    );
    const result: any = await zeroShotClassifier(
      input.text as any,
      input.candidateLabels as string[],
      {}
    );

    if (isArrayInput) {
      // Batch result: result is an array of { labels, scores } per input
      const results = Array.isArray(result) && Array.isArray(result[0]?.labels) ? result : [result];
      return {
        categories: results.map((r: any) =>
          r.labels.map((label: string, idx: number) => ({
            label,
            score: r.scores[idx],
          }))
        ),
      };
    }

    return {
      categories: result.labels.map((label: string, idx: number) => ({
        label,
        score: result.scores[idx],
      })),
    };
  }

  const TextClassification: TextClassificationPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );
  const result = await TextClassification(input.text as any, {
    top_k: input.maxCategories || undefined,
  });

  if (isArrayInput) {
    // Batch result: outer array per input, inner array of categories
    return {
      categories: (result as any[]).map((perInput: any) => {
        const items = Array.isArray(perInput) ? perInput : [perInput];
        return items.map((category: any) => ({
          label: category.label as string,
          score: category.score as number,
        }));
      }),
    };
  }

  if (Array.isArray(result[0])) {
    return {
      categories: result[0].map((category) => ({
        label: category.label,
        score: category.score,
      })),
    };
  }

  return {
    categories: (result as TextClassificationOutput).map((category) => ({
      label: category.label,
      score: category.score,
    })),
  };
};
