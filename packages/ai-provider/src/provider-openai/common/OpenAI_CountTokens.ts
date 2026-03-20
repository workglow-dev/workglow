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
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { getModelName } from "./OpenAI_Client";

let _tiktoken: typeof import("tiktoken") | undefined;

async function loadTiktoken() {
  if (!_tiktoken) {
    try {
      _tiktoken = await import("tiktoken");
    } catch {
      throw new Error(
        "tiktoken is required for OpenAI token counting. Install it with: bun add tiktoken"
      );
    }
  }
  return _tiktoken;
}

const _encoderCache = new Map<string, ReturnType<typeof import("tiktoken").get_encoding>>();

async function getEncoder(modelName: string) {
  const tiktoken = await loadTiktoken();
  if (!_encoderCache.has(modelName)) {
    try {
      _encoderCache.set(
        modelName,
        tiktoken.encoding_for_model(modelName as Parameters<typeof tiktoken.encoding_for_model>[0])
      );
    } catch {
      const fallback = "cl100k_base";
      if (!_encoderCache.has(fallback)) {
        _encoderCache.set(fallback, tiktoken.get_encoding(fallback));
      }
      _encoderCache.set(modelName, _encoderCache.get(fallback)!);
    }
  }
  return _encoderCache.get(modelName)!;
}

export const OpenAI_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  OpenAiModelConfig
> = async (input, model) => {
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "OpenAI_CountTokens: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const counts: number[] = [];
    for (const item of texts) {
      const r = await OpenAI_CountTokens(
        { ...input, text: item },
        model,
        () => {},
        new AbortController().signal
      );
      counts.push(r.count as number);
    }
    return { count: counts };
  }

  const enc = await getEncoder(getModelName(model));
  const tokens = enc.encode(input.text as string);
  return { count: tokens.length };
};

export const OpenAI_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  OpenAiModelConfig
> = async (input, _output, model) => {
  return OpenAI_CountTokens(input, model, () => {}, new AbortController().signal);
};
