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
import { getClient, getModelName } from "./Anthropic_Client";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

export const Anthropic_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  AnthropicModelConfig
> = async (input, model, onProgress, signal) => {
  const client = await getClient(model);
  const result = await client.messages.countTokens({
    model: getModelName(model),
    messages: [{ role: "user", content: input.text }],
  });
  return { count: result.input_tokens };
};

export const Anthropic_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  AnthropicModelConfig
> = async (input, _output, _model) => {
  return { count: Math.ceil(input.text.length / 4) };
};
