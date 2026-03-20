/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
import {
  ensureAvailable,
  getApi,
  getConfig,
  snapshotStreamToTextDeltas,
} from "./WebBrowser_ChromeHelpers";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WebBrowser_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  WebBrowserModelConfig
> = async (input, model, update_progress, signal) => {
  const factory = getApi("Rewriter", typeof Rewriter !== "undefined" ? Rewriter : undefined);
  await ensureAvailable("Rewriter", factory);
  const config = getConfig(model);

  if (Array.isArray(input.text)) {
    getLogger().warn("WebBrowser_TextRewriter: array input received; processing sequentially");
    const results: string[] = [];
    for (const item of input.text as string[]) {
      const rewriter = await factory.create({
        tone: config.rewriter_tone,
        length: config.rewriter_length,
      });
      try {
        results.push(
          await rewriter.rewrite(item, {
            signal,
            context: input.prompt as string | undefined,
          })
        );
      } finally {
        rewriter.destroy();
      }
    }
    update_progress(100, "Completed text rewriting");
    return { text: results } as TextRewriterTaskOutput;
  }

  const rewriter = await factory.create({
    tone: config.rewriter_tone,
    length: config.rewriter_length,
  });
  try {
    const text = await rewriter.rewrite(input.text as string, {
      signal,
      context: input.prompt as string | undefined,
    });
    update_progress(100, "Completed text rewriting");
    return { text };
  } finally {
    rewriter.destroy();
  }
};

export const WebBrowser_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  WebBrowserModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const factory = getApi("Rewriter", typeof Rewriter !== "undefined" ? Rewriter : undefined);
  await ensureAvailable("Rewriter", factory);
  const config = getConfig(model);

  const rewriter = await factory.create({
    tone: config.rewriter_tone,
    length: config.rewriter_length,
  });
  try {
    const stream = rewriter.rewriteStreaming(input.text as string, {
      signal,
      context: input.prompt as string | undefined,
    });
    yield* snapshotStreamToTextDeltas<TextRewriterTaskOutput>(stream, "text", (text) => ({ text }));
  } finally {
    rewriter.destroy();
  }
};
