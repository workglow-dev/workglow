/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, AiProviderStreamFn, TextGenerationTaskInput, TextGenerationTaskOutput } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util/worker";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";
import { getClient, getMaxTokens, getModelName } from "./Anthropic_Client";

export const Anthropic_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "Anthropic_TextGeneration: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const results: string[] = [];
    for (const item of prompts) {
      const r = await Anthropic_TextGeneration(
        { ...input, prompt: item },
        model,
        update_progress,
        signal
      );
      results.push(r.text as string);
    }
    return { text: results };
  }

  const logger = getLogger();
  const timerLabel = `anthropic:TextGeneration:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting Anthropic text generation");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.messages.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      max_tokens: getMaxTokens(input, model),
      temperature: input.temperature,
      top_p: input.topP,
    },
    { signal }
  );

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  update_progress(100, "Completed Anthropic text generation");
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  return { text };
};

export const Anthropic_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  AnthropicModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = client.messages.stream(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      max_tokens: getMaxTokens(input, model),
      temperature: input.temperature,
      top_p: input.topP,
    },
    { signal }
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text-delta", port: "text", textDelta: event.delta.text };
    }
  }
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};
