/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { modelTaskCache } from "./TFMP_Runtime";

export const TFMP_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  TFMPModelConfig
> = async (input, model) => {
  const model_path = model!.provider_config.model_path;
  const is_loaded = modelTaskCache.has(model_path);

  return {
    model: input.model,
    is_local: true,
    is_remote: false,
    supports_browser: true,
    supports_node: false,
    is_cached: is_loaded,
    is_loaded,
    file_sizes: null,
  };
};
