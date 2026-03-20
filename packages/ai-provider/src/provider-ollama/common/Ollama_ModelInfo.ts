/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";
import { getOllamaModelName } from "./Ollama_ModelUtil";

type GetClient = (model: OllamaModelConfig | undefined) => Promise<any>;

export function createOllamaModelInfo(
  getClient: GetClient
): AiProviderRunFn<ModelInfoTaskInput, ModelInfoTaskOutput, OllamaModelConfig> {
  return async (input, model) => {
    const client = await getClient(model);
    const modelName = getOllamaModelName(model);

    let is_cached = false;
    let is_loaded = false;
    let file_sizes: Record<string, number> | null = null;

    try {
      const showResponse = await client.show({ model: modelName });
      is_cached = true;
      const size = (showResponse as any).size as number | undefined;
      if (size != null) {
        file_sizes = { model: size };
      }
    } catch {
      // Model not available on server
    }

    try {
      const psResponse = await client.ps();
      is_loaded = psResponse.models.some((m: any) => m.name === modelName);
    } catch {
      // ps() not available or failed
    }

    return {
      model: input.model,
      is_local: true,
      is_remote: false,
      supports_browser: true,
      supports_node: true,
      is_cached,
      is_loaded,
      file_sizes,
    };
  };
}
