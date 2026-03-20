/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent } from "@workglow/task-graph";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";

let _sdk: typeof import("node-llama-cpp") | undefined;

export async function loadSdk(): Promise<typeof import("node-llama-cpp")> {
  if (!_sdk) {
    try {
      _sdk = await import("node-llama-cpp");
    } catch {
      throw new Error(
        "node-llama-cpp is required for LOCAL_LLAMACPP tasks. Install it with: bun add node-llama-cpp"
      );
    }
  }
  return _sdk;
}

export function getLlamaCppSdk(): typeof import("node-llama-cpp") {
  if (!_sdk) {
    throw new Error("LlamaCpp SDK not loaded; call loadSdk() first");
  }
  return _sdk;
}

type LlamaInstance = Awaited<ReturnType<(typeof import("node-llama-cpp"))["getLlama"]>>;
type LlamaModel = Awaited<ReturnType<LlamaInstance["loadModel"]>>;
type LlamaContext = Awaited<ReturnType<LlamaModel["createContext"]>>;
type LlamaEmbeddingContext = Awaited<ReturnType<LlamaModel["createEmbeddingContext"]>>;

let llamaInstance: LlamaInstance | undefined;
/** @internal Used by unload task */
export const llamaCppModels = new Map<string, LlamaModel>();
/** @internal Used by unload task */
export const llamaCppTextContexts = new Map<string, LlamaContext>();
/** @internal Used by unload task */
export const llamaCppEmbeddingContexts = new Map<string, LlamaEmbeddingContext>();

/** Maps model_url (or model_path when used as URI) to the actual downloaded filesystem path. */
export const resolvedPaths = new Map<string, string>();

export async function getLlamaInstance(): Promise<LlamaInstance> {
  if (!llamaInstance) {
    const { getLlama } = await loadSdk();
    llamaInstance = await getLlama();
  }
  return llamaInstance;
}

export function getConfigKey(model: LlamaCppModelConfig): string {
  return model.provider_config.model_url ?? model.provider_config.model_path;
}

export function getActualModelPath(model: LlamaCppModelConfig): string {
  const key = getConfigKey(model);
  const resolved = resolvedPaths.get(key);
  return resolved ?? model.provider_config.model_path;
}

export async function getOrLoadModel(model: LlamaCppModelConfig): Promise<LlamaModel> {
  const modelPath = getActualModelPath(model);
  const cached = llamaCppModels.get(modelPath);
  if (cached) return cached;

  const llama = await getLlamaInstance();
  const config = model.provider_config;

  const loadedModel = await llama.loadModel({
    modelPath,
    ...(config.gpu_layers !== undefined && { gpuLayers: config.gpu_layers }),
  });

  llamaCppModels.set(modelPath, loadedModel);
  return loadedModel;
}

export async function getOrCreateTextContext(model: LlamaCppModelConfig): Promise<LlamaContext> {
  const modelPath = getActualModelPath(model);
  const cached = llamaCppTextContexts.get(modelPath);
  if (cached) return cached;

  const loadedModel = await getOrLoadModel(model);
  const config = model.provider_config;

  const context = await loadedModel.createContext({
    ...(config.context_size && { contextSize: config.context_size }),
    ...(config.flash_attention !== undefined && { flashAttention: config.flash_attention }),
  });

  llamaCppTextContexts.set(modelPath, context);
  return context;
}

export async function getOrCreateEmbeddingContext(
  model: LlamaCppModelConfig
): Promise<LlamaEmbeddingContext> {
  const modelPath = getActualModelPath(model);
  const cached = llamaCppEmbeddingContexts.get(modelPath);
  if (cached) return cached;

  const loadedModel = await getOrLoadModel(model);

  const context = await loadedModel.createEmbeddingContext();

  llamaCppEmbeddingContexts.set(modelPath, context);
  return context;
}

export async function* streamFromSession<T extends Record<string, unknown>>(
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

export async function disposeLlamaCppResources(): Promise<void> {
  const disposeAll = async (map: Map<string, { dispose(): Promise<void> }>) => {
    for (const resource of map.values()) {
      await resource.dispose().catch(() => {});
    }
    map.clear();
  };

  await disposeAll(llamaCppTextContexts as Map<string, { dispose(): Promise<void> }>);
  await disposeAll(llamaCppEmbeddingContexts as Map<string, { dispose(): Promise<void> }>);
  await disposeAll(llamaCppModels as Map<string, { dispose(): Promise<void> }>);

  if (llamaInstance) {
    await (llamaInstance as any).dispose?.().catch(() => {});
    llamaInstance = undefined;
  }

  resolvedPaths.clear();
}
