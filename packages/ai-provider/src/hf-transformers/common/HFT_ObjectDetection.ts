/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ObjectDetectionPipeline,
  ZeroShotObjectDetectionPipeline,
} from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
} from "@workglow/ai";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline } from "./HFT_Pipeline";

/**
 * Core implementation for object detection using Hugging Face Transformers.
 * Auto-selects between regular and zero-shot detection.
 */
export const HFT_ObjectDetection: AiProviderRunFn<
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  if (model?.provider_config?.pipeline === "zero-shot-object-detection") {
    if (!input.labels || !Array.isArray(input.labels) || input.labels.length === 0) {
      throw new Error("Zero-shot object detection requires labels");
    }
    const zeroShotDetector: ZeroShotObjectDetectionPipeline = await getPipeline(
      model!,
      onProgress,
      {},
      signal
    );
    const result: any = await zeroShotDetector(input.image as string, Array.from(input.labels!), {
      threshold: (input as any).threshold,
    });

    const detections = Array.isArray(result) ? result : [result];

    return {
      detections: detections.map((d: any) => ({
        label: d.label,
        score: d.score,
        box: d.box,
      })),
    };
  }

  const detector: ObjectDetectionPipeline = await getPipeline(model!, onProgress, {}, signal);
  const result: any = await detector(input.image as string, {
    threshold: (input as any).threshold,
  });

  const detections = Array.isArray(result) ? result : [result];

  return {
    detections: detections.map((d: any) => ({
      label: d.label,
      score: d.score,
      box: d.box,
    })),
  };
};
