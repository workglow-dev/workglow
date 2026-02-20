/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  CountTokensTaskInput,
  CountTokensTaskOutput,
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { LLAMACPP_DEFAULT_MODELS_DIR } from "./LlamaCpp_Constants";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";

// ========================================================================
// Lazy SDK loading
// ========================================================================

let _sdk: typeof import("node-llama-cpp") | undefined;

async function loadSdk() {
  if (!_sdk) {
    try {
      _sdk = await import("node-llama-cpp");
    } catch (err) {
      throw new Error(
        "node-llama-cpp is required for LOCAL_LLAMACPP tasks. Install it with: bun add node-llama-cpp"
      );
    }
  }
  return _sdk;
}

// ========================================================================
// Module-level caches (shared across all task invocations)
// ========================================================================

type LlamaInstance = Awaited<ReturnType<(typeof import("node-llama-cpp"))["getLlama"]>>;
type LlamaModel = Awaited<ReturnType<LlamaInstance["loadModel"]>>;
type LlamaContext = Awaited<ReturnType<LlamaModel["createContext"]>>;
type LlamaEmbeddingContext = Awaited<ReturnType<LlamaModel["createEmbeddingContext"]>>;

let llamaInstance: LlamaInstance | undefined;
const models = new Map<string, LlamaModel>();
const textContexts = new Map<string, LlamaContext>();
const embeddingContexts = new Map<string, LlamaEmbeddingContext>();

/** Maps model_url (or model_path when used as URI) to the actual downloaded filesystem path. */
const resolvedPaths = new Map<string, string>();

// ========================================================================
// Helpers
// ========================================================================

async function getLlamaInstance(): Promise<LlamaInstance> {
  if (!llamaInstance) {
    const { getLlama } = await loadSdk();
    llamaInstance = await getLlama();
  }
  return llamaInstance;
}

function getConfigKey(model: LlamaCppModelConfig): string {
  return model.provider_config.model_url ?? model.provider_config.model_path;
}

function getActualModelPath(model: LlamaCppModelConfig): string {
  const key = getConfigKey(model);
  const resolved = resolvedPaths.get(key);
  return resolved ?? model.provider_config.model_path;
}

async function getOrLoadModel(model: LlamaCppModelConfig): Promise<LlamaModel> {
  const modelPath = getActualModelPath(model);
  const cached = models.get(modelPath);
  if (cached) return cached;

  const llama = await getLlamaInstance();
  const config = model.provider_config;

  const loadedModel = await llama.loadModel({
    modelPath,
    ...(config.gpu_layers !== undefined && { gpuLayers: config.gpu_layers }),
  });

  models.set(modelPath, loadedModel);
  return loadedModel;
}

async function getOrCreateTextContext(model: LlamaCppModelConfig): Promise<LlamaContext> {
  const modelPath = getActualModelPath(model);
  const cached = textContexts.get(modelPath);
  if (cached) return cached;

  const loadedModel = await getOrLoadModel(model);
  const config = model.provider_config;

  const context = await loadedModel.createContext({
    ...(config.context_size && { contextSize: config.context_size }),
    ...(config.flash_attention !== undefined && { flashAttention: config.flash_attention }),
  });

  textContexts.set(modelPath, context);
  return context;
}

async function getOrCreateEmbeddingContext(
  model: LlamaCppModelConfig
): Promise<LlamaEmbeddingContext> {
  const modelPath = getActualModelPath(model);
  const cached = embeddingContexts.get(modelPath);
  if (cached) return cached;

  const loadedModel = await getOrLoadModel(model);

  const context = await loadedModel.createEmbeddingContext();

  embeddingContexts.set(modelPath, context);
  return context;
}

/**
 * Bridges a node-llama-cpp session.prompt() call (callback-based) to an AsyncGenerator
 * of StreamEvents. Handles abort signals and errors cleanly.
 */
async function* streamFromSession<T extends Record<string, unknown>>(
  promptFn: (onTextChunk: (chunk: string) => void) => Promise<string>,
  signal: AbortSignal
): AsyncGenerator<StreamEvent<T>> {
  const queue: string[] = [];
  let isComplete = false;
  let completionError: unknown;
  let resolveWait: (() => void) | null = null;

  const notifyWaiter = () => {
    resolveWait?.();
    resolveWait = null;
  };

  const promptPromise = promptFn((chunk: string) => {
    queue.push(chunk);
    notifyWaiter();
  })
    .then(() => {
      isComplete = true;
      notifyWaiter();
    })
    .catch((err: unknown) => {
      completionError = err;
      isComplete = true;
      notifyWaiter();
    });

  try {
    while (true) {
      while (queue.length > 0) {
        yield { type: "text-delta", port: "text", textDelta: queue.shift()! };
      }
      if (isComplete) break;
      await new Promise<void>((r) => {
        resolveWait = r;
      });
    }
    // Drain any remaining chunks after completion signal
    while (queue.length > 0) {
      yield { type: "text-delta", port: "text", textDelta: queue.shift()! };
    }
  } finally {
    await promptPromise.catch(() => {});
  }

  if (completionError) {
    if (signal.aborted) return;
    throw completionError;
  }

  yield { type: "finish", data: {} as T };
}

// ========================================================================
// DownloadModelTask
// ========================================================================

export const LlamaCpp_Download: AiProviderRunFn<
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal) => {
  if (!model) throw new Error("Model config is required for DownloadModelTask.");

  const { createModelDownloader } = await loadSdk();
  const config = model.provider_config;
  const modelUri = config.model_url ?? config.model_path;
  const dirPath = config.models_dir ?? LLAMACPP_DEFAULT_MODELS_DIR;

  update_progress(0, "Creating model downloader");

  const downloader = await createModelDownloader({ modelUri, dirPath });

  // Poll download progress via interval (ModelDownloader exposes downloadedSize / totalSize)
  const progressInterval = setInterval(() => {
    const total = (downloader as any).totalSize as number | undefined;
    const downloaded = (downloader as any).downloadedSize as number | undefined;
    if (total && total > 0 && downloaded !== undefined) {
      const pct = Math.min(99, Math.round((downloaded / total) * 100));
      update_progress(pct, "Downloading model", { file: modelUri, progress: pct / 100 });
    }
  }, 500);

  let modelPath: string;
  try {
    modelPath = await downloader.download();
  } finally {
    clearInterval(progressInterval);
  }

  // Store the resolved filesystem path for subsequent inference tasks
  resolvedPaths.set(getConfigKey(model), modelPath);

  update_progress(100, "Model downloaded", { file: modelUri, progress: 1 });

  return { model: input.model! };
};

// ========================================================================
// UnloadModelTask
// ========================================================================

export const LlamaCpp_Unload: AiProviderRunFn<
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, _signal) => {
  if (!model) throw new Error("Model config is required for UnloadModelTask.");

  const modelPath = getActualModelPath(model);

  // Dispose and remove the text context
  const ctx = textContexts.get(modelPath);
  if (ctx) {
    await ctx.dispose();
    textContexts.delete(modelPath);
    update_progress(33, "Text context disposed");
  }

  // Dispose and remove the embedding context
  const embCtx = embeddingContexts.get(modelPath);
  if (embCtx) {
    await embCtx.dispose();
    embeddingContexts.delete(modelPath);
    update_progress(66, "Embedding context disposed");
  }

  // Dispose and remove the model
  const cachedModel = models.get(modelPath);
  if (cachedModel) {
    await cachedModel.dispose();
    models.delete(modelPath);
    update_progress(100, "Model unloaded from memory");
  } else {
    update_progress(100, "Model was not loaded");
  }

  return { model: input.model! };
};

// ========================================================================
// TextGenerationTask (non-streaming)
// ========================================================================

export const LlamaCpp_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal) => {
  if (!model) throw new Error("Model config is required for TextGenerationTask.");

  const { LlamaChatSession } = await loadSdk();

  update_progress(0, "Loading model");
  const context = await getOrCreateTextContext(model);

  update_progress(10, "Generating text");
  const sequence = context.getSequence();
  const session = new LlamaChatSession({ contextSequence: sequence });
  try {
    const text = await session.prompt(input.prompt, {
      signal,
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
      ...(input.topP !== undefined && { topP: input.topP }),
    });
    update_progress(100, "Text generation complete");
    return { text };
  } finally {
    sequence.dispose();
  }
};

// ========================================================================
// TextGenerationTask (streaming)
// ========================================================================

export const LlamaCpp_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  LlamaCppModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  if (!model) throw new Error("Model config is required for TextGenerationTask.");

  const { LlamaChatSession } = await loadSdk();

  const context = await getOrCreateTextContext(model);
  const sequence = context.getSequence();
  const session = new LlamaChatSession({ contextSequence: sequence });
  try {
    yield* streamFromSession<TextGenerationTaskOutput>((onTextChunk) => {
      return session.prompt(input.prompt, {
        signal,
        onTextChunk,
        ...(input.temperature !== undefined && { temperature: input.temperature }),
        ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
        ...(input.topP !== undefined && { topP: input.topP }),
      });
    }, signal);
  } finally {
    sequence.dispose();
  }
};

// ========================================================================
// TextEmbeddingTask
// ========================================================================

export const LlamaCpp_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, _signal) => {
  if (!model) throw new Error("Model config is required for TextEmbeddingTask.");

  update_progress(0, "Loading embedding model");
  const context = await getOrCreateEmbeddingContext(model);

  const texts = Array.isArray(input.text) ? input.text : [input.text];
  update_progress(10, "Computing embeddings");

  const embeddings = await Promise.all(
    texts.map((text) => context.getEmbeddingFor(text).then((e) => new Float32Array(e.vector)))
  );

  update_progress(100, "Embeddings complete");

  if (Array.isArray(input.text)) {
    return { vector: embeddings };
  }
  return { vector: embeddings[0] };
};

// ========================================================================
// TextRewriterTask (non-streaming)
// ========================================================================

export const LlamaCpp_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal) => {
  if (!model) throw new Error("Model config is required for TextRewriterTask.");

  const { LlamaChatSession } = await loadSdk();

  update_progress(0, "Loading model");
  const context = await getOrCreateTextContext(model);

  update_progress(10, "Rewriting text");
  const sequence = context.getSequence();
  const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: input.prompt });
  try {
    const text = await session.prompt(input.text, { signal });
    update_progress(100, "Text rewriting complete");
    return { text };
  } finally {
    sequence.dispose();
  }
};

// ========================================================================
// TextRewriterTask (streaming)
// ========================================================================

export const LlamaCpp_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  LlamaCppModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  if (!model) throw new Error("Model config is required for TextRewriterTask.");

  const { LlamaChatSession } = await loadSdk();

  const context = await getOrCreateTextContext(model);
  const sequence = context.getSequence();
  const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: input.prompt });
  try {
    yield* streamFromSession<TextRewriterTaskOutput>((onTextChunk) => {
      return session.prompt(input.text, { signal, onTextChunk });
    }, signal);
  } finally {
    sequence.dispose();
  }
};

// ========================================================================
// TextSummaryTask (non-streaming)
// ========================================================================

export const LlamaCpp_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal) => {
  if (!model) throw new Error("Model config is required for TextSummaryTask.");

  const { LlamaChatSession } = await loadSdk();

  update_progress(0, "Loading model");
  const context = await getOrCreateTextContext(model);

  update_progress(10, "Summarizing text");
  const sequence = context.getSequence();
  const session = new LlamaChatSession({
    contextSequence: sequence,
    systemPrompt: "Summarize the following text concisely, preserving the key points.",
  });
  try {
    const text = await session.prompt(input.text, { signal });
    update_progress(100, "Summarization complete");
    return { text };
  } finally {
    sequence.dispose();
  }
};

// ========================================================================
// TextSummaryTask (streaming)
// ========================================================================

export const LlamaCpp_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  LlamaCppModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  if (!model) throw new Error("Model config is required for TextSummaryTask.");

  const { LlamaChatSession } = await loadSdk();

  const context = await getOrCreateTextContext(model);
  const sequence = context.getSequence();
  const session = new LlamaChatSession({
    contextSequence: sequence,
    systemPrompt: "Summarize the following text concisely, preserving the key points.",
  });
  try {
    yield* streamFromSession<TextSummaryTaskOutput>((onTextChunk) => {
      return session.prompt(input.text, { signal, onTextChunk });
    }, signal);
  } finally {
    sequence.dispose();
  }
};

// ========================================================================
// Dispose helper (called from LlamaCppProvider.dispose())
// ========================================================================

export async function disposeLlamaCppResources(): Promise<void> {
  const disposeAll = async (map: Map<string, { dispose(): Promise<void> }>) => {
    for (const resource of map.values()) {
      await resource.dispose().catch(() => {});
    }
    map.clear();
  };

  await disposeAll(textContexts as Map<string, { dispose(): Promise<void> }>);
  await disposeAll(embeddingContexts as Map<string, { dispose(): Promise<void> }>);
  await disposeAll(models as Map<string, { dispose(): Promise<void> }>);

  if (llamaInstance) {
    await (llamaInstance as any).dispose?.().catch(() => {});
    llamaInstance = undefined;
  }

  resolvedPaths.clear();
}

export const LlamaCpp_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  LlamaCppModelConfig
> = async (input, model, onProgress, signal) => {
  const loadedModel = await getOrLoadModel(model!);
  // model.tokenizer is itself the tokenize function (Tokenizer = tokenize["tokenize"])
  const tokens = loadedModel.tokenizer(input.text);
  return { count: tokens.length };
};

// ========================================================================
// Task registries
// ========================================================================

export const LLAMACPP_TASKS: Record<string, AiProviderRunFn<any, any, LlamaCppModelConfig>> = {
  DownloadModelTask: LlamaCpp_Download,
  UnloadModelTask: LlamaCpp_Unload,
  CountTokensTask: LlamaCpp_CountTokens,
  TextGenerationTask: LlamaCpp_TextGeneration,
  TextEmbeddingTask: LlamaCpp_TextEmbedding,
  TextRewriterTask: LlamaCpp_TextRewriter,
  TextSummaryTask: LlamaCpp_TextSummary,
};

export const LLAMACPP_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, LlamaCppModelConfig>
> = {
  TextGenerationTask: LlamaCpp_TextGeneration_Stream,
  TextRewriterTask: LlamaCpp_TextRewriter_Stream,
  TextSummaryTask: LlamaCpp_TextSummary_Stream,
};
