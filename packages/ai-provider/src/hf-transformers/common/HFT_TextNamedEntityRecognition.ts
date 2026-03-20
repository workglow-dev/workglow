/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  TokenClassificationOutput,
  TokenClassificationPipeline,
} from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  TextNamedEntityRecognitionTaskInput,
  TextNamedEntityRecognitionTaskOutput,
} from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

export const HFT_TextNamedEntityRecognition: AiProviderRunFn<
  TextNamedEntityRecognitionTaskInput,
  TextNamedEntityRecognitionTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  const textNamedEntityRecognition: TokenClassificationPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );
  const results = await textNamedEntityRecognition(input.text as any, {
    ignore_labels: input.blockList as string[] | undefined,
  });

  if (isArrayInput) {
    return {
      entities: (results as unknown as TokenClassificationOutput[]).map((perInput) => {
        const items = Array.isArray(perInput) ? perInput : [perInput];
        return items.map((entity) => ({
          entity: entity.entity,
          score: entity.score,
          word: entity.word,
        }));
      }),
    };
  }

  let entities: TokenClassificationOutput = [];
  if (!Array.isArray(results)) {
    entities = [results];
  } else {
    entities = results as TokenClassificationOutput;
  }
  return {
    entities: entities.map((entity) => ({
      entity: entity.entity,
      score: entity.score,
      word: entity.word,
    })),
  };
};
