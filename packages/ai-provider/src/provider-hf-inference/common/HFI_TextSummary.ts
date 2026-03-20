/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, AiProviderStreamFn, TextSummaryTaskInput, TextSummaryTaskOutput } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";
import { getClient, getModelName, getProvider } from "./HFI_Client";

export const HFI_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "HFI_TextSummary: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const results: string[] = [];
    for (const item of texts) {
      const r = await HFI_TextSummary({ ...input, text: item }, model, update_progress, signal);
      results.push(r.text as string);
    }
    return { text: results };
  }

  update_progress(0, "Starting HF Inference text summarization");
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const response = await client.chatCompletion(
    {
      model: modelName,
      messages: [
        { role: "system", content: "Summarize the following text concisely." },
        { role: "user", content: input.text as string },
      ],
      provider,
    },
    { signal }
  );

  update_progress(100, "Completed HF Inference text summarization");
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const HFI_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  HfInferenceModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const stream = client.chatCompletionStream(
    {
      model: modelName,
      messages: [
        { role: "system", content: "Summarize the following text concisely." },
        { role: "user", content: input.text as string },
      ],
      provider,
    },
    { signal }
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      yield { type: "text-delta", port: "text", textDelta: delta };
    }
  }
  yield { type: "finish", data: {} as TextSummaryTaskOutput };
};
