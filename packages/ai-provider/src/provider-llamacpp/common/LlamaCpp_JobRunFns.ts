/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { filterValidToolCalls } from "@workglow/ai";
import type {
  AiProviderReactiveRunFn,
  AiProviderRunFn,
  AiProviderStreamFn,
  CountTokensTaskInput,
  CountTokensTaskOutput,
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolDefinition,
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
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
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "LlamaCpp_TextGeneration: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const results: string[] = [];
    for (const item of prompts) {
      const r = await LlamaCpp_TextGeneration(
        { ...input, prompt: item },
        model,
        update_progress,
        signal
      );
      results.push(r.text as string);
    }
    return { text: results };
  }

  if (!model) throw new Error("Model config is required for TextGenerationTask.");

  const { LlamaChatSession } = await loadSdk();

  update_progress(0, "Loading model");
  const context = await getOrCreateTextContext(model);

  update_progress(10, "Generating text");
  const sequence = context.getSequence();
  const session = new LlamaChatSession({ contextSequence: sequence });
  try {
    const text = await session.prompt(input.prompt as string, {
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
      return session.prompt(input.prompt as string, {
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

// ========================================================================
// TextSummaryTask (non-streaming)
// ========================================================================

export const LlamaCpp_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "LlamaCpp_TextSummary: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const results: string[] = [];
    for (const item of texts) {
      const r = await LlamaCpp_TextSummary(
        { ...input, text: item },
        model,
        update_progress,
        signal
      );
      results.push(r.text as string);
    }
    return { text: results };
  }

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
    const text = await session.prompt(input.text as string, { signal });
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
      return session.prompt(input.text as string, { signal, onTextChunk });
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
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "LlamaCpp_CountTokens: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const counts: number[] = [];
    for (const item of texts) {
      const r = await LlamaCpp_CountTokens({ ...input, text: item }, model, onProgress, signal);
      counts.push(r.count as number);
    }
    return { count: counts };
  }

  const loadedModel = await getOrLoadModel(model!);
  // model.tokenizer is itself the tokenize function (Tokenizer = tokenize["tokenize"])
  const tokens = loadedModel.tokenizer(input.text as string);
  return { count: tokens.length };
};

export const LlamaCpp_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  LlamaCppModelConfig
> = async (input, _output, model) => {
  return LlamaCpp_CountTokens(input, model, () => {}, new AbortController().signal);
};

// ========================================================================
// ToolCallingTask (non-streaming)
// ========================================================================

/**
 * Build a prompt string from the task input.
 * When `input.messages` is present (multi-turn agent loop), concatenates
 * the conversation history into a single prompt string since LlamaCpp
 * uses a session-based approach that doesn't support external message arrays.
 */
function buildLlamaCppPrompt(input: ToolCallingTaskInput): string {
  const inputMessages = input.messages;
  if (!inputMessages || inputMessages.length === 0) {
    return input.prompt;
  }

  // Concatenate messages into a single prompt for the session
  const parts: string[] = [];
  for (const msg of inputMessages) {
    if (msg.role === "user") {
      parts.push(`User: ${msg.content}`);
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const text = msg.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      if (text) parts.push(`Assistant: ${text}`);
    } else if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        parts.push(`Tool Result: ${block.content}`);
      }
    }
  }
  return parts.join("\n\n");
}

/**
 * Builds function definitions for node-llama-cpp from ToolDefinition inputs.
 * Each function handler captures the call arguments and returns a simple
 * acknowledgment, allowing us to collect tool calls without side-effects.
 */
function buildLlamaCppFunctions(
  tools: ReadonlyArray<ToolDefinition>,
  capturedCalls: Array<{ name: string; input: Record<string, unknown> }>
) {
  const { defineChatSessionFunction } = _sdk!;
  const functions: Record<string, any> = {};
  for (const tool of tools) {
    const toolName = tool.name;
    functions[toolName] = defineChatSessionFunction({
      description: tool.description,
      params: tool.inputSchema as any,
      handler(params: any) {
        capturedCalls.push({ name: toolName, input: (params ?? {}) as Record<string, unknown> });
        return "OK";
      },
    } as any);
  }
  return functions;
}

export const LlamaCpp_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "LlamaCpp_ToolCalling: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const texts: string[] = [];
    const toolCallsList: Record<string, unknown>[] = [];
    for (const item of prompts) {
      const r = await LlamaCpp_ToolCalling(
        { ...input, prompt: item },
        model,
        update_progress,
        signal
      );
      texts.push(r.text as string);
      toolCallsList.push(r.toolCalls as Record<string, unknown>);
    }
    return { text: texts, toolCalls: toolCallsList };
  }

  if (!model) throw new Error("Model config is required for ToolCallingTask.");

  await loadSdk();

  update_progress(0, "Loading model");
  const context = await getOrCreateTextContext(model);

  const capturedCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const functions =
    input.toolChoice === "none" ? undefined : buildLlamaCppFunctions(input.tools, capturedCalls);

  update_progress(10, "Running tool calling");
  const sequence = context.getSequence();
  const { LlamaChatSession } = _sdk!;
  const promptText = buildLlamaCppPrompt(input);
  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...(input.systemPrompt && { systemPrompt: input.systemPrompt }),
  });

  try {
    const text = await session.prompt(promptText, {
      signal,
      ...(functions && { functions }),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
    });

    const toolCalls: Record<string, unknown> = {};
    capturedCalls.forEach((call, index) => {
      const id = `call_${index}`;
      toolCalls[id] = { id, name: call.name, input: call.input };
    });

    update_progress(100, "Tool calling complete");
    return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
  } finally {
    sequence.dispose();
  }
};

// ========================================================================
// ToolCallingTask (streaming)
// ========================================================================

export const LlamaCpp_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  LlamaCppModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  if (!model) throw new Error("Model config is required for ToolCallingTask.");

  await loadSdk();

  const context = await getOrCreateTextContext(model);

  const capturedCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const functions =
    input.toolChoice === "none" ? undefined : buildLlamaCppFunctions(input.tools, capturedCalls);

  const sequence = context.getSequence();
  const { LlamaChatSession } = _sdk!;
  const promptText = buildLlamaCppPrompt(input);
  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...(input.systemPrompt && { systemPrompt: input.systemPrompt }),
  });

  const queue: string[] = [];
  let isComplete = false;
  let completionError: unknown;
  let resolveWait: (() => void) | null = null;

  const notifyWaiter = () => {
    resolveWait?.();
    resolveWait = null;
  };

  let accumulatedText = "";
  const promptPromise = session
    .prompt(promptText, {
      signal,
      ...(functions && { functions }),
      onTextChunk: (chunk: string) => {
        queue.push(chunk);
        notifyWaiter();
      },
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
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
        const chunk = queue.shift()!;
        accumulatedText += chunk;
        yield { type: "text-delta", port: "text", textDelta: chunk };
      }
      if (isComplete) break;
      await new Promise<void>((r) => {
        resolveWait = r;
      });
    }
    // Drain any remaining chunks after completion signal
    while (queue.length > 0) {
      const chunk = queue.shift()!;
      accumulatedText += chunk;
      yield { type: "text-delta", port: "text", textDelta: chunk };
    }
  } finally {
    await promptPromise.catch(() => {});
    sequence.dispose();
  }

  if (completionError) {
    if (!signal.aborted) throw completionError;
    return;
  }

  const toolCalls: Record<string, unknown> = {};
  capturedCalls.forEach((call, index) => {
    const id = `call_${index}`;
    toolCalls[id] = { id, name: call.name, input: call.input };
  });
  const validToolCalls = filterValidToolCalls(toolCalls, input.tools);

  if (Object.keys(validToolCalls).length > 0) {
    yield { type: "object-delta", port: "toolCalls", objectDelta: { ...validToolCalls } };
  }

  yield {
    type: "finish",
    data: { text: accumulatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
  };
};

// ========================================================================
// Model info
// ========================================================================

export const LlamaCpp_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  LlamaCppModelConfig
> = async (input, model) => {
  if (!model) throw new Error("Model config is required for ModelInfoTask.");

  const modelPath = getActualModelPath(model);
  const is_loaded = models.has(modelPath);

  let is_cached = is_loaded;
  let file_sizes: Record<string, number> | null = null;

  // Check if model file exists on disk
  try {
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(modelPath);
    is_cached = true;
    file_sizes = { model: stat.size };
  } catch {
    // File does not exist or fs not available
    // Fall back to checking if the path is in resolvedPaths
    if (resolvedPaths.has(getConfigKey(model))) {
      is_cached = true;
    }
  }

  return {
    model: input.model,
    is_local: true,
    is_remote: false,
    supports_browser: false,
    supports_node: true,
    is_cached,
    is_loaded,
    file_sizes,
  };
};

// ========================================================================
// Task registries
// ========================================================================

export const LLAMACPP_TASKS: Record<string, AiProviderRunFn<any, any, LlamaCppModelConfig>> = {
  DownloadModelTask: LlamaCpp_Download,
  UnloadModelTask: LlamaCpp_Unload,
  ModelInfoTask: LlamaCpp_ModelInfo,
  CountTokensTask: LlamaCpp_CountTokens,
  TextGenerationTask: LlamaCpp_TextGeneration,
  TextEmbeddingTask: LlamaCpp_TextEmbedding,
  TextRewriterTask: LlamaCpp_TextRewriter,
  TextSummaryTask: LlamaCpp_TextSummary,
  ToolCallingTask: LlamaCpp_ToolCalling,
};

export const LLAMACPP_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, LlamaCppModelConfig>
> = {
  TextGenerationTask: LlamaCpp_TextGeneration_Stream,
  TextRewriterTask: LlamaCpp_TextRewriter_Stream,
  TextSummaryTask: LlamaCpp_TextSummary_Stream,
  ToolCallingTask: LlamaCpp_ToolCalling_Stream,
};

export const LLAMACPP_REACTIVE_TASKS: Record<
  string,
  AiProviderReactiveRunFn<any, any, LlamaCppModelConfig>
> = {
  CountTokensTask: LlamaCpp_CountTokens_Reactive,
};
