/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageSegmentationPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
} from "@workglow/ai";
import type { ImageBinary } from "@workglow/util/media";
import { imageBinaryToBlob } from "@workglow/util/media";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for image segmentation using Hugging Face Transformers.
 */
export const HFT_ImageSegmentation: AiProviderRunFn<
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const segmenter: ImageSegmentationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const imageArg = await imageBinaryToBlob(input.image as unknown as ImageBinary);
  const result = await segmenter(imageArg, {
    threshold: input.threshold,
    mask_threshold: input.maskThreshold,
  });

  const masks = Array.isArray(result) ? result : [result];

  const processedMasks = await Promise.all(
    masks.map(async (mask) => ({
      label: mask.label || "",
      score: mask.score || 0,
      mask: {} as { [x: string]: unknown },
    }))
  );

  return {
    masks: processedMasks,
  };
};
