/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  AiProviderRunFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
} from "@workglow/ai";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

function getClient(model: AnthropicModelConfig | undefined): Anthropic {
  const apiKey =
    model?.provider_config?.api_key ||
    (typeof process !== "undefined" ? process.env?.ANTHROPIC_API_KEY : undefined);
  if (!apiKey) {
    throw new Error(
      "Missing Anthropic API key: set provider_config.api_key or the ANTHROPIC_API_KEY environment variable."
    );
  }
  return new Anthropic({
    apiKey,
    baseURL: model?.provider_config?.base_url || undefined,
    dangerouslyAllowBrowser: true,
  });
}

function getModelName(model: AnthropicModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

function getMaxTokens(
  input: { maxTokens?: number },
  model: AnthropicModelConfig | undefined
): number {
  return input.maxTokens ?? model?.provider_config?.max_tokens ?? 1024;
}

export const Anthropic_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Anthropic text generation");
  const client = getClient(model);
  const modelName = getModelName(model);

  const response = await client.messages.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      max_tokens: getMaxTokens(input, model),
      temperature: input.temperature,
      top_p: input.topP,
    },
    { signal }
  );

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  update_progress(100, "Completed Anthropic text generation");
  return { text };
};

export const Anthropic_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Anthropic text rewriting");
  const client = getClient(model);
  const modelName = getModelName(model);

  const response = await client.messages.create(
    {
      model: modelName,
      system: input.prompt,
      messages: [{ role: "user", content: input.text }],
      max_tokens: getMaxTokens({}, model),
    },
    { signal }
  );

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  update_progress(100, "Completed Anthropic text rewriting");
  return { text };
};

export const Anthropic_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Anthropic text summarization");
  const client = getClient(model);
  const modelName = getModelName(model);

  const response = await client.messages.create(
    {
      model: modelName,
      system: "Summarize the following text concisely.",
      messages: [{ role: "user", content: input.text }],
      max_tokens: getMaxTokens({}, model),
    },
    { signal }
  );

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  update_progress(100, "Completed Anthropic text summarization");
  return { text };
};

export const ANTHROPIC_TASKS: Record<string, AiProviderRunFn<any, any, AnthropicModelConfig>> = {
  TextGenerationTask: Anthropic_TextGeneration,
  TextRewriterTask: Anthropic_TextRewriter,
  TextSummaryTask: Anthropic_TextSummary,
};
