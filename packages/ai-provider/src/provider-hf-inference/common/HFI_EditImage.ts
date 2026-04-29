/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  EditImageTaskInput,
  EditImageTaskOutput,
  ModelConfig,
} from "@workglow/ai";
import { ImageGenerationContentPolicyError, ImageGenerationProviderError } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { GpuImage } from "@workglow/util/media";
import { GpuImageFactory } from "@workglow/util/media";
import { getLogger } from "@workglow/util/worker";

import type { HfInferenceModelConfig } from "./HFI_ModelSchema";
import { getClient, getModelName } from "./HFI_Client";
import { resolveHfImageDims } from "./HFI_AspectRatio";

function modelIdOf(model: ModelConfig | undefined): string {
  return (
    model?.model_id ??
    (model?.provider_config as { model_name?: string } | undefined)?.model_name ??
    "huggingface"
  );
}

/**
 * Convert a GpuImage (or a data URI string materialized at the worker boundary)
 * to a PNG Blob.
 */
async function gpuImageToBlob(image: GpuImage | string): Promise<Blob> {
  if (typeof image === "string") {
    // Data URI materialized by AiImageOutputTask.getJobInput — decode base64 to bytes.
    const base64 = image.replace(/^data:[^;]+;base64,/, "");
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" });
  }
  const bytes = await image.encode("png");
  return new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" });
}

export const HFI_EditImage: AiProviderRunFn<
  EditImageTaskInput,
  EditImageTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timer = `hfi:EditImage:${getModelName(model)}`;
  logger.time(timer);
  update_progress(0, "Starting HF image edit");

  try {
    const client = await getClient(model);
    const modelName = getModelName(model);
    const dims = resolveHfImageDims(modelName, (input.aspectRatio as any) ?? "1:1");

    // image/mask may be data URI strings when the input crossed the worker
    // boundary via AiImageOutputTask.getJobInput materialization.
    const inputBlob = await gpuImageToBlob(input.image as unknown as GpuImage | string);
    const params: Record<string, unknown> = {
      width: dims.width,
      height: dims.height,
      seed: input.seed,
      negative_prompt: input.negativePrompt,
      prompt: input.prompt,
      ...(input.providerOptions ?? {}),
    };
    if (input.mask) {
      // Validator (Task 17) rejects masks on non-inpainting models before this code runs.
      const maskBlob = await gpuImageToBlob(input.mask as unknown as GpuImage | string);
      params.mask_image = maskBlob;
    }

    const blob: Blob = await client.imageToImage(
      {
        model: modelName,
        inputs: inputBlob,
        parameters: params,
      },
      { signal },
    );
    const image = await GpuImageFactory.fromBlob(blob);
    update_progress(100, "Completed HF image edit");
    logger.timeEnd(timer);
    return { image };
  } catch (err) {
    if (
      err instanceof ImageGenerationProviderError ||
      err instanceof ImageGenerationContentPolicyError
    )
      throw err;
    const msg = err instanceof Error ? err.message : "unknown error";
    if (/NSFW|safety|policy/i.test(msg))
      throw new ImageGenerationContentPolicyError(modelIdOf(model), msg);
    throw new ImageGenerationProviderError(modelIdOf(model), msg, { cause: err as Error });
  }
};

/**
 * One-shot stream wrapper. HF Inference does not support partial image streaming,
 * so we call the non-streaming run function, yield one snapshot, then finish.
 */
export const HFI_EditImage_Stream: AiProviderStreamFn<
  EditImageTaskInput,
  EditImageTaskOutput,
  HfInferenceModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<EditImageTaskOutput>> {
  const result = await HFI_EditImage(input, model, () => {}, signal);
  if (signal.aborted) return;
  yield { type: "snapshot", data: result } as StreamEvent<EditImageTaskOutput>;
  yield { type: "finish", data: {} as EditImageTaskOutput };
};
