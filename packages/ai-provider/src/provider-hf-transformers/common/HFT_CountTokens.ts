/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderReactiveRunFn,
  AiProviderRunFn,
  CountTokensTaskInput,
  CountTokensTaskOutput,
} from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { loadTransformersSDK } from "./HFT_Pipeline";

export const HFT_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, _signal) => {
  const isArrayInput = Array.isArray(input.text);

  const { AutoTokenizer } = await loadTransformersSDK();
  const tokenizer = await AutoTokenizer.from_pretrained(model!.provider_config.model_path, {
    progress_callback: (progress: any) => onProgress(progress?.progress ?? 0),
  });

  if (isArrayInput) {
    const texts = input.text as string[];
    const counts = texts.map((t) => tokenizer.encode(t).length);
    return { count: counts };
  }

  // encode() returns number[] of token IDs for a single input string
  const tokenIds = tokenizer.encode(input.text as string);
  return { count: tokenIds.length };
};

export const HFT_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, _output, model) => {
  return HFT_CountTokens(input, model, () => {}, new AbortController().signal);
};
