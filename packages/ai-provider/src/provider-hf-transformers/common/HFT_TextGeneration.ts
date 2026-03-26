/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextGenerationOutput, TextGenerationPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, loadTransformersSDK } from "./HFT_Pipeline";
import {
  createStreamEventQueue,
  createStreamingTextStreamer,
  createTextStreamer,
} from "./HFT_Streaming";
import { extractGeneratedText } from "./HFT_TextOutput";

/**
 * Core implementation for text generation using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const logger = getLogger();
  const timerLabel = `hft:TextGeneration:${model?.provider_config.model_path}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  const isArrayInput = Array.isArray(input.prompt);

  const generateText: TextGenerationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const { TextStreamer } = await loadTransformersSDK();

  logger.debug("HFT TextGeneration: pipeline ready, generating text", {
    model: model?.provider_config.model_path,
    promptLength: isArrayInput ? (input.prompt as string[]).length : input.prompt?.length,
  });

  const streamer = isArrayInput
    ? undefined
    : createTextStreamer(generateText.tokenizer, onProgress, TextStreamer, signal);

  let results = await generateText(input.prompt as any, {
    ...(streamer ? { streamer } : {}),
  });

  if (isArrayInput) {
    // Batch result: results is an array, one entry per prompt
    const batchResults = Array.isArray(results) ? results : [results];
    const texts = batchResults.map((r) => {
      const seqs = Array.isArray(r) ? r : [r];
      return extractGeneratedText((seqs[0] as TextGenerationOutput[number])?.generated_text);
    });
    logger.timeEnd(timerLabel, { batchSize: texts.length });
    return { text: texts };
  }

  if (!Array.isArray(results)) {
    results = [results];
  }
  const text = extractGeneratedText((results[0] as TextGenerationOutput[number])?.generated_text);
  logger.timeEnd(timerLabel, { outputLength: text?.length });
  return {
    text,
  };
};

export const HFT_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const noopProgress = () => {};
  const generateText: TextGenerationPipeline = await getPipeline(model!, noopProgress, {}, signal);
  const { TextStreamer } = await loadTransformersSDK();

  const queue = createStreamEventQueue<StreamEvent<TextGenerationTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateText.tokenizer, queue, TextStreamer, signal);

  const pipelinePromise = generateText(input.prompt as string, {
    streamer,
  }).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};
