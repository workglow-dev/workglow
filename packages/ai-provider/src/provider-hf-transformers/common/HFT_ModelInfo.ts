/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DeviceType } from "@huggingface/transformers";
import type { AiProviderRunFn, ModelInfoTaskInput, ModelInfoTaskOutput } from "@workglow/ai";
import { getLogger } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { parseOnnxQuantizations } from "./HFT_OnnxDtypes";
import { getPipelineCacheKey, hasCachedPipeline, loadTransformersSDK } from "./HFT_Pipeline";

export const HFT_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model) => {
  const logger = getLogger();
  const { ModelRegistry } = await loadTransformersSDK();
  const timerLabel = `hft:ModelInfo:${model?.provider_config.model_path}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  const detail = input.detail;
  const is_loaded = hasCachedPipeline(getPipelineCacheKey(model!));

  const { pipeline: pipelineType, model_path, dtype, device } = model!.provider_config;

  const cacheOptions = {
    ...(dtype ? { dtype } : {}),
    ...(device ? { device: device as DeviceType } : {}),
  };
  const cacheStatus = await ModelRegistry.is_pipeline_cached_files(
    pipelineType,
    model_path,
    cacheOptions
  );
  logger.debug("is_pipeline_cached", {
    input: [pipelineType, model_path, cacheOptions],
    result: cacheStatus,
  });
  const is_cached = is_loaded || cacheStatus.allCached;

  // Build file_sizes based on requested detail level
  let file_sizes: Record<string, number> | null = null;
  if (detail === "files" && cacheStatus.files.length > 0) {
    // Return file names with zero sizes (no network calls)
    const sizes: Record<string, number> = {};
    for (const { file } of cacheStatus.files) {
      sizes[file] = 0;
    }
    file_sizes = sizes;
  } else if (detail === "files_with_metadata" && cacheStatus.files.length > 0) {
    // Full metadata fetch per file (N network calls)
    const sizes: Record<string, number> = {};
    await Promise.all(
      cacheStatus.files.map(async ({ file }) => {
        const metadata = await ModelRegistry.get_file_metadata(model_path, file);
        if (metadata.exists && metadata.size !== undefined) {
          sizes[file] = metadata.size;
        }
      })
    );
    if (Object.keys(sizes).length > 0) {
      file_sizes = sizes;
    }
  }

  // Parse ONNX quantizations from file list
  let quantizations: string[] | undefined;
  if (cacheStatus.files.length > 0) {
    const filePaths = cacheStatus.files.map((f) => f.file);
    const quantizations_parsed = parseOnnxQuantizations({ filePaths });
    if (quantizations_parsed.length > 0) {
      quantizations = quantizations_parsed;
    }
  }

  logger.timeEnd(timerLabel, { model: model?.provider_config.model_path });

  return {
    model: input.model,
    is_local: true,
    is_remote: false,
    supports_browser: true,
    supports_node: true,
    is_cached,
    is_loaded,
    file_sizes,
    ...(quantizations ? { quantizations } : {}),
  };
};
