/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, AiProviderStreamFn, TextSummaryTaskInput, TextSummaryTaskOutput } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";
import { getClient, getMaxTokens, getModelName } from "./Anthropic_Client";

export const Anthropic_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "Anthropic_TextSummary: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const results: string[] = [];
    for (const item of texts) {
      const r = await Anthropic_TextSummary(
        { ...input, text: item },
        model,
        update_progress,
        signal
      );
      results.push(r.text as string);
    }
    return { text: results };
  }

  update_progress(0, "Starting Anthropic text summarization");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.messages.create(
    {
      model: modelName,
      system: "Summarize the following text concisely.",
      messages: [{ role: "user", content: input.text as string }],
      max_tokens: getMaxTokens({}, model),
    },
    { signal }
  );

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  update_progress(100, "Completed Anthropic text summarization");
  return { text };
};

export const Anthropic_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  AnthropicModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = client.messages.stream(
    {
      model: modelName,
      system: "Summarize the following text concisely.",
      messages: [{ role: "user", content: input.text as string }],
      max_tokens: getMaxTokens({}, model),
    },
    { signal }
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text-delta", port: "text", textDelta: event.delta.text };
    }
  }
  yield { type: "finish", data: {} as TextSummaryTaskOutput };
};
