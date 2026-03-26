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
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { getOrLoadModel } from "./LlamaCpp_Runtime";

export const LlamaCpp_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  LlamaCppModelConfig
> = async (input, model, onProgress, signal) => {
  const loadedModel = await getOrLoadModel(model!);
  const tokens = loadedModel.tokenizer(input.text);
  return { count: tokens.length };
};

export const LlamaCpp_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  LlamaCppModelConfig
> = async (input, _output, model) => {
  return LlamaCpp_CountTokens(input, model, () => {}, new AbortController().signal);
};
