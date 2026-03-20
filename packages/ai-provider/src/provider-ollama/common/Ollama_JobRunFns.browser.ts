/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, AiProviderStreamFn, ToolCallingTaskInput } from "@workglow/ai";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";
import { getClient, getModelName, loadOllamaSDK } from "./Ollama_Client.browser";
import { createOllamaModelInfo } from "./Ollama_ModelInfo";
import { createOllamaModelSearch } from "./Ollama_ModelSearch";
import { createOllamaTextEmbedding } from "./Ollama_TextEmbedding";
import {
  createOllamaTextGeneration,
  createOllamaTextGenerationStream,
} from "./Ollama_TextGeneration";
import { createOllamaTextRewriter, createOllamaTextRewriterStream } from "./Ollama_TextRewriter";
import { createOllamaTextSummary, createOllamaTextSummaryStream } from "./Ollama_TextSummary";
import { createOllamaToolCalling, createOllamaToolCallingStream } from "./Ollama_ToolCalling";

export { getClient, getModelName, loadOllamaSDK } from "./Ollama_Client.browser";

function buildBrowserToolCallingMessages(input: ToolCallingTaskInput): Array<{
  role: string;
  content: string;
}> {
  const messages: Array<{ role: string; content: string }> = [];
  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt as string });
  }
  messages.push({ role: "user", content: input.prompt as string });
  return messages;
}

const Ollama_TextGeneration = createOllamaTextGeneration(getClient);
const Ollama_TextEmbedding = createOllamaTextEmbedding(getClient);
const Ollama_TextRewriter = createOllamaTextRewriter(getClient);
const Ollama_TextSummary = createOllamaTextSummary(getClient);

const Ollama_TextGeneration_Stream = createOllamaTextGenerationStream(getClient);
const Ollama_TextRewriter_Stream = createOllamaTextRewriterStream(getClient);
const Ollama_TextSummary_Stream = createOllamaTextSummaryStream(getClient);

const Ollama_ToolCalling = createOllamaToolCalling(getClient, buildBrowserToolCallingMessages);
const Ollama_ToolCalling_Stream = createOllamaToolCallingStream(
  getClient,
  buildBrowserToolCallingMessages
);

const Ollama_ModelInfo = createOllamaModelInfo(getClient);
const Ollama_ModelSearch = createOllamaModelSearch(getClient);

export const OLLAMA_TASKS: Record<string, AiProviderRunFn<any, any, OllamaModelConfig>> = {
  ModelInfoTask: Ollama_ModelInfo,
  TextGenerationTask: Ollama_TextGeneration,
  TextEmbeddingTask: Ollama_TextEmbedding,
  TextRewriterTask: Ollama_TextRewriter,
  TextSummaryTask: Ollama_TextSummary,
  ToolCallingTask: Ollama_ToolCalling,
  ModelSearchTask: Ollama_ModelSearch,
};

export const OLLAMA_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, OllamaModelConfig>
> = {
  TextGenerationTask: Ollama_TextGeneration_Stream,
  TextRewriterTask: Ollama_TextRewriter_Stream,
  TextSummaryTask: Ollama_TextSummary_Stream,
  ToolCallingTask: Ollama_ToolCalling_Stream,
};
