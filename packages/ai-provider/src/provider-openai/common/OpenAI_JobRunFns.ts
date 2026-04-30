/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderPreviewRunFn, AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";
import { OpenAI_ModelSearch } from "./OpenAI_ModelSearch";

export { loadOpenAISDK, getClient, getModelName } from "./OpenAI_Client";

import { OpenAI_Chat, OpenAI_Chat_Stream } from "./OpenAI_Chat";
import { OpenAI_CountTokens, OpenAI_CountTokens_Preview } from "./OpenAI_CountTokens";
import { OpenAI_ModelInfo } from "./OpenAI_ModelInfo";
import {
  OpenAI_StructuredGeneration,
  OpenAI_StructuredGeneration_Stream,
} from "./OpenAI_StructuredGeneration";
import { OpenAI_TextEmbedding } from "./OpenAI_TextEmbedding";
import { OpenAI_TextGeneration, OpenAI_TextGeneration_Stream } from "./OpenAI_TextGeneration";
import { OpenAI_TextRewriter, OpenAI_TextRewriter_Stream } from "./OpenAI_TextRewriter";
import { OpenAI_TextSummary, OpenAI_TextSummary_Stream } from "./OpenAI_TextSummary";
import { OpenAI_ToolCalling, OpenAI_ToolCalling_Stream } from "./OpenAI_ToolCalling";
import { OpenAI_GenerateImage, OpenAI_GenerateImage_Stream } from "./OpenAI_GenerateImage";
import { OpenAI_EditImage, OpenAI_EditImage_Stream } from "./OpenAI_EditImage";

export const OPENAI_TASKS: Record<string, AiProviderRunFn<any, any, OpenAiModelConfig>> = {
  AiChatTask: OpenAI_Chat,
  TextGenerationTask: OpenAI_TextGeneration,
  ModelInfoTask: OpenAI_ModelInfo,
  TextEmbeddingTask: OpenAI_TextEmbedding,
  TextRewriterTask: OpenAI_TextRewriter,
  TextSummaryTask: OpenAI_TextSummary,
  CountTokensTask: OpenAI_CountTokens,
  StructuredGenerationTask: OpenAI_StructuredGeneration,
  ToolCallingTask: OpenAI_ToolCalling,
  ModelSearchTask: OpenAI_ModelSearch,
  GenerateImageTask: OpenAI_GenerateImage,
  EditImageTask: OpenAI_EditImage,
};

export const OPENAI_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, OpenAiModelConfig>
> = {
  AiChatTask: OpenAI_Chat_Stream,
  TextGenerationTask: OpenAI_TextGeneration_Stream,
  TextRewriterTask: OpenAI_TextRewriter_Stream,
  TextSummaryTask: OpenAI_TextSummary_Stream,
  StructuredGenerationTask: OpenAI_StructuredGeneration_Stream,
  ToolCallingTask: OpenAI_ToolCalling_Stream,
  GenerateImageTask: OpenAI_GenerateImage_Stream,
  EditImageTask: OpenAI_EditImage_Stream,
};

export const OPENAI_PREVIEW_TASKS: Record<
  string,
  AiProviderPreviewRunFn<any, any, OpenAiModelConfig>
> = {
  CountTokensTask: OpenAI_CountTokens_Preview,
};
