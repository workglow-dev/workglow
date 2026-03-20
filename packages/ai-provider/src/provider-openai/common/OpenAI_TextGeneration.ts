/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, AiProviderStreamFn, TextGenerationTaskInput, TextGenerationTaskOutput } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { getClient, getModelName } from "./OpenAI_Client";

export const OpenAI_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "OpenAI_TextGeneration: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const results: string[] = [];
    for (const item of prompts) {
      const r = await OpenAI_TextGeneration(
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
  const timerLabel = `openai:TextGeneration:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting OpenAI text generation");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      presence_penalty: input.presencePenalty,
    },
    { signal }
  );

  update_progress(100, "Completed OpenAI text generation");
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const OpenAI_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  OpenAiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      presence_penalty: input.presencePenalty,
      stream: true,
    },
    { signal }
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      yield { type: "text-delta", port: "text", textDelta: delta };
    }
  }
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};
