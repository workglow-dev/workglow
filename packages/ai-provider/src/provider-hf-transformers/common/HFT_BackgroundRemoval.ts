/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BackgroundRemovalPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput,
} from "@workglow/ai";
import type { ImageValue } from "@workglow/util/media";
import { imageValueToBlob } from "../../common/imageOutputHelpers";
import { imageToBase64 } from "./HFT_ImageHelpers";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for background removal using Hugging Face Transformers.
 */
export const HFT_BackgroundRemoval: AiProviderRunFn<
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const remover: BackgroundRemovalPipeline = await getPipeline(model!, onProgress, {}, signal);
  const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
  const result = await remover(imageArg);

  const resultImage = Array.isArray(result) ? result[0] : result;

  return {
    image: imageToBase64(resultImage),
  };
};
