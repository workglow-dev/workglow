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
import { getLogger } from "@workglow/util/worker";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";
import { getClient, getModelName } from "./Anthropic_Client";

export const Anthropic_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  AnthropicModelConfig
> = async (input, model, onProgress, signal) => {
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "Anthropic_CountTokens: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const counts: number[] = [];
    for (const item of texts) {
      const r = await Anthropic_CountTokens({ ...input, text: item }, model, onProgress, signal);
      counts.push(r.count as number);
    }
    return { count: counts };
  }

  const client = await getClient(model);
  const result = await client.messages.countTokens({
    model: getModelName(model),
    messages: [{ role: "user", content: input.text as string }],
  });
  return { count: result.input_tokens };
};

export const Anthropic_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  AnthropicModelConfig
> = async (input, _output, _model) => {
  if (Array.isArray(input.text)) {
    return { count: (input.text as string[]).map((t) => Math.ceil(t.length / 4)) };
  }
  return { count: Math.ceil((input.text as string).length / 4) };
};
