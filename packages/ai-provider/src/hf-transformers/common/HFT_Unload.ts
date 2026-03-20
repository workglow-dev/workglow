/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, UnloadModelTaskRunInput, UnloadModelTaskRunOutput } from "@workglow/ai";
import { HTF_CACHE_NAME } from "./HFT_Constants";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipelineCacheKey, removeCachedPipeline } from "./HFT_Pipeline";

/**
 * Deletes all cache entries for a given model path
 * @param model_path - The model path to delete from cache
 */
async function deleteModelCache(model_path: string): Promise<void> {
  const cache = await caches.open(HTF_CACHE_NAME);
  const keys = await cache.keys();
  const prefix = `/${model_path}/`;

  // Collect all matching requests first
  const requestsToDelete: Request[] = [];
  for (const request of keys) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(prefix)) {
      requestsToDelete.push(request);
    }
  }

  // Delete all matching requests
  for (const request of requestsToDelete) {
    try {
      const deleted = await cache.delete(request);
      if (!deleted) {
        const deletedByUrl = await cache.delete(request.url);
        if (!deletedByUrl) {
          /* ignore */
        }
      }
    } catch (error) {
      console.error(`Failed to delete cache entry: ${request.url}`, error);
    }
  }
}

/**
 * Core implementation for unloading a Hugging Face Transformers model.
 * This is shared between inline and worker implementations.
 */
export const HFT_Unload: AiProviderRunFn<
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, _signal) => {
  // Delete the pipeline from the in-memory map
  const cacheKey = getPipelineCacheKey(model!);
  if (removeCachedPipeline(cacheKey)) {
    onProgress(50, "Pipeline removed from memory");
  }

  // Delete model cache entries
  const model_path = model!.provider_config.model_path;
  await deleteModelCache(model_path);
  onProgress(100, "Model cache deleted");

  return {
    model: input.model!,
  };
};
