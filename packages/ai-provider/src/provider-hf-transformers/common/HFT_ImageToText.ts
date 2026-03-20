/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageToTextPipeline } from "@huggingface/transformers";
import type { AiProviderRunFn, ImageToTextTaskInput, ImageToTextTaskOutput } from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for image to text using Hugging Face Transformers.
 */
export const HFT_ImageToText: AiProviderRunFn<
  ImageToTextTaskInput,
  ImageToTextTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const captioner: ImageToTextPipeline = await getPipeline(model!, onProgress, {}, signal);

  const result: any = await captioner(input.image as string, {
    max_new_tokens: input.maxTokens,
  });

  const text = Array.isArray(result) ? result[0]?.generated_text : result?.generated_text;

  return {
    text: text || "",
  };
};
