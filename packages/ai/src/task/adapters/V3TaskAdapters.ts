/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  EmbeddingModelV3CallOptions,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
} from "@ai-sdk/provider";
import { getModelInstanceFactory } from "../../model/ModelInstanceFactory";
import type { ModelConfig } from "../../model/ModelSchema";

const TEXT_GENERATION_TASKS = new Set([
  "TextGenerationTask",
  "TextSummaryTask",
  "TextRewriterTask",
  "TextQuestionAnswerTask",
  "TextTranslationTask",
]);

export type V3AdapterStatus = "handled" | "not-registered" | "unsupported-task";

export interface V3AdapterResult {
  status: V3AdapterStatus;
  output?: Record<string, unknown>;
}

function textFromLanguageModelResult(result: LanguageModelV3GenerateResult): string {
  if (!Array.isArray(result.content)) return "";
  return result.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function buildPromptForTask(taskType: string, taskInput: Record<string, unknown>): string {
  switch (taskType) {
    case "TextSummaryTask":
      return `Summarize the following text:\n\n${taskInput.text}`;
    case "TextRewriterTask":
      return `${taskInput.prompt}\n\n${taskInput.text}`;
    case "TextQuestionAnswerTask":
      return `Context:\n${taskInput.context}\n\nQuestion:\n${taskInput.question}\n\nAnswer:`;
    case "TextTranslationTask":
      return `Translate from ${taskInput.source_lang} to ${taskInput.target_lang}:\n\n${taskInput.text}`;
    case "TextGenerationTask":
    default:
      return String(taskInput.prompt ?? "");
  }
}

export async function executeTaskViaV3Model(
  taskType: string,
  taskInput: Record<string, unknown>,
  signal: AbortSignal
): Promise<V3AdapterResult> {
  const model = taskInput?.model as ModelConfig | undefined;
  if (!model) return { status: "not-registered" };

  const modelFactory = getModelInstanceFactory();

  if (TEXT_GENERATION_TASKS.has(taskType)) {
    if (!modelFactory.hasLanguageModel(model.provider)) {
      return { status: "not-registered" };
    }

    const languageModel = modelFactory.getLanguageModel(model);
    const prompt: LanguageModelV3Prompt = [
      {
        role: "user",
        content: [{ type: "text", text: buildPromptForTask(taskType, taskInput) }],
      },
    ];
    const callOptions: LanguageModelV3CallOptions = {
      prompt,
      abortSignal: signal,
      temperature: taskInput.temperature as number | undefined,
      topP: taskInput.topP as number | undefined,
      maxOutputTokens: taskInput.maxTokens as number | undefined,
    };
    const result = await languageModel.doGenerate(callOptions);

    const text = textFromLanguageModelResult(result);
    if (taskType === "TextTranslationTask") {
      return {
        status: "handled",
        output: { text, target_lang: taskInput.target_lang as string },
      };
    }
    return { status: "handled", output: { text } };
  }

  if (taskType === "TextEmbeddingTask") {
    if (!modelFactory.hasEmbeddingModel(model.provider)) {
      return { status: "not-registered" };
    }

    const embeddingModel = modelFactory.getEmbeddingModel(model);
    const textValue = taskInput.text;
    const values: string[] = Array.isArray(textValue)
      ? (textValue as string[])
      : [String(textValue)];
    const callOptions: EmbeddingModelV3CallOptions = {
      values,
      abortSignal: signal,
    };
    const result = await embeddingModel.doEmbed(callOptions);
    const embeddings = (result.embeddings || []).map((v: number[]) => Float32Array.from(v));
    return {
      status: "handled",
      output: {
        vector: Array.isArray(taskInput.text) ? embeddings : embeddings[0],
      },
    };
  }

  return { status: "unsupported-task" };
}
