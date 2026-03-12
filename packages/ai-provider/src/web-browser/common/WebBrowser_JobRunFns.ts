/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

// ========================================================================
// Helpers
// ========================================================================

interface ProviderConfig {
  readonly pipeline?: string;
  readonly summary_type?: "tl;dr" | "key-points" | "teaser" | "headline";
  readonly summary_length?: "short" | "medium" | "long";
  readonly summary_format?: "plain-text" | "markdown";
  readonly rewriter_tone?: "as-is" | "more-formal" | "more-casual";
  readonly rewriter_length?: "as-is" | "shorter" | "longer";
}

function getConfig(model: WebBrowserModelConfig | undefined): ProviderConfig {
  return (model?.provider_config ?? {}) as ProviderConfig;
}

function getApi<T>(name: string, global: T | undefined): T {
  if (!global) {
    throw new PermanentJobError(
      `Chrome Built-in AI "${name}" API is not available in this browser.`
    );
  }
  return global;
}

async function ensureAvailable(name: string, factory: { availability(): Promise<string> }) {
  const status = await factory.availability();
  if (status === "no") {
    throw new PermanentJobError(
      `Chrome Built-in AI "${name}" is not available (status: "no"). ` +
        `Ensure you are using a compatible Chrome version with the flag enabled.`
    );
  }
  // "after-download" and "readily" are both acceptable — create() handles downloading.
}

/**
 * Chrome streaming APIs return progressive full-text snapshots. This helper
 * converts them to append-mode text-delta events by diffing successive snapshots.
 *
 * When the API emits a non-monotonic snapshot (one that doesn't extend the
 * previous snapshot as a strict prefix — e.g., a correction, truncation, or
 * restart), the helper falls back to emitting a `snapshot` event carrying the
 * full new text (built via `buildFallbackOutput`) and resets tracking so that
 * subsequent chunks are diffed against the new baseline.
 */
async function* snapshotStreamToTextDeltas<Output>(
  stream: ReadableStream<string>,
  port: string,
  buildFallbackOutput: (text: string) => Output
): AsyncIterable<StreamEvent<Output>> {
  const reader = stream.getReader();
  let previousSnapshot = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.startsWith(previousSnapshot)) {
        // Normal monotonic case: emit only the new suffix as a text-delta.
        const delta = value.slice(previousSnapshot.length);
        previousSnapshot = value;
        if (delta) {
          yield { type: "text-delta", port, textDelta: delta };
        }
      } else {
        // Non-monotonic snapshot (correction, truncation, or restart):
        // fall back to a full snapshot event so the consumer can replace its
        // accumulated state, then reset tracking to the new baseline.
        previousSnapshot = value;
        yield { type: "snapshot", data: buildFallbackOutput(value) };
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: "finish", data: {} as Output };
}

/**
 * Chrome streaming APIs return progressive full-text snapshots. This helper
 * yields replace-mode snapshot events for ports annotated with `x-stream: "replace"`.
 */
async function* snapshotStreamToSnapshots<Output>(
  stream: ReadableStream<string>,
  buildOutput: (text: string) => Output
): AsyncIterable<StreamEvent<Output>> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield { type: "snapshot", data: buildOutput(value) };
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: "finish", data: {} as Output };
}

// ========================================================================
// Non-streaming run functions
// ========================================================================

export const WebBrowser_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  WebBrowserModelConfig
> = async (input, model, update_progress, signal) => {
  const factory = getApi(
    "Summarizer",
    (globalThis as any)?.ai?.summarizer ??
      (typeof Summarizer !== "undefined" ? Summarizer : undefined),
  );
  await ensureAvailable("Summarizer", factory);
  const config = getConfig(model);

  if (Array.isArray(input.text)) {
    getLogger().warn(
      "WebBrowser_TextSummary: array input received; processing sequentially"
    );
    const results: string[] = [];
    for (const item of input.text as string[]) {
      const summarizer = await factory.create({
        type: config.summary_type,
        length: config.summary_length,
        format: config.summary_format,
      });
      try {
        results.push(await summarizer.summarize(item, { signal }));
      } finally {
        summarizer.destroy();
      }
    }
    update_progress(100, "Completed text summarization");
    return { text: results } as TextSummaryTaskOutput;
  }

  const summarizer = await factory.create({
    type: config.summary_type,
    length: config.summary_length,
    format: config.summary_format,
  });
  try {
    const text = await summarizer.summarize(input.text as string, { signal });
    update_progress(100, "Completed text summarization");
    return { text };
  } finally {
    summarizer.destroy();
  }
};

export const WebBrowser_TextLanguageDetection: AiProviderRunFn<
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  WebBrowserModelConfig
> = async (input, model, update_progress, signal) => {
  const factory = getApi(
    "LanguageDetector",
    typeof LanguageDetector !== "undefined" ? LanguageDetector : undefined
  );
  await ensureAvailable("LanguageDetector", factory);

  if (Array.isArray(input.text)) {
    getLogger().warn(
      "WebBrowser_TextLanguageDetection: array input received; processing sequentially"
    );
    const allResults: Array<Array<{ language: string; score: number }>> = [];
    for (const item of input.text as string[]) {
      const detector = await factory.create();
      try {
        const detected = await detector.detect(item, { signal });
        const mapped = detected
          .map((d) => ({ language: d.detectedLanguage, score: d.confidence }))
          .slice(0, input.maxLanguages ?? 5);
        allResults.push(mapped);
      } finally {
        detector.destroy();
      }
    }
    update_progress(100, "Completed language detection");
    return { languages: allResults } as TextLanguageDetectionTaskOutput;
  }

  const detector = await factory.create();
  try {
    const detected = await detector.detect(input.text as string, { signal });
    const languages = detected
      .map((d) => ({ language: d.detectedLanguage, score: d.confidence }))
      .slice(0, input.maxLanguages ?? 5);
    update_progress(100, "Completed language detection");
    return { languages };
  } finally {
    detector.destroy();
  }
};

export const WebBrowser_TextTranslation: AiProviderRunFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  WebBrowserModelConfig
> = async (input, model, update_progress, signal) => {
  const factory = getApi(
    "Translator",
    typeof Translator !== "undefined" ? Translator : undefined
  );
  await ensureAvailable("Translator", factory);

  if (Array.isArray(input.text)) {
    getLogger().warn(
      "WebBrowser_TextTranslation: array input received; processing sequentially"
    );
    const results: string[] = [];
    for (const item of input.text as string[]) {
      const translator = await factory.create({
        sourceLanguage: input.source_lang as string,
        targetLanguage: input.target_lang as string,
      });
      try {
        results.push(await translator.translate(item, { signal }));
      } finally {
        translator.destroy();
      }
    }
    update_progress(100, "Completed text translation");
    return { text: results, target_lang: input.target_lang } as TextTranslationTaskOutput;
  }

  const translator = await factory.create({
    sourceLanguage: input.source_lang as string,
    targetLanguage: input.target_lang as string,
  });
  try {
    const text = await translator.translate(input.text as string, { signal });
    update_progress(100, "Completed text translation");
    return { text, target_lang: input.target_lang };
  } finally {
    translator.destroy();
  }
};

export const WebBrowser_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  WebBrowserModelConfig
> = async (input, model, update_progress, signal) => {
  const factory = getApi(
    "LanguageModel",
    typeof LanguageModel !== "undefined" ? LanguageModel : undefined
  );
  await ensureAvailable("LanguageModel", factory);

  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "WebBrowser_TextGeneration: array input received; processing sequentially"
    );
    const results: string[] = [];
    for (const item of input.prompt as string[]) {
      const session = await factory.create({
        temperature: input.temperature ?? undefined,
      });
      try {
        results.push(await session.prompt(item, { signal }));
      } finally {
        session.destroy();
      }
    }
    update_progress(100, "Completed text generation");
    return { text: results } as TextGenerationTaskOutput;
  }

  const session = await factory.create({
    temperature: input.temperature ?? undefined,
  });
  try {
    const text = await session.prompt(input.prompt as string, { signal });
    update_progress(100, "Completed text generation");
    return { text };
  } finally {
    session.destroy();
  }
};

export const WebBrowser_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  WebBrowserModelConfig
> = async (input, model, update_progress, signal) => {
  const factory = getApi("Rewriter", typeof Rewriter !== "undefined" ? Rewriter : undefined);
  await ensureAvailable("Rewriter", factory);
  const config = getConfig(model);

  if (Array.isArray(input.text)) {
    getLogger().warn(
      "WebBrowser_TextRewriter: array input received; processing sequentially"
    );
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

// ========================================================================
// Model info
// ========================================================================

export const WebBrowser_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  WebBrowserModelConfig
> = async (input) => {
  return {
    model: input.model,
    is_local: true,
    is_remote: false,
    supports_browser: true,
    supports_node: false,
    is_cached: false,
    is_loaded: false,
    file_sizes: null,
  };
};

// ========================================================================
// Streaming implementations
// ========================================================================

export const WebBrowser_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  WebBrowserModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const factory = getApi("Summarizer", typeof Summarizer !== "undefined" ? Summarizer : undefined);
  await ensureAvailable("Summarizer", factory);
  const config = getConfig(model);

  const summarizer = await factory.create({
    type: config.summary_type,
    length: config.summary_length,
    format: config.summary_format,
  });
  try {
    const stream = summarizer.summarizeStreaming(input.text as string, { signal });
    yield* snapshotStreamToTextDeltas<TextSummaryTaskOutput>(stream, "text", (text) => ({ text }));
  } finally {
    summarizer.destroy();
  }
};

export const WebBrowser_TextTranslation_Stream: AiProviderStreamFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  WebBrowserModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextTranslationTaskOutput>> {
  const factory = getApi(
    "Translator",
    typeof Translator !== "undefined" ? Translator : undefined
  );
  await ensureAvailable("Translator", factory);

  const translator = await factory.create({
    sourceLanguage: input.source_lang as string,
    targetLanguage: input.target_lang as string,
  });
  try {
    const stream = translator.translateStreaming(input.text as string, { signal });
    yield* snapshotStreamToSnapshots<TextTranslationTaskOutput>(stream, (text) => ({
      text,
      target_lang: input.target_lang,
    }));
  } finally {
    translator.destroy();
  }
};

export const WebBrowser_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  WebBrowserModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const factory = getApi(
    "LanguageModel",
    typeof LanguageModel !== "undefined" ? LanguageModel : undefined
  );
  await ensureAvailable("LanguageModel", factory);

  const session = await factory.create({
    temperature: input.temperature ?? undefined,
  });
  try {
    const stream = session.promptStreaming(input.prompt as string, { signal });
    yield* snapshotStreamToTextDeltas<TextGenerationTaskOutput>(stream, "text", (text) => ({ text }));
  } finally {
    session.destroy();
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

// ========================================================================
// Task registries
// ========================================================================

export const WEB_BROWSER_TASKS: Record<string, AiProviderRunFn<any, any, WebBrowserModelConfig>> = {
  ModelInfoTask: WebBrowser_ModelInfo,
  TextSummaryTask: WebBrowser_TextSummary,
  TextLanguageDetectionTask: WebBrowser_TextLanguageDetection,
  TextTranslationTask: WebBrowser_TextTranslation,
  TextGenerationTask: WebBrowser_TextGeneration,
  TextRewriterTask: WebBrowser_TextRewriter,
};

export const WEB_BROWSER_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, WebBrowserModelConfig>
> = {
  TextSummaryTask: WebBrowser_TextSummary_Stream,
  TextTranslationTask: WebBrowser_TextTranslation_Stream,
  TextGenerationTask: WebBrowser_TextGeneration_Stream,
  TextRewriterTask: WebBrowser_TextRewriter_Stream,
};
