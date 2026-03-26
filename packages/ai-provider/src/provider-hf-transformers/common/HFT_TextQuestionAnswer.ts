/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DocumentQuestionAnsweringOutput,
  QuestionAnsweringPipeline,
} from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
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
 * Core implementation for question answering using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextQuestionAnswer: AiProviderRunFn<
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.question);

  // Get the question answering pipeline
  const generateAnswer: QuestionAnsweringPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );

  if (isArrayInput) {
    const questions = input.question as string[];
    const contexts = input.context as string[];
    if (questions.length !== contexts.length) {
      throw new Error(
        `question[] and context[] must have the same length: ${questions.length} != ${contexts.length}`
      );
    }

    const answers: string[] = [];
    for (let i = 0; i < questions.length; i++) {
      if (signal.aborted) {
        throw new DOMException("Generation aborted", "AbortError");
      }
      const result = await generateAnswer(questions[i], contexts[i], {} as any);
      let answerText = "";
      if (Array.isArray(result)) {
        answerText = (result[0] as DocumentQuestionAnsweringOutput[number])?.answer || "";
      } else {
        answerText = (result as DocumentQuestionAnsweringOutput[number])?.answer || "";
      }
      answers.push(answerText);
    }

    return { text: answers };
  }

  const { TextStreamer } = await loadTransformersSDK();
  const streamer = createTextStreamer(generateAnswer.tokenizer, onProgress, TextStreamer, signal);

  const result = await generateAnswer(
    input.question as string,
    input.context as string,
    {
      streamer,
    } as any
  );

  let answerText = "";
  if (Array.isArray(result)) {
    answerText = (result[0] as DocumentQuestionAnsweringOutput[number])?.answer || "";
  } else {
    answerText = (result as DocumentQuestionAnsweringOutput[number])?.answer || "";
  }

  return {
    text: answerText,
  };
};

export const HFT_TextQuestionAnswer_Stream: AiProviderStreamFn<
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextQuestionAnswerTaskOutput>> {
  const noopProgress = () => {};
  const generateAnswer: QuestionAnsweringPipeline = await getPipeline(
    model!,
    noopProgress,
    {},
    signal
  );
  const { TextStreamer } = await loadTransformersSDK();

  const queue = createStreamEventQueue<StreamEvent<TextQuestionAnswerTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateAnswer.tokenizer, queue, TextStreamer, signal);

  let pipelineResult:
    | DocumentQuestionAnsweringOutput[number]
    | DocumentQuestionAnsweringOutput
    | undefined;
  const pipelinePromise = generateAnswer(
    input.question as string,
    input.context as string,
    {
      streamer,
    } as any
  ).then(
    (result) => {
      pipelineResult = result;
      queue.done();
    },
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;

  let answerText = "";
  if (pipelineResult !== undefined) {
    if (Array.isArray(pipelineResult)) {
      answerText = (pipelineResult[0] as DocumentQuestionAnsweringOutput[number])?.answer ?? "";
    } else {
      answerText = (pipelineResult as DocumentQuestionAnsweringOutput[number])?.answer ?? "";
    }
  }
  yield { type: "finish", data: { text: answerText } as TextQuestionAnswerTaskOutput };
};
