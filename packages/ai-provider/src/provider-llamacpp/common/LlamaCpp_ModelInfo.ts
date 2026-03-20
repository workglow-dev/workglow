/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  getActualModelPath,
  getConfigKey,
  llamaCppModels,
  resolvedPaths,
} from "./LlamaCpp_Runtime";

export const LlamaCpp_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  LlamaCppModelConfig
> = async (input, model) => {
  if (!model) throw new Error("Model config is required for ModelInfoTask.");

  const modelPath = getActualModelPath(model);
  const is_loaded = llamaCppModels.has(modelPath);

  let is_cached = is_loaded;
  let file_sizes: Record<string, number> | null = null;

  try {
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(modelPath);
    is_cached = true;
    file_sizes = { model: stat.size };
  } catch {
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
