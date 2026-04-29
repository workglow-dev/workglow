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

import type { GeminiModelConfig } from "./Gemini_ModelSchema";
import { getApiKey, getModelName, loadGeminiSDK } from "./Gemini_Client";

function modelIdOf(model: ModelConfig | undefined): string {
  return (
    model?.model_id ??
    (model?.provider_config as { model_name?: string } | undefined)?.model_name ??
    "gemini"
  );
}

/** Decode a base64 inline image part into a GpuImage. */
async function decodeInlineImage(mimeType: string, data: string) {
  return GpuImageFactory.fromDataUri(`data:${mimeType};base64,${data}`);
}

/**
 * Encode a GpuImage (or a data URI string materialized at the worker boundary)
 * as base64 PNG for use in an inlineData Part.
 */
async function gpuImageToInlinePart(
  image: GpuImage | string,
): Promise<{ inlineData: { mimeType: string; data: string } }> {
  if (typeof image === "string") {
    // Data URI materialized by AiImageOutputTask.getJobInput — extract base64 directly.
    const base64 = image.replace(/^data:[^;]+;base64,/, "");
    return { inlineData: { mimeType: "image/png", data: base64 } };
  }
  const bytes: Uint8Array = await image.encode("png");
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return { inlineData: { mimeType: "image/png", data: base64 } };
}

/** Non-streaming path. */
export const Gemini_EditImage: AiProviderRunFn<
  EditImageTaskInput,
  EditImageTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timer = `gemini:EditImage:${modelIdOf(model)}`;
  logger.time(timer, { model: modelIdOf(model) });
  update_progress(0, "Starting Gemini image edit");

  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const modelName = getModelName(model);
  const genModel = genAI.getGenerativeModel({ model: modelName });

  // image/additionalImages may be data URI strings when the input crossed
  // the worker boundary via AiImageOutputTask.getJobInput materialization.
  const primaryPart = await gpuImageToInlinePart(input.image as unknown as GpuImage | string);

  const additionalParts: Array<{ inlineData: { mimeType: string; data: string } }> =
    input.additionalImages && (input.additionalImages as Array<GpuImage | string>).length > 0
      ? await Promise.all(
          (input.additionalImages as Array<GpuImage | string>).map((g) => gpuImageToInlinePart(g)),
        )
      : [];

  const parts: Array<any> = [
    { text: input.prompt },
    primaryPart,
    ...additionalParts,
  ];

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
    update_progress(100, "Completed Gemini image edit");
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
 * One-shot stream wrapper. Gemini does not support partial image streaming,
 * so we call the non-streaming run function, yield one snapshot, then finish.
 */
export const Gemini_EditImage_Stream: AiProviderStreamFn<
  EditImageTaskInput,
  EditImageTaskOutput,
  GeminiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<EditImageTaskOutput>> {
  const noop = () => {};
  const result = await Gemini_EditImage(input, model, noop, signal);
  yield { type: "snapshot", data: result } as StreamEvent<EditImageTaskOutput>;
  yield { type: "finish", data: {} as EditImageTaskOutput };
};
