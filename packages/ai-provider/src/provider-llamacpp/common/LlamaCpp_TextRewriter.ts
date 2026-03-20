/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, AiProviderStreamFn, TextRewriterTaskInput, TextRewriterTaskOutput } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { getOrCreateTextContext, loadSdk, streamFromSession } from "./LlamaCpp_Runtime";

export const LlamaCpp_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "LlamaCpp_TextRewriter: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const results: string[] = [];
    for (const item of texts) {
      const r = await LlamaCpp_TextRewriter(
        { ...input, text: item },
        model,
        update_progress,
        signal
      );
      results.push(r.text as string);
    }
    return { text: results };
  }

  if (!model) throw new Error("Model config is required for TextRewriterTask.");

  const { LlamaChatSession } = await loadSdk();

  update_progress(0, "Loading model");
  const context = await getOrCreateTextContext(model);

  update_progress(10, "Rewriting text");
  const sequence = context.getSequence();
  const session = new LlamaChatSession({
    contextSequence: sequence,
    systemPrompt: input.prompt as string,
  });
  try {
    const text = await session.prompt(input.text as string, { signal });
    update_progress(100, "Text rewriting complete");
    return { text };
  } finally {
    sequence.dispose();
  }
};

export const LlamaCpp_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  LlamaCppModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  if (!model) throw new Error("Model config is required for TextRewriterTask.");

  const { LlamaChatSession } = await loadSdk();

  const context = await getOrCreateTextContext(model);
  const sequence = context.getSequence();
  const session = new LlamaChatSession({
    contextSequence: sequence,
    systemPrompt: input.prompt as string,
  });
  try {
    yield* streamFromSession<TextRewriterTaskOutput>((onTextChunk) => {
      return session.prompt(input.text as string, { signal, onTextChunk });
    }, signal);
  } finally {
    sequence.dispose();
  }
};
