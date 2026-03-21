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
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";

export const Gemini_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  GeminiModelConfig
> = async (input, model, onProgress, signal) => {
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "Gemini_CountTokens: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const counts: number[] = [];
    for (const item of texts) {
      const r = await Gemini_CountTokens({ ...input, text: item }, model, onProgress, signal);
      counts.push(r.count as number);
    }
    return { count: counts };
  }

  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({ model: getModelName(model) });
  const result = await genModel.countTokens(input.text as string);
  return { count: result.totalTokens };
};

export const Gemini_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  GeminiModelConfig
> = async (input, _output, _model) => {
  if (Array.isArray(input.text)) {
    return { count: (input.text as string[]).map((t) => Math.ceil(t.length / 4)) };
  }
  return { count: Math.ceil((input.text as string).length / 4) };
};
