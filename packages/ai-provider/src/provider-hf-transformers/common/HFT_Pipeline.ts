/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PretrainedModelOptions, ProgressInfo } from "@huggingface/transformers";
import { getLogger } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";

let _transformersSdk: typeof import("@huggingface/transformers") | undefined;
let _cacheDir: string | undefined;

/**
 * Set the filesystem cache directory for downloaded transformers.js models.
 * Must be called before any model is loaded. Works in both Node and browser.
 */
export function setHftCacheDir(dir: string): void {
  _cacheDir = dir;
  if (_transformersSdk) {
    _transformersSdk.env.cacheDir = dir;
  }
}

export async function loadTransformersSDK() {
  if (!_transformersSdk) {
    try {
      _transformersSdk = await import("@huggingface/transformers");
      _transformersSdk.env.fetch = abortableFetch as typeof fetch;
      if (_cacheDir) {
        _transformersSdk.env.cacheDir = _cacheDir;
      }
    } catch {
      throw new Error(
        "@huggingface/transformers is required for HuggingFace Transformers tasks. Install it with: bun add @huggingface/transformers"
      );
    }
  }
  return _transformersSdk;
}

/** Per-model AbortControllers used by abortableFetch; keyed by model_path. */
const modelAbortControllers = new Map<string, AbortController>();

function abortableFetch(url: string, options: RequestInit): Promise<Response> {
  let signal: AbortSignal | undefined;
  try {
    const pathname = new URL(url).pathname;
    for (const [modelPath, controller] of modelAbortControllers) {
      if (pathname.includes(`/${modelPath}/`)) {
        signal = controller.signal;
        break;
      }
    }
  } catch {
    /* not a parseable URL, proceed without abort */
  }
  return fetch(url, { ...options, ...(signal ? { signal } : {}) });
}

const pipelines = new Map<string, any>();

/** In-flight pipeline loads by cache key. Ensures only one load per model at a time to avoid corrupt ONNX files (Protobuf parsing failed). */
const pipelineLoadPromises = new Map<string, Promise<any>>();

/**
 * Clear all cached pipelines
 */
export function clearPipelineCache(): void {
  pipelines.clear();
}

export function hasCachedPipeline(cacheKey: string): boolean {
  return pipelines.has(cacheKey);
}

export function removeCachedPipeline(cacheKey: string): boolean {
  return pipelines.delete(cacheKey);
}

/** True when running in a browser. Transformers.js only accepts device "wasm" in the browser build. */
function isBrowserEnv(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as any).window !== "undefined";
}

/**
 * Generate a cache key for a pipeline that includes all configuration options
 * that affect pipeline creation (model_path, pipeline, dtype, device)
 */
export function getPipelineCacheKey(model: HfTransformersOnnxModelConfig): string {
  const dtype = model.provider_config.dtype || "q8";
  const device = model.provider_config.device || "";
  return `${model.provider_config.model_path}:${model.provider_config.pipeline}:${dtype}:${device}`;
}

/**
 * Helper function to get a pipeline for a model
 * @param progressScaleMax - Maximum progress value for download phase (100 for download-only, 10 for download+run)
 *
 * Explicit `Promise<any>` return avoids TS2883 (inferred type not portable across package boundaries).
 */
export async function getPipeline(
  model: HfTransformersOnnxModelConfig,
  onProgress: (progress: number, message?: string, details?: any) => void,
  options: PretrainedModelOptions = {},
  signal?: AbortSignal,
  progressScaleMax: number = 10
): Promise<any> {
  const cacheKey = getPipelineCacheKey(model);
  if (pipelines.has(cacheKey)) {
    getLogger().debug("HFT pipeline cache hit", { cacheKey });
    return pipelines.get(cacheKey);
  }

  // Output[number]-flight: only one load per model at a time to avoid concurrent writes to the same
  // ONNX cache path (which can yield "Protobuf parsing failed" when one process reads while another writes).
  const inFlight = pipelineLoadPromises.get(cacheKey);
  if (inFlight) {
    await inFlight;
    const cached = pipelines.get(cacheKey);
    if (cached) return cached;
    // Load failed for the other caller; fall through to retry (we remove from map in finally).
  }

  const loadPromise = doGetPipeline(
    model,
    onProgress,
    options,
    progressScaleMax,
    cacheKey,
    signal
  ).finally(() => {
    pipelineLoadPromises.delete(cacheKey);
  });
  pipelineLoadPromises.set(cacheKey, loadPromise);
  return loadPromise;
}

const doGetPipeline = async (
  model: HfTransformersOnnxModelConfig,
  onProgress: (progress: number, message?: string, details?: any) => void,
  options: PretrainedModelOptions,
  progressScaleMax: number,
  cacheKey: string,
  signal?: AbortSignal
) => {
  // Throttle state for progress events
  let lastProgressTime = 0;
  type FilesByteMap = Record<string, { loaded: number; total: number }>;
  let pendingProgress: {
    progress: number;
    file: string;
    fileProgress: number;
    filesMap?: FilesByteMap;
  } | null = null;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  const THROTTLE_MS = 160;

  const buildProgressDetails = (
    file: string,
    fileProgress: number,
    filesMap?: FilesByteMap
  ): { file: string; progress: number; files?: FilesByteMap } => {
    const details: { file: string; progress: number; files?: FilesByteMap } = {
      file,
      progress: fileProgress,
    };
    if (filesMap && Object.keys(filesMap).length > 0) {
      details.files = filesMap;
    }
    return details;
  };

  /**
   * Sends a progress event, throttled to avoid flooding the worker channel.
   * Always sends first event and final (>=progressScaleMax) immediately.
   */
  const sendProgress = (
    progress: number,
    file: string,
    fileProgress: number,
    filesMap?: FilesByteMap
  ): void => {
    const now = Date.now();
    const timeSinceLastEvent = now - lastProgressTime;
    const isFirst = lastProgressTime === 0;
    const isFinal = progress >= progressScaleMax;

    if (isFirst || isFinal) {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      pendingProgress = null;
      onProgress(
        Math.round(progress),
        "Downloading model",
        buildProgressDetails(file, fileProgress, filesMap)
      );
      lastProgressTime = now;
      return;
    }

    if (timeSinceLastEvent < THROTTLE_MS) {
      pendingProgress = { progress, file, fileProgress, filesMap };
      if (!throttleTimer) {
        const timeRemaining = Math.max(1, THROTTLE_MS - timeSinceLastEvent);
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          if (pendingProgress) {
            const p = pendingProgress;
            onProgress(
              Math.round(p.progress),
              "Downloading model",
              buildProgressDetails(p.file, p.fileProgress, p.filesMap)
            );
            lastProgressTime = Date.now();
            pendingProgress = null;
          }
        }, timeRemaining);
      }
      return;
    }

    onProgress(
      Math.round(progress),
      "Downloading model",
      buildProgressDetails(file, fileProgress, filesMap)
    );
    lastProgressTime = now;
    pendingProgress = null;
  };

  // Get the abort signal from the signal parameter
  const abortSignal = signal;

  // Register a per-model AbortController so abortableFetch can cancel in-flight fetches
  const modelPath = model.provider_config.model_path;
  const modelController = new AbortController();
  modelAbortControllers.set(modelPath, modelController);
  if (abortSignal) {
    if (abortSignal.aborted) {
      modelController.abort();
    } else {
      abortSignal.addEventListener("abort", () => modelController.abort(), { once: true });
    }
  }

  // Use aggregate progress_total event from @huggingface/transformers v4 pipeline()
  const progressCallback = (status: ProgressInfo) => {
    if (abortSignal?.aborted) return;

    if ((status as any).status === "progress_total") {
      const totalStatus = status as any;
      const scaledProgress = (totalStatus.progress * progressScaleMax) / 100;

      // Find the currently active file (one still downloading)
      let activeFile = "";
      let activeFileProgress = 0;
      const files: Record<string, { loaded: number; total: number }> | undefined =
        totalStatus.files;
      if (files) {
        for (const [file, info] of Object.entries(files)) {
          if (info.loaded < info.total) {
            activeFile = file;
            activeFileProgress = info.total > 0 ? (info.loaded / info.total) * 100 : 0;
            break;
          }
        }
        if (!activeFile) {
          const fileNames = Object.keys(files);
          if (fileNames.length > 0) {
            activeFile = fileNames[fileNames.length - 1];
            activeFileProgress = 100;
          }
        }
      }

      sendProgress(scaledProgress, activeFile, activeFileProgress, files);
    }
  };

  let device = model.provider_config.device as string | undefined;
  if (!isBrowserEnv()) {
    if (device === "wasm" || device === "webgpu") {
      device = undefined;
    }
  }

  const pipelineOptions: PretrainedModelOptions = {
    dtype: model.provider_config.dtype || "q8",
    ...(model.provider_config.use_external_data_format
      ? { useExternalDataFormat: model.provider_config.use_external_data_format }
      : {}),
    ...(device ? { device: device as any } : {}),
    ...options,
    progress_callback: progressCallback,
  };

  // Check if already aborted before starting
  if (abortSignal?.aborted) {
    modelAbortControllers.delete(modelPath);
    throw new Error("Operation aborted before pipeline creation");
  }

  const pipelineType = model.provider_config.pipeline;

  const { pipeline } = await loadTransformersSDK();

  const logger = getLogger();
  const pipelineTimerLabel = `hft:pipeline:${cacheKey}`;
  logger.time(pipelineTimerLabel, { pipelineType, modelPath });

  try {
    const result = await pipeline(pipelineType, model.provider_config.model_path, pipelineOptions);

    // Flush pending throttled progress and clean up timer
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    // pendingProgress may have been set by progressCallback during the pipeline() await
    const finalPending = pendingProgress as {
      progress: number;
      file: string;
      fileProgress: number;
      filesMap?: FilesByteMap;
    } | null;
    if (finalPending) {
      onProgress(
        Math.round(finalPending.progress),
        "Downloading model",
        buildProgressDetails(finalPending.file, finalPending.fileProgress, finalPending.filesMap)
      );
      pendingProgress = null;
    }

    // Check if aborted after pipeline creation
    if (abortSignal?.aborted) {
      logger.timeEnd(pipelineTimerLabel, { status: "aborted" });
      throw new Error("Operation aborted after pipeline creation");
    }

    logger.timeEnd(pipelineTimerLabel, { status: "loaded" });
    pipelines.set(cacheKey, result);
    return result;
  } catch (error: any) {
    logger.timeEnd(pipelineTimerLabel, { status: "error", error: String(error) });
    // If aborted, throw a clean abort error rather than internal stream errors
    if (abortSignal?.aborted || modelController.signal.aborted) {
      throw new Error("Pipeline download aborted");
    }
    throw error;
  } finally {
    modelAbortControllers.delete(modelPath);
  }
};
