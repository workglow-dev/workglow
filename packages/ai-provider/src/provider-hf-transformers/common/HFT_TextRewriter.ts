/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextGenerationOutput, TextGenerationPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, loadTransformersSDK } from "./HFT_Pipeline";
import {
  createStreamEventQueue,
  createStreamingTextStreamer,
  createTextStreamer,
} from "./HFT_Streaming";
import { extractGeneratedText } from "./HFT_TextOutput";

/**
 * Core implementation for text rewriting using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  const generateText: TextGenerationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const { TextStreamer } = await loadTransformersSDK();
  const streamer = isArrayInput
    ? undefined
    : createTextStreamer(generateText.tokenizer, onProgress, TextStreamer);

  if (isArrayInput) {
    const texts = input.text as string[];
    const promptedTexts = texts.map((t) => (input.prompt ? input.prompt + "\n" : "") + t);

    let results = await generateText(promptedTexts, {});

    const batchResults = Array.isArray(results) ? results : [results];
    const outputTexts = batchResults.map((r, i) => {
      const seqs = Array.isArray(r) ? r : [r];
      const text = extractGeneratedText((seqs[0] as TextGenerationOutput[number])?.generated_text);
      if (text === promptedTexts[i]) {
        throw new Error("Rewriter failed to generate new text");
      }
      return text;
    });

    return { text: outputTexts };
  }

  // This lib doesn't support this kind of rewriting with a separate prompt vs text
  const promptedText = (input.prompt ? input.prompt + "\n" : "") + input.text;

  let results = await generateText(promptedText, {
    ...(streamer ? { streamer } : {}),
  });

  if (!Array.isArray(results)) {
    results = [results];
  }

  const text = extractGeneratedText((results[0] as TextGenerationOutput[number])?.generated_text);

  if (text === promptedText) {
    throw new Error("Rewriter failed to generate new text");
  }

  return {
    text,
  };
};

export const HFT_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const noopProgress = () => {};
  const generateText: TextGenerationPipeline = await getPipeline(model!, noopProgress, {}, signal);
  const { TextStreamer } = await loadTransformersSDK();

  const queue = createStreamEventQueue<StreamEvent<TextRewriterTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateText.tokenizer, queue, TextStreamer);

  const promptedText = (input.prompt ? input.prompt + "\n" : "") + (input.text as string);

  const pipelinePromise = generateText(promptedText, {
    streamer,
  }).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;
  yield { type: "finish", data: {} as TextRewriterTaskOutput };
};
