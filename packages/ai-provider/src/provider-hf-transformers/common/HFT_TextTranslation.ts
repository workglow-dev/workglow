/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TranslationOutput, TranslationPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, loadTransformersSDK } from "./HFT_Pipeline";
import {
  createStreamEventQueue,
  createStreamingTextStreamer,
  createTextStreamer,
} from "./HFT_Streaming";

/**
 * Core implementation for text translation using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextTranslation: AiProviderRunFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  const translate: TranslationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const { TextStreamer } = await loadTransformersSDK();
  const streamer = isArrayInput
    ? undefined
    : createTextStreamer(translate.tokenizer, onProgress, TextStreamer);

  const result = await translate(
    input.text as any,
    {
      src_lang: input.source_lang,
      tgt_lang: input.target_lang,
      ...(streamer ? { streamer } : {}),
    } as any
  );

  if (isArrayInput) {
    const batchResults = Array.isArray(result) ? result : [result];
    return {
      text: batchResults.map((r) => (r as TranslationOutput[number])?.translation_text || ""),
      target_lang: input.target_lang,
    };
  }

  const translatedText = Array.isArray(result)
    ? (result[0] as TranslationOutput[number])?.translation_text || ""
    : (result as TranslationOutput[number])?.translation_text || "";

  return {
    text: translatedText,
    target_lang: input.target_lang,
  };
};

export const HFT_TextTranslation_Stream: AiProviderStreamFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextTranslationTaskOutput>> {
  const noopProgress = () => {};
  const translate: TranslationPipeline = await getPipeline(model!, noopProgress, {}, signal);
  const { TextStreamer } = await loadTransformersSDK();

  const queue = createStreamEventQueue<StreamEvent<TextTranslationTaskOutput>>();
  const streamer = createStreamingTextStreamer(translate.tokenizer, queue, TextStreamer);

  const pipelinePromise = translate(
    input.text as string,
    {
      src_lang: input.source_lang,
      tgt_lang: input.target_lang,
      streamer,
    } as any
  ).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;
  yield { type: "finish", data: { target_lang: input.target_lang } as TextTranslationTaskOutput };
};
