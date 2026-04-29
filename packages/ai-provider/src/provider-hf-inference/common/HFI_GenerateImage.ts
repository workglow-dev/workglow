/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  GenerateImageTaskInput,
  GenerateImageTaskOutput,
  ModelConfig,
} from "@workglow/ai";
import { ImageGenerationContentPolicyError, ImageGenerationProviderError } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
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

export const HFI_GenerateImage: AiProviderRunFn<
  GenerateImageTaskInput,
  GenerateImageTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timer = `hfi:GenerateImage:${getModelName(model)}`;
  logger.time(timer);
  update_progress(0, "Starting HF image generation");

  try {
    const client = await getClient(model);
    const modelName = getModelName(model);
    const dims = resolveHfImageDims(modelName, (input.aspectRatio as any) ?? "1:1");

    const blob: Blob = await client.textToImage(
      {
        model: modelName,
        inputs: input.prompt,
        parameters: {
          width: dims.width,
          height: dims.height,
          seed: input.seed,
          negative_prompt: input.negativePrompt,
          ...(input.providerOptions ?? {}),
        },
      },
      { outputType: "blob" as const },
    );
    const image = await GpuImageFactory.fromBlob(blob);
    update_progress(100, "Completed HF image generation");
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
export const HFI_GenerateImage_Stream: AiProviderStreamFn<
  GenerateImageTaskInput,
  GenerateImageTaskOutput,
  HfInferenceModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<GenerateImageTaskOutput>> {
  const result = await HFI_GenerateImage(input, model, () => {}, signal);
  if (signal.aborted) return;
  yield { type: "snapshot", data: result } as StreamEvent<GenerateImageTaskOutput>;
  yield { type: "finish", data: {} as GenerateImageTaskOutput };
};
