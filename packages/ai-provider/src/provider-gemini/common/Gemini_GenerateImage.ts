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

import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";

function modelIdOf(model: ModelConfig | undefined): string {
  return (
    model?.model_id ??
    (model?.provider_config as { model_name?: string } | undefined)?.model_name ??
    "gemini"
  );
}

/** Decode a base64 string with an explicit mime type into a GpuImage. */
async function decodeInlineImage(mimeType: string, data: string) {
  return GpuImageFactory.fromDataUri(`data:${mimeType};base64,${data}`);
}

/** Non-streaming path. */
export const Gemini_GenerateImage: AiProviderRunFn<
  GenerateImageTaskInput,
  GenerateImageTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timer = `gemini:GenerateImage:${modelIdOf(model)}`;
  logger.time(timer, { model: modelIdOf(model) });
  update_progress(0, "Starting Gemini image generation");

  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const modelName = getModelName(model);
  const genModel = genAI.getGenerativeModel({ model: modelName });

  const parts: Array<{ text: string }> = [{ text: input.prompt }];

  try {
    const result = await genModel.generateContent(
      { contents: [{ role: "user", parts }] },
      { signal } as any,
    );

    const response = result.response;

    // Check for safety blocks
    if (
      !response.candidates ||
      response.candidates.length === 0 ||
      response.promptFeedback?.blockReason
    ) {
      const reason = response.promptFeedback?.blockReason ?? "SAFETY";
      throw new ImageGenerationContentPolicyError(modelIdOf(model), `Blocked: ${reason}`);
    }

    // Find the inline image part
    const candidateParts = response.candidates[0]?.content?.parts ?? [];
    const imagePart = candidateParts.find(
      (p: any) => p.inlineData && p.inlineData.mimeType && p.inlineData.data,
    ) as { inlineData: { mimeType: string; data: string } } | undefined;

    if (!imagePart) {
      throw new ImageGenerationProviderError(
        modelIdOf(model),
        "No image part in response (Gemini did not return an inline image)",
      );
    }

    const image = await decodeInlineImage(imagePart.inlineData.mimeType, imagePart.inlineData.data);
    update_progress(100, "Completed Gemini image generation");
    logger.timeEnd(timer, { model: modelIdOf(model) });
    return { image };
  } catch (err) {
    if (
      err instanceof ImageGenerationProviderError ||
      err instanceof ImageGenerationContentPolicyError
    ) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : "unknown error";
    if (/safety|policy|moderation|blocked|SAFETY|PROHIBITED/i.test(msg)) {
      throw new ImageGenerationContentPolicyError(modelIdOf(model), msg);
    }
    throw new ImageGenerationProviderError(modelIdOf(model), msg, { cause: err as Error });
  }
};

/**
 * One-shot stream wrapper. Gemini's @google/generative-ai SDK does not support
 * partial image streaming, so we call the non-streaming run function, yield one
 * snapshot, then finish.
 */
export const Gemini_GenerateImage_Stream: AiProviderStreamFn<
  GenerateImageTaskInput,
  GenerateImageTaskOutput,
  GeminiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<GenerateImageTaskOutput>> {
  const noop = () => {};
  const result = await Gemini_GenerateImage(input, model, noop, signal);
  yield { type: "snapshot", data: result } as StreamEvent<GenerateImageTaskOutput>;
  yield { type: "finish", data: {} as GenerateImageTaskOutput };
};
