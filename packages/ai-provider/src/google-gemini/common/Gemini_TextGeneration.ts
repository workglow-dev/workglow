/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, AiProviderStreamFn, TextGenerationTaskInput, TextGenerationTaskOutput } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";

export const Gemini_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "Gemini_TextGeneration: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const results: string[] = [];
    for (const item of prompts) {
      const r = await Gemini_TextGeneration(
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
  const timerLabel = `gemini:TextGeneration:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting Gemini text generation");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
      topP: input.topP,
    },
  });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: input.prompt as string }] }],
  });

  const text = result.response.text();
  update_progress(100, "Completed Gemini text generation");
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  return { text };
};

export const Gemini_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  GeminiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
      topP: input.topP,
    },
  });

  const result = await genModel.generateContentStream(
    { contents: [{ role: "user", parts: [{ text: input.prompt as string }] }] },
    { signal }
  );

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield { type: "text-delta", port: "text", textDelta: text };
    }
  }
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};
