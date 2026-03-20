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
import { getLogger } from "@workglow/util";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { getOrLoadModel } from "./LlamaCpp_Runtime";

export const LlamaCpp_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  LlamaCppModelConfig
> = async (input, model, onProgress, signal) => {
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "LlamaCpp_CountTokens: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const counts: number[] = [];
    for (const item of texts) {
      const r = await LlamaCpp_CountTokens({ ...input, text: item }, model, onProgress, signal);
      counts.push(r.count as number);
    }
    return { count: counts };
  }

  const loadedModel = await getOrLoadModel(model!);
  const tokens = loadedModel.tokenizer(input.text as string);
  return { count: tokens.length };
};

export const LlamaCpp_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  LlamaCppModelConfig
> = async (input, _output, model) => {
  return LlamaCpp_CountTokens(input, model, () => {}, new AbortController().signal);
};
