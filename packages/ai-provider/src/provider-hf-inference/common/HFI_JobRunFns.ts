/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";
import { HFI_ModelSearch } from "./HFI_ModelSearch";

export { loadHfInferenceSDK, getClient, getModelName, getProvider } from "./HFI_Client";

import { HFI_EditImage, HFI_EditImage_Stream } from "./HFI_EditImage";
import { HFI_GenerateImage, HFI_GenerateImage_Stream } from "./HFI_GenerateImage";
import { HFI_ModelInfo } from "./HFI_ModelInfo";
import { HFI_TextEmbedding } from "./HFI_TextEmbedding";
import { HFI_TextGeneration, HFI_TextGeneration_Stream } from "./HFI_TextGeneration";
import { HFI_TextRewriter, HFI_TextRewriter_Stream } from "./HFI_TextRewriter";
import { HFI_TextSummary, HFI_TextSummary_Stream } from "./HFI_TextSummary";
import { HFI_ToolCalling, HFI_ToolCalling_Stream } from "./HFI_ToolCalling";

export const HFI_TASKS: Record<string, AiProviderRunFn<any, any, HfInferenceModelConfig>> = {
  ModelInfoTask: HFI_ModelInfo,
  TextGenerationTask: HFI_TextGeneration,
  TextEmbeddingTask: HFI_TextEmbedding,
  TextRewriterTask: HFI_TextRewriter,
  TextSummaryTask: HFI_TextSummary,
  ToolCallingTask: HFI_ToolCalling,
  ModelSearchTask: HFI_ModelSearch,
  GenerateImageTask: HFI_GenerateImage,
  EditImageTask: HFI_EditImage,
};

export const HFI_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, HfInferenceModelConfig>
> = {
  TextGenerationTask: HFI_TextGeneration_Stream,
  TextRewriterTask: HFI_TextRewriter_Stream,
  TextSummaryTask: HFI_TextSummary_Stream,
  ToolCallingTask: HFI_ToolCalling_Stream,
  GenerateImageTask: HFI_GenerateImage_Stream,
  EditImageTask: HFI_EditImage_Stream,
};
