/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Message,
  TextGenerationOutput,
  TextGenerationPipeline,
} from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { parsePartialJson } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, loadTransformersSDK } from "./HFT_Pipeline";
import {
  createStreamEventQueue,
  createStreamingTextStreamer,
  createTextStreamer,
} from "./HFT_Streaming";
import { extractGeneratedText } from "./HFT_TextOutput";

function buildStructuredGenerationPrompt(input: StructuredGenerationTaskInput): string {
  const schemaStr = JSON.stringify(input.outputSchema, null, 2);
  return (
    `${input.prompt}\n\n` +
    `You MUST respond with ONLY a valid JSON object conforming to this JSON schema:\n${schemaStr}\n\n` +
    `Output ONLY the JSON object, no other text.`
  );
}

function extractJsonFromText(text: string): Record<string, unknown> {
  // Try parsing directly first
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON object from the text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return (parsePartialJson(match[0]) as Record<string, unknown>) ?? {};
      }
    }
    return {};
  }
}

export const HFT_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const generateText: TextGenerationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const { TextStreamer } = await loadTransformersSDK();

  const prompt = buildStructuredGenerationPrompt(input);

  const messages: Message[] = [{ role: "user", content: prompt }];

  const formattedPrompt = (generateText.tokenizer as any).apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
  }) as string;

  const streamer = createTextStreamer(generateText.tokenizer, onProgress, TextStreamer, signal);

  let results = await generateText(formattedPrompt, {
    max_new_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? undefined,
    return_full_text: false,
    streamer,
  });

  if (!Array.isArray(results)) {
    results = [results];
  }

  const responseText = extractGeneratedText(
    (results[0] as TextGenerationOutput[number])?.generated_text
  ).trim();

  const object = extractJsonFromText(responseText);
  return { object };
};

export const HFT_StructuredGeneration_Stream: AiProviderStreamFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<StructuredGenerationTaskOutput>> {
  const noopProgress = () => {};
  const generateText: TextGenerationPipeline = await getPipeline(model!, noopProgress, {}, signal);
  const { TextStreamer } = await loadTransformersSDK();

  const prompt = buildStructuredGenerationPrompt(input);

  const messages: Message[] = [{ role: "user", content: prompt }];

  const formattedPrompt = (generateText.tokenizer as any).apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
  }) as string;

  const queue = createStreamEventQueue<StreamEvent<StructuredGenerationTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateText.tokenizer, queue, TextStreamer, signal);

  let fullText = "";

  const originalPush = queue.push;
  queue.push = (event: StreamEvent<StructuredGenerationTaskOutput>) => {
    if (event.type === "text-delta" && "textDelta" in event) {
      fullText += (event as any).textDelta;
      // Try to parse partial JSON and emit object-delta
      const match = fullText.match(/\{[\s\S]*/);
      if (match) {
        const partial = parsePartialJson(match[0]);
        if (partial !== undefined) {
          originalPush({
            type: "object-delta",
            port: "object",
            objectDelta: partial,
          } as StreamEvent<StructuredGenerationTaskOutput>);
          return;
        }
      }
    }
    originalPush(event);
  };

  const pipelinePromise = generateText(formattedPrompt, {
    max_new_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? undefined,
    return_full_text: false,
    streamer,
  }).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;

  const object = extractJsonFromText(fullText);
  yield { type: "finish", data: { object } as StructuredGenerationTaskOutput };
};
