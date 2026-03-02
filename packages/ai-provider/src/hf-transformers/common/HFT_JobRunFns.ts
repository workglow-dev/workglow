/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BackgroundRemovalPipeline,
  DocumentQuestionAnsweringOutput,
  FeatureExtractionPipeline,
  FillMaskOutput,
  FillMaskPipeline,
  ImageClassificationPipeline,
  ImageFeatureExtractionPipeline,
  ImageSegmentationPipeline,
  ImageToTextPipeline,
  Message,
  ObjectDetectionPipeline,
  PretrainedModelOptions,
  ProgressInfo,
  QuestionAnsweringPipeline,
  RawImage,
  SummarizationOutput,
  SummarizationPipeline,
  TextClassificationOutput,
  TextClassificationPipeline,
  TextGenerationOutput,
  TextGenerationPipeline,
  TokenClassificationOutput,
  TokenClassificationPipeline,
  TranslationOutput,
  TranslationPipeline,
  ZeroShotClassificationPipeline,
  ZeroShotImageClassificationPipeline,
  ZeroShotObjectDetectionPipeline,
} from "@huggingface/transformers";
import type {
  AiProviderReactiveRunFn,
  AiProviderRunFn,
  AiProviderStreamFn,
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput,
  CountTokensTaskInput,
  CountTokensTaskOutput,
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  ImageToTextTaskInput,
  ImageToTextTaskOutput,
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  TextFillMaskTaskInput,
  TextFillMaskTaskOutput,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  TextNamedEntityRecognitionTaskInput,
  TextNamedEntityRecognitionTaskOutput,
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolDefinition,
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
} from "@workglow/ai";
import { buildToolDescription, filterValidToolCalls } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";

let _transformersSdk: typeof import("@huggingface/transformers") | undefined;
async function loadTransformersSDK() {
  if (!_transformersSdk) {
    try {
      _transformersSdk = await import("@huggingface/transformers");
      _transformersSdk.env.fetch = abortableFetch as typeof fetch;
    } catch {
      throw new Error(
        "@huggingface/transformers is required for HuggingFace Transformers tasks. Install it with: bun add @huggingface/transformers"
      );
    }
  }
  return _transformersSdk;
}

import { getLogger, TypedArray } from "@workglow/util";
import { HTF_CACHE_NAME } from "./HFT_Constants";
import { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";

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

/**
 * Generate a cache key for a pipeline that includes all configuration options
 * that affect pipeline creation (model_path, pipeline, dtype, device)
 */
function getPipelineCacheKey(model: HfTransformersOnnxModelConfig): string {
  const dtype = model.provider_config.dtype || "q8";
  const device = model.provider_config.device || "";
  return `${model.provider_config.model_path}:${model.provider_config.pipeline}:${dtype}:${device}`;
}

/**
 * Helper function to get a pipeline for a model
 * @param progressScaleMax - Maximum progress value for download phase (100 for download-only, 10 for download+run)
 */
const getPipeline = async (
  model: HfTransformersOnnxModelConfig,
  onProgress: (progress: number, message?: string, details?: any) => void,
  options: PretrainedModelOptions = {},
  signal?: AbortSignal,
  progressScaleMax: number = 10
) => {
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
};

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
  let pendingProgress: { progress: number; file: string; fileProgress: number } | null = null;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  const THROTTLE_MS = 160;

  /**
   * Sends a progress event, throttled to avoid flooding the worker channel.
   * Always sends first event and final (>=progressScaleMax) immediately.
   */
  const sendProgress = (progress: number, file: string, fileProgress: number): void => {
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
      onProgress(Math.round(progress), "Downloading model", { file, progress: fileProgress });
      lastProgressTime = now;
      return;
    }

    if (timeSinceLastEvent < THROTTLE_MS) {
      pendingProgress = { progress, file, fileProgress };
      if (!throttleTimer) {
        const timeRemaining = Math.max(1, THROTTLE_MS - timeSinceLastEvent);
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          if (pendingProgress) {
            onProgress(Math.round(pendingProgress.progress), "Downloading model", {
              file: pendingProgress.file,
              progress: pendingProgress.fileProgress,
            });
            lastProgressTime = Date.now();
            pendingProgress = null;
          }
        }, timeRemaining);
      }
      return;
    }

    onProgress(Math.round(progress), "Downloading model", { file, progress: fileProgress });
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

      sendProgress(scaledProgress, activeFile, activeFileProgress);
    }
  };

  const pipelineOptions: PretrainedModelOptions = {
    dtype: model.provider_config.dtype || "q8",
    ...(model.provider_config.use_external_data_format
      ? { useExternalDataFormat: model.provider_config.use_external_data_format }
      : {}),
    ...(model.provider_config.device ? { device: model.provider_config.device as any } : {}),
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
    } | null;
    if (finalPending) {
      onProgress(Math.round(finalPending.progress), "Downloading model", {
        file: finalPending.file,
        progress: finalPending.fileProgress,
      });
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

/**
 * Core implementation for downloading and caching a Hugging Face Transformers model.
 * This is shared between inline and worker implementations.
 */
export const HFT_Download: AiProviderRunFn<
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const logger = getLogger();
  const timerLabel = `hft:Download:${model?.provider_config.model_path}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  // Download the model by creating a pipeline
  // Use 100 as progressScaleMax since this is download-only (0-100%)
  await getPipeline(model!, onProgress, {}, signal, 100);

  logger.timeEnd(timerLabel, { model: model?.provider_config.model_path });
  return {
    model: input.model!,
  };
};

/**
 * Core implementation for unloading a Hugging Face Transformers model.
 * This is shared between inline and worker implementations.
 */
export const HFT_Unload: AiProviderRunFn<
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  // Delete the pipeline from the in-memory map
  const cacheKey = getPipelineCacheKey(model!);
  if (pipelines.has(cacheKey)) {
    pipelines.delete(cacheKey);
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

/**
 * Deletes all cache entries for a given model path
 * @param model_path - The model path to delete from cache
 */
const deleteModelCache = async (model_path: string): Promise<void> => {
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
  let deletedCount = 0;
  for (const request of requestsToDelete) {
    try {
      const deleted = await cache.delete(request);
      if (deleted) {
        deletedCount++;
      } else {
        // If delete returns false, try with URL string as fallback
        const deletedByUrl = await cache.delete(request.url);
        if (deletedByUrl) {
          deletedCount++;
        }
      }
    } catch (error) {
      console.error(`Failed to delete cache entry: ${request.url}`, error);
    }
  }
};

/**
 * Core implementation for text embedding using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */

export const HFT_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const logger = getLogger();
  const timerLabel = `hft:TextEmbedding:${model?.provider_config.model_path}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  const generateEmbedding: FeatureExtractionPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );

  logger.debug("HFT TextEmbedding: pipeline ready, generating embedding", {
    model: model?.provider_config.model_path,
    inputLength: Array.isArray(input.text) ? input.text.length : input.text?.length,
  });

  // Generate the embedding
  const hfVector = await generateEmbedding(input.text, {
    pooling: model?.provider_config.pooling || "mean",
    normalize: model?.provider_config.normalize,
  });

  const isArrayInput = Array.isArray(input.text);
  const embeddingDim = model?.provider_config.native_dimensions;

  // If the input is an array, the tensor will have multiple dimensions (e.g., [10, 384])
  // We need to split it into separate vectors for each input text
  if (isArrayInput && hfVector.dims.length > 1) {
    const [numTexts, vectorDim] = hfVector.dims;

    // Validate that the number of texts matches
    if (numTexts !== input.text.length) {
      throw new Error(
        `HuggingFace Embedding tensor batch size does not match input array length: ${numTexts} != ${input.text.length}`
      );
    }

    // Validate dimensions
    if (vectorDim !== embeddingDim) {
      throw new Error(
        `HuggingFace Embedding vector dimension does not match model dimensions: ${vectorDim} != ${embeddingDim}`
      );
    }

    // Extract each embedding vector using tensor indexing
    // hfVector[i] returns a sub-tensor for the i-th text
    // .slice() is required to create independent TypedArrays with their own ArrayBuffers,
    // because sub-tensor views all share the same backing buffer, which causes DataCloneError
    // when postMessage tries to transfer the same ArrayBuffer multiple times.
    const vectors: TypedArray[] = Array.from({ length: numTexts }, (_, i) =>
      ((hfVector as any)[i].data as TypedArray).slice()
    );

    logger.timeEnd(timerLabel, { batchSize: numTexts, dimensions: vectorDim });
    return { vector: vectors };
  }

  // Output[number] text input - validate dimensions
  if (hfVector.size !== embeddingDim) {
    logger.timeEnd(timerLabel, { status: "error", reason: "dimension mismatch" });
    console.warn(
      `HuggingFace Embedding vector length does not match model dimensions v${hfVector.size} != m${embeddingDim}`,
      input,
      hfVector
    );
    throw new Error(
      `HuggingFace Embedding vector length does not match model dimensions v${hfVector.size} != m${embeddingDim}`
    );
  }

  logger.timeEnd(timerLabel, { dimensions: hfVector.size });
  return { vector: hfVector.data as TypedArray };
};

export const HFT_TextClassification: AiProviderRunFn<
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  if (model?.provider_config?.pipeline === "zero-shot-classification") {
    if (
      !input.candidateLabels ||
      !Array.isArray(input.candidateLabels) ||
      input.candidateLabels.length === 0
    ) {
      throw new Error("Zero-shot text classification requires candidate labels");
    }

    const zeroShotClassifier: ZeroShotClassificationPipeline = await getPipeline(
      model!,
      onProgress,
      {},
      signal
    );
    const result: any = await zeroShotClassifier(
      input.text as any,
      input.candidateLabels as string[],
      {}
    );

    if (isArrayInput) {
      // Batch result: result is an array of { labels, scores } per input
      const results = Array.isArray(result) && Array.isArray(result[0]?.labels) ? result : [result];
      return {
        categories: results.map((r: any) =>
          r.labels.map((label: string, idx: number) => ({
            label,
            score: r.scores[idx],
          }))
        ),
      };
    }

    return {
      categories: result.labels.map((label: string, idx: number) => ({
        label,
        score: result.scores[idx],
      })),
    };
  }

  const TextClassification: TextClassificationPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );
  const result = await TextClassification(input.text as any, {
    top_k: input.maxCategories || undefined,
  });

  if (isArrayInput) {
    // Batch result: outer array per input, inner array of categories
    return {
      categories: (result as any[]).map((perInput: any) => {
        const items = Array.isArray(perInput) ? perInput : [perInput];
        return items.map((category: any) => ({
          label: category.label as string,
          score: category.score as number,
        }));
      }),
    };
  }

  if (Array.isArray(result[0])) {
    return {
      categories: result[0].map((category) => ({
        label: category.label,
        score: category.score,
      })),
    };
  }

  return {
    categories: (result as TextClassificationOutput).map((category) => ({
      label: category.label,
      score: category.score,
    })),
  };
};

export const HFT_TextLanguageDetection: AiProviderRunFn<
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  const TextClassification: TextClassificationPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );
  const result = await TextClassification(input.text as any, {
    top_k: input.maxLanguages || undefined,
  });

  if (isArrayInput) {
    return {
      languages: (result as any[]).map((perInput: any) => {
        const items = Array.isArray(perInput) ? perInput : [perInput];
        return items.map((category: any) => ({
          language: category.label as string,
          score: category.score as number,
        }));
      }),
    };
  }

  if (Array.isArray(result[0])) {
    return {
      languages: result[0].map((category) => ({
        language: category.label,
        score: category.score,
      })),
    };
  }

  return {
    languages: (result as TextClassificationOutput).map((category) => ({
      language: category.label,
      score: category.score,
    })),
  };
};

export const HFT_TextNamedEntityRecognition: AiProviderRunFn<
  TextNamedEntityRecognitionTaskInput,
  TextNamedEntityRecognitionTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  const textNamedEntityRecognition: TokenClassificationPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );
  const results = await textNamedEntityRecognition(input.text as any, {
    ignore_labels: input.blockList as string[] | undefined,
  });

  if (isArrayInput) {
    return {
      entities: (results as unknown as TokenClassificationOutput[]).map((perInput) => {
        const items = Array.isArray(perInput) ? perInput : [perInput];
        return items.map((entity) => ({
          entity: entity.entity,
          score: entity.score,
          word: entity.word,
        }));
      }),
    };
  }

  let entities: TokenClassificationOutput = [];
  if (!Array.isArray(results)) {
    entities = [results];
  } else {
    entities = results as TokenClassificationOutput;
  }
  return {
    entities: entities.map((entity) => ({
      entity: entity.entity,
      score: entity.score,
      word: entity.word,
    })),
  };
};

export const HFT_TextFillMask: AiProviderRunFn<
  TextFillMaskTaskInput,
  TextFillMaskTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  const unmasker: FillMaskPipeline = await getPipeline(model!, onProgress, {}, signal);
  const results = await unmasker(input.text as any);

  if (isArrayInput) {
    return {
      predictions: (results as unknown as FillMaskOutput[]).map((perInput) => {
        const items = Array.isArray(perInput) ? perInput : [perInput];
        return items.map((prediction) => ({
          entity: prediction.token_str,
          score: prediction.score,
          sequence: prediction.sequence,
        }));
      }),
    };
  }

  let predictions: FillMaskOutput = [];
  if (!Array.isArray(results)) {
    predictions = [results];
  } else {
    predictions = results as FillMaskOutput;
  }
  return {
    predictions: predictions.map((prediction) => ({
      entity: prediction.token_str,
      score: prediction.score,
      sequence: prediction.sequence,
    })),
  };
};

/**
 * Core implementation for text generation using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const logger = getLogger();
  const timerLabel = `hft:TextGeneration:${model?.provider_config.model_path}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  const isArrayInput = Array.isArray(input.prompt);

  const generateText: TextGenerationPipeline = await getPipeline(model!, onProgress, {}, signal);

  logger.debug("HFT TextGeneration: pipeline ready, generating text", {
    model: model?.provider_config.model_path,
    promptLength: isArrayInput ? (input.prompt as string[]).length : input.prompt?.length,
  });

  const streamer = isArrayInput
    ? undefined
    : createTextStreamer(generateText.tokenizer, onProgress);

  let results = await generateText(input.prompt as any, {
    ...(streamer ? { streamer } : {}),
  });

  if (isArrayInput) {
    // Batch result: results is an array, one entry per prompt
    const batchResults = Array.isArray(results) ? results : [results];
    const texts = batchResults.map((r) => {
      const seqs = Array.isArray(r) ? r : [r];
      return extractGeneratedText((seqs[0] as TextGenerationOutput[number])?.generated_text);
    });
    logger.timeEnd(timerLabel, { batchSize: texts.length });
    return { text: texts };
  }

  if (!Array.isArray(results)) {
    results = [results];
  }
  const text = extractGeneratedText((results[0] as TextGenerationOutput[number])?.generated_text);
  logger.timeEnd(timerLabel, { outputLength: text?.length });
  return {
    text,
  };
};

/**
 * Core implementation for text translation using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextTranslation: AiProviderRunFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  const translate: TranslationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const streamer = isArrayInput ? undefined : createTextStreamer(translate.tokenizer, onProgress);

  const result = await translate(
    input.text as any,
    {
      src_lang: input.source_lang,
      tgt_lang: input.target_lang,
      ...(streamer ? { streamer } : {}),
    } as any
  );

  if (isArrayInput) {
    const batchResults = Array.isArray(result) ? result : [result];
    return {
      text: batchResults.map((r) => (r as TranslationOutput[number])?.translation_text || ""),
      target_lang: input.target_lang,
    };
  }

  const translatedText = Array.isArray(result)
    ? (result[0] as TranslationOutput[number])?.translation_text || ""
    : (result as TranslationOutput[number])?.translation_text || "";

  return {
    text: translatedText,
    target_lang: input.target_lang,
  };
};

/**
 * Core implementation for text rewriting using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  const generateText: TextGenerationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const streamer = isArrayInput
    ? undefined
    : createTextStreamer(generateText.tokenizer, onProgress);

  if (isArrayInput) {
    const texts = input.text as string[];
    const promptedTexts = texts.map((t) => (input.prompt ? input.prompt + "\n" : "") + t);

    let results = await generateText(promptedTexts, {});

    const batchResults = Array.isArray(results) ? results : [results];
    const outputTexts = batchResults.map((r, i) => {
      const seqs = Array.isArray(r) ? r : [r];
      const text = extractGeneratedText((seqs[0] as TextGenerationOutput[number])?.generated_text);
      if (text === promptedTexts[i]) {
        throw new Error("Rewriter failed to generate new text");
      }
      return text;
    });

    return { text: outputTexts };
  }

  // This lib doesn't support this kind of rewriting with a separate prompt vs text
  const promptedText = (input.prompt ? input.prompt + "\n" : "") + input.text;

  let results = await generateText(promptedText, {
    ...(streamer ? { streamer } : {}),
  });

  if (!Array.isArray(results)) {
    results = [results];
  }

  const text = extractGeneratedText((results[0] as TextGenerationOutput[number])?.generated_text);

  if (text === promptedText) {
    throw new Error("Rewriter failed to generate new text");
  }

  return {
    text,
  };
};

/**
 * Core implementation for text summarization using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  const generateSummary: SummarizationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const streamer = isArrayInput
    ? undefined
    : createTextStreamer(generateSummary.tokenizer, onProgress);

  const result = await generateSummary(
    input.text as any,
    {
      ...(streamer ? { streamer } : {}),
    } as any
  );

  if (isArrayInput) {
    const batchResults = Array.isArray(result) ? result : [result];
    return {
      text: batchResults.map((r) => (r as SummarizationOutput[number])?.summary_text || ""),
    };
  }

  let summaryText = "";
  if (Array.isArray(result)) {
    summaryText = (result[0] as SummarizationOutput[number])?.summary_text || "";
  } else {
    summaryText = (result as SummarizationOutput[number])?.summary_text || "";
  }

  return {
    text: summaryText,
  };
};

/**
 * Core implementation for question answering using Hugging Face Transformers.
 * This is shared between inline and worker implementations.
 */
export const HFT_TextQuestionAnswer: AiProviderRunFn<
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.question);

  // Get the question answering pipeline
  const generateAnswer: QuestionAnsweringPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );

  if (isArrayInput) {
    const questions = input.question as string[];
    const contexts = input.context as string[];
    if (questions.length !== contexts.length) {
      throw new Error(
        `question[] and context[] must have the same length: ${questions.length} != ${contexts.length}`
      );
    }

    const answers: string[] = [];
    for (let i = 0; i < questions.length; i++) {
      const result = await generateAnswer(questions[i], contexts[i], {} as any);
      let answerText = "";
      if (Array.isArray(result)) {
        answerText = (result[0] as DocumentQuestionAnsweringOutput[number])?.answer || "";
      } else {
        answerText = (result as DocumentQuestionAnsweringOutput[number])?.answer || "";
      }
      answers.push(answerText);
    }

    return { text: answers };
  }

  const streamer = createTextStreamer(generateAnswer.tokenizer, onProgress);

  const result = await generateAnswer(
    input.question as string,
    input.context as string,
    {
      streamer,
    } as any
  );

  let answerText = "";
  if (Array.isArray(result)) {
    answerText = (result[0] as DocumentQuestionAnsweringOutput[number])?.answer || "";
  } else {
    answerText = (result as DocumentQuestionAnsweringOutput[number])?.answer || "";
  }

  return {
    text: answerText,
  };
};

/**
 * Core implementation for image segmentation using Hugging Face Transformers.
 */
export const HFT_ImageSegmentation: AiProviderRunFn<
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const segmenter: ImageSegmentationPipeline = await getPipeline(model!, onProgress, {}, signal);

  const result = await segmenter(input.image as any, {
    threshold: input.threshold,
    mask_threshold: input.maskThreshold,
  });

  const masks = Array.isArray(result) ? result : [result];

  const processedMasks = await Promise.all(
    masks.map(async (mask) => ({
      label: mask.label || "",
      score: mask.score || 0,
      mask: {} as { [x: string]: unknown },
    }))
  );

  return {
    masks: processedMasks,
  };
};

/**
 * Core implementation for image to text using Hugging Face Transformers.
 */
export const HFT_ImageToText: AiProviderRunFn<
  ImageToTextTaskInput,
  ImageToTextTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const captioner: ImageToTextPipeline = await getPipeline(model!, onProgress, {}, signal);

  const result: any = await captioner(input.image as string, {
    max_new_tokens: input.maxTokens,
  });

  const text = Array.isArray(result) ? result[0]?.generated_text : result?.generated_text;

  return {
    text: text || "",
  };
};

/**
 * Core implementation for background removal using Hugging Face Transformers.
 */
export const HFT_BackgroundRemoval: AiProviderRunFn<
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const remover: BackgroundRemovalPipeline = await getPipeline(model!, onProgress, {}, signal);

  const result = await remover(input.image as string);

  const resultImage = Array.isArray(result) ? result[0] : result;

  return {
    image: imageToBase64(resultImage),
  };
};

/**
 * Core implementation for image embedding using Hugging Face Transformers.
 */
export const HFT_ImageEmbedding: AiProviderRunFn<
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const logger = getLogger();
  const timerLabel = `hft:ImageEmbedding:${model?.provider_config.model_path}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  const embedder: ImageFeatureExtractionPipeline = await getPipeline(
    model!,
    onProgress,
    {},
    signal
  );

  logger.debug("HFT ImageEmbedding: pipeline ready, generating embedding", {
    model: model?.provider_config.model_path,
  });

  const result: any = await embedder(input.image as string);

  logger.timeEnd(timerLabel, { dimensions: result?.data?.length });
  return {
    vector: result.data as TypedArray,
  } as ImageEmbeddingTaskOutput;
};

/**
 * Core implementation for image classification using Hugging Face Transformers.
 * Auto-selects between regular and zero-shot classification.
 */
export const HFT_ImageClassification: AiProviderRunFn<
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  if (model?.provider_config?.pipeline === "zero-shot-image-classification") {
    if (!input.categories || !Array.isArray(input.categories) || input.categories.length === 0) {
      console.warn("Zero-shot image classification requires categories", input);
      throw new Error("Zero-shot image classification requires categories");
    }
    const zeroShotClassifier: ZeroShotImageClassificationPipeline = await getPipeline(
      model!,
      onProgress,
      {},
      signal
    );
    const result: any = await zeroShotClassifier(
      input.image as string,
      input.categories! as string[],
      {}
    );

    const results = Array.isArray(result) ? result : [result];

    return {
      categories: results.map((r: any) => ({
        label: r.label,
        score: r.score,
      })),
    };
  }

  const classifier: ImageClassificationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const result: any = await classifier(input.image as string, {
    top_k: (input as any).maxCategories,
  });

  const results = Array.isArray(result) ? result : [result];

  return {
    categories: results.map((r: any) => ({
      label: r.label,
      score: r.score,
    })),
  };
};

/**
 * Core implementation for object detection using Hugging Face Transformers.
 * Auto-selects between regular and zero-shot detection.
 */
export const HFT_ObjectDetection: AiProviderRunFn<
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  if (model?.provider_config?.pipeline === "zero-shot-object-detection") {
    if (!input.labels || !Array.isArray(input.labels) || input.labels.length === 0) {
      throw new Error("Zero-shot object detection requires labels");
    }
    const zeroShotDetector: ZeroShotObjectDetectionPipeline = await getPipeline(
      model!,
      onProgress,
      {},
      signal
    );
    const result: any = await zeroShotDetector(input.image as string, Array.from(input.labels!), {
      threshold: (input as any).threshold,
    });

    const detections = Array.isArray(result) ? result : [result];

    return {
      detections: detections.map((d: any) => ({
        label: d.label,
        score: d.score,
        box: d.box,
      })),
    };
  }

  const detector: ObjectDetectionPipeline = await getPipeline(model!, onProgress, {}, signal);
  const result: any = await detector(input.image as string, {
    threshold: (input as any).threshold,
  });

  const detections = Array.isArray(result) ? result : [result];

  return {
    detections: detections.map((d: any) => ({
      label: d.label,
      score: d.score,
      box: d.box,
    })),
  };
};
/**
 * Helper function to convert RawImage to base64 PNG
 */
function imageToBase64(image: RawImage): string {
  // Convert RawImage to base64 PNG
  // This is a simplified version - actual implementation would use canvas or similar
  return (image as any).toBase64?.() || "";
}

/**
 * Create a text streamer for a given tokenizer and update progress function
 * @param tokenizer - The tokenizer to use for the streamer
 * @param updateProgress - The function to call to update the progress
 * @returns The text streamer
 */
function createTextStreamer(
  tokenizer: any,
  updateProgress: (progress: number, message?: string, details?: any) => void
) {
  const { TextStreamer } = _transformersSdk!;
  let count = 0;
  return new TextStreamer(tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: (text: string) => {
      count++;
      const result = 100 * (1 - Math.exp(-0.05 * count));
      const progress = Math.round(Math.min(result, 100));
      updateProgress(progress, "Generating", { text, progress });
    },
  });
}

function extractGeneratedText(generatedText: string | Message[] | undefined): string {
  if (generatedText == null) return "";
  if (typeof generatedText === "string") return generatedText;
  const lastMessage = generatedText[generatedText.length - 1];
  if (!lastMessage) return "";
  const content = lastMessage.content;
  if (typeof content === "string") return content;
  for (const part of content) {
    if (part.type === "text" && "text" in part) {
      return (part as { type: "text"; text: string }).text;
    }
  }
  return "";
}

// ========================================================================
// Streaming support: converts TextStreamer callback to AsyncIterable
// ========================================================================

type StreamEventQueue<T> = {
  push: (event: T) => void;
  done: () => void;
  error: (err: Error) => void;
  iterable: AsyncIterable<T>;
};

function createStreamEventQueue<T>(): StreamEventQueue<T> {
  const buffer: T[] = [];
  let resolve: ((value: IteratorResult<T>) => void) | null = null;
  let finished = false;
  let err: Error | null = null;

  const push = (event: T) => {
    if (resolve) {
      const r = resolve;
      resolve = null;
      r({ value: event, done: false });
    } else {
      buffer.push(event);
    }
  };

  const done = () => {
    finished = true;
    if (resolve) {
      const r = resolve;
      resolve = null;
      r({ value: undefined as any, done: true });
    }
  };

  const error = (e: Error) => {
    err = e;
    if (resolve) {
      const r = resolve;
      resolve = null;
      r({ value: undefined as any, done: true });
    }
  };

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (err) return Promise.reject(err);
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift()!, done: false });
          }
          if (finished) {
            return Promise.resolve({ value: undefined as any, done: true });
          }
          return new Promise<IteratorResult<T>>((r) => {
            resolve = r;
          });
        },
      };
    },
  };

  return { push, done, error, iterable };
}

/**
 * Creates a TextStreamer that pushes StreamEvents into an async queue.
 * The pipeline runs to completion and updates the queue; the caller
 * consumes the queue as an AsyncIterable<StreamEvent>.
 */
function createStreamingTextStreamer(tokenizer: any, queue: StreamEventQueue<StreamEvent<any>>) {
  const { TextStreamer } = _transformersSdk!;
  return new TextStreamer(tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: (text: string) => {
      queue.push({ type: "text-delta", port: "text", textDelta: text });
    },
  });
}

/**
 * State machine that filters `<tool_call>…</tool_call>` markup out of a
 * stream of text-delta tokens. Tokens that are clearly outside markup are
 * flushed immediately; tokens that *might* be the start of a tag are held
 * in a lookahead buffer until they can be disambiguated.
 *
 * This only handles the XML-tag pattern (Pattern 1 in parseToolCallsFromText).
 * Bare-JSON tool calls (Pattern 2) cannot be reliably detected token-by-token
 * and are still cleaned up via the post-hoc `parseToolCallsFromText` pass on
 * the finish event.
 */
export function createToolCallMarkupFilter(emit: (text: string) => void) {
  const OPEN_TAG = "<tool_call>";
  const CLOSE_TAG = "</tool_call>";

  /** "text" = normal output, "tag" = inside a tool_call block */
  let state: "text" | "tag" = "text";
  /** Buffered text that might be a partial tag prefix */
  let pending = "";

  function feed(token: string) {
    if (state === "tag") {
      // Inside a tool_call block — suppress everything until we see the close tag
      pending += token;
      const closeIdx = pending.indexOf(CLOSE_TAG);
      if (closeIdx !== -1) {
        // End of the tool_call block; resume normal output after the close tag
        const afterClose = pending.slice(closeIdx + CLOSE_TAG.length);
        pending = "";
        state = "text";
        if (afterClose.length > 0) {
          feed(afterClose);
        }
      }
      // else: still inside the tag block, keep suppressing
      return;
    }

    // state === "text"
    const combined = pending + token;

    // Check for a complete open tag
    const openIdx = combined.indexOf(OPEN_TAG);
    if (openIdx !== -1) {
      // Emit everything before the tag
      const before = combined.slice(0, openIdx);
      if (before.length > 0) {
        emit(before);
      }
      // Switch to tag state; feed the remainder (after the open tag) back through
      pending = "";
      state = "tag";
      const afterOpen = combined.slice(openIdx + OPEN_TAG.length);
      if (afterOpen.length > 0) {
        feed(afterOpen);
      }
      return;
    }

    // Check if the tail of `combined` could be the start of "<tool_call>"
    // e.g. combined ends with "<", "<t", "<to", ..., "<tool_call"
    let prefixLen = 0;
    for (let len = Math.min(combined.length, OPEN_TAG.length - 1); len >= 1; len--) {
      if (combined.endsWith(OPEN_TAG.slice(0, len))) {
        prefixLen = len;
        break;
      }
    }

    if (prefixLen > 0) {
      // The tail is ambiguous — hold it back, flush the rest
      const safe = combined.slice(0, combined.length - prefixLen);
      if (safe.length > 0) {
        emit(safe);
      }
      pending = combined.slice(combined.length - prefixLen);
    } else {
      // No ambiguity — flush everything
      if (combined.length > 0) {
        emit(combined);
      }
      pending = "";
    }
  }

  /** Flush any remaining buffered text (called when the stream ends). */
  function flush() {
    if (pending.length > 0 && state === "text") {
      emit(pending);
      pending = "";
    }
    // If state === "tag", the pending content is suppressed tool-call markup
    pending = "";
    state = "text";
  }

  return { feed, flush };
}

// ========================================================================
// Streaming implementations (append mode)
// ========================================================================

export const HFT_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const noopProgress = () => {};
  const generateText: TextGenerationPipeline = await getPipeline(model!, noopProgress, {}, signal);

  const queue = createStreamEventQueue<StreamEvent<TextGenerationTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateText.tokenizer, queue);

  const pipelinePromise = generateText(input.prompt as string, {
    streamer,
  }).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};

export const HFT_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const noopProgress = () => {};
  const generateText: TextGenerationPipeline = await getPipeline(model!, noopProgress, {}, signal);

  const queue = createStreamEventQueue<StreamEvent<TextRewriterTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateText.tokenizer, queue);

  const promptedText = (input.prompt ? input.prompt + "\n" : "") + (input.text as string);

  const pipelinePromise = generateText(promptedText, {
    streamer,
  }).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;
  yield { type: "finish", data: {} as TextRewriterTaskOutput };
};

export const HFT_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const noopProgress = () => {};
  const generateSummary: SummarizationPipeline = await getPipeline(
    model!,
    noopProgress,
    {},
    signal
  );

  const queue = createStreamEventQueue<StreamEvent<TextSummaryTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateSummary.tokenizer, queue);

  const pipelinePromise = generateSummary(
    input.text as string,
    {
      streamer,
    } as any
  ).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;
  yield { type: "finish", data: {} as TextSummaryTaskOutput };
};

export const HFT_TextQuestionAnswer_Stream: AiProviderStreamFn<
  TextQuestionAnswerTaskInput,
  TextQuestionAnswerTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextQuestionAnswerTaskOutput>> {
  const noopProgress = () => {};
  const generateAnswer: QuestionAnsweringPipeline = await getPipeline(
    model!,
    noopProgress,
    {},
    signal
  );

  const queue = createStreamEventQueue<StreamEvent<TextQuestionAnswerTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateAnswer.tokenizer, queue);

  let pipelineResult:
    | DocumentQuestionAnsweringOutput[number]
    | DocumentQuestionAnsweringOutput
    | undefined;
  const pipelinePromise = generateAnswer(
    input.question as string,
    input.context as string,
    {
      streamer,
    } as any
  ).then(
    (result) => {
      pipelineResult = result;
      queue.done();
    },
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;

  let answerText = "";
  if (pipelineResult !== undefined) {
    if (Array.isArray(pipelineResult)) {
      answerText = (pipelineResult[0] as DocumentQuestionAnsweringOutput[number])?.answer ?? "";
    } else {
      answerText = (pipelineResult as DocumentQuestionAnsweringOutput[number])?.answer ?? "";
    }
  }
  yield { type: "finish", data: { text: answerText } as TextQuestionAnswerTaskOutput };
};

export const HFT_TextTranslation_Stream: AiProviderStreamFn<
  TextTranslationTaskInput,
  TextTranslationTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextTranslationTaskOutput>> {
  const noopProgress = () => {};
  const translate: TranslationPipeline = await getPipeline(model!, noopProgress, {}, signal);

  const queue = createStreamEventQueue<StreamEvent<TextTranslationTaskOutput>>();
  const streamer = createStreamingTextStreamer(translate.tokenizer, queue);

  const pipelinePromise = translate(
    input.text as string,
    {
      src_lang: input.source_lang,
      tgt_lang: input.target_lang,
      streamer,
    } as any
  ).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;
  yield { type: "finish", data: { target_lang: input.target_lang } as TextTranslationTaskOutput };
};

export const HFT_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.text);

  const { AutoTokenizer } = _transformersSdk!;
  const tokenizer = await AutoTokenizer.from_pretrained(model!.provider_config.model_path, {
    progress_callback: (progress: any) => onProgress(progress?.progress ?? 0),
  });

  if (isArrayInput) {
    const texts = input.text as string[];
    const counts = texts.map((t) => tokenizer.encode(t).length);
    return { count: counts };
  }

  // encode() returns number[] of token IDs for a single input string
  const tokenIds = tokenizer.encode(input.text as string);
  return { count: tokenIds.length };
};

export const HFT_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, _output, model) => {
  return HFT_CountTokens(input, model, () => {}, new AbortController().signal);
};

// ========================================================================
// Tool calling implementations
// ========================================================================

function mapHFTTools(tools: ReadonlyArray<ToolDefinition>) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));
}

/**
 * Parse tool calls from model-generated text.
 *
 * Many instruct models (Qwen, Llama, Hermes, etc.) emit tool calls in one of
 * these formats:
 *
 * 1. `<tool_call>{"name":"fn","arguments":{...}}</tool_call>` (Qwen/Hermes)
 * 2. Plain JSON objects with a "name" + "arguments" key
 * 3. `{"function":{"name":"fn","arguments":{...}}}`
 *
 * This function extracts all such tool calls from the raw response text
 * and returns both the cleaned text (with tool-call markup removed) and
 * the parsed ToolCall array.
 */
export function parseToolCallsFromText(responseText: string): {
  text: string;
  toolCalls: Record<string, unknown>;
} {
  const toolCalls: Record<string, unknown> = {};
  let callIndex = 0;
  let cleanedText = responseText;

  // Pattern 1: <tool_call>...</tool_call> blocks (Qwen, Hermes, etc.)
  const toolCallTagRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let tagMatch;
  while ((tagMatch = toolCallTagRegex.exec(responseText)) !== null) {
    try {
      const parsed = JSON.parse(tagMatch[1].trim());
      const id = `call_${callIndex++}`;
      toolCalls[id] = {
        id,
        name: parsed.name ?? parsed.function?.name ?? "",
        input: (parsed.arguments ??
          parsed.function?.arguments ??
          parsed.parameters ??
          {}) as Record<string, unknown>,
      };
    } catch {
      // Not valid JSON inside the tag, skip
    }
  }

  if (Object.keys(toolCalls).length > 0) {
    // Remove tool_call tags from the text output
    cleanedText = responseText.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
    return { text: cleanedText, toolCalls };
  }

  // Pattern 2: Use a brace-balanced scanner to correctly handle nested JSON objects.
  const jsonCandidates: Array<{ text: string; start: number; end: number }> = [];
  (function collectBalancedJsonBlocks(source: string) {
    const length = source.length;
    let i = 0;
    while (i < length) {
      if (source[i] !== "{") {
        i++;
        continue;
      }
      let depth = 1;
      let j = i + 1;
      let inString = false;
      let escape = false;
      while (j < length && depth > 0) {
        const ch = source[j];
        if (inString) {
          if (escape) {
            escape = false;
          } else if (ch === "\\") {
            escape = true;
          } else if (ch === '"') {
            inString = false;
          }
        } else {
          if (ch === '"') {
            inString = true;
          } else if (ch === "{") {
            depth++;
          } else if (ch === "}") {
            depth--;
          }
        }
        j++;
      }
      if (depth === 0) {
        jsonCandidates.push({ text: source.slice(i, j), start: i, end: j });
        i = j;
      } else {
        break;
      }
    }
  })(responseText);

  const matchedRanges: Array<{ start: number; end: number }> = [];
  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate.text);
      if (parsed.name && (parsed.arguments !== undefined || parsed.parameters !== undefined)) {
        const id = `call_${callIndex++}`;
        toolCalls[id] = {
          id,
          name: parsed.name as string,
          input: (parsed.arguments ?? parsed.parameters ?? {}) as Record<string, unknown>,
        };
        matchedRanges.push({ start: candidate.start, end: candidate.end });
      } else if (parsed.function?.name) {
        let functionArgs: unknown = parsed.function.arguments ?? {};
        if (typeof functionArgs === "string") {
          try {
            functionArgs = JSON.parse(functionArgs);
          } catch (innerError) {
            console.warn("Failed to parse tool call function.arguments as JSON", innerError);
            functionArgs = {};
          }
        }
        const id = `call_${callIndex++}`;
        toolCalls[id] = {
          id,
          name: parsed.function.name as string,
          input: (functionArgs ?? {}) as Record<string, unknown>,
        };
        matchedRanges.push({ start: candidate.start, end: candidate.end });
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  if (Object.keys(toolCalls).length > 0) {
    // Remove only the matched JSON portions, preserving surrounding text
    let result = "";
    let lastIndex = 0;
    for (const range of matchedRanges) {
      result += responseText.slice(lastIndex, range.start);
      lastIndex = range.end;
    }
    result += responseText.slice(lastIndex);
    cleanedText = result.trim();
  }

  return { text: cleanedText, toolCalls };
}

/**
 * Resolve the tools list and optionally mutate the messages array based on the toolChoice option.
 * - "none": no tools
 * - "required": all tools + adds a system instruction so the model must call a tool
 * - specific name: filter to that tool (falls back to all tools if not found)
 * - "auto" / undefined: all tools
 */
function resolveHFTToolsAndMessages(
  input: ToolCallingTaskInput,
  messages: Array<{ role: string; content: string }>
): ReturnType<typeof mapHFTTools> | undefined {
  if (input.toolChoice === "none") {
    return undefined;
  }

  if (input.toolChoice === "required") {
    const requiredInstruction =
      "You must call at least one tool from the provided tool list when answering.";
    if (messages.length > 0 && messages[0].role === "system") {
      messages[0] = { ...messages[0], content: `${messages[0].content}\n\n${requiredInstruction}` };
    } else {
      messages.unshift({ role: "system", content: requiredInstruction });
    }
    return mapHFTTools(input.tools);
  }

  if (typeof input.toolChoice === "string" && input.toolChoice !== "auto") {
    // Specific tool name: filter to that tool if it exists
    const selectedTools = input.tools?.filter(
      (tool: ToolDefinition) => tool.name === input.toolChoice
    );
    const toolsToMap = selectedTools && selectedTools.length > 0 ? selectedTools : input.tools;
    return mapHFTTools(toolsToMap);
  }

  return mapHFTTools(input.tools);
}

export const HFT_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const isArrayInput = Array.isArray(input.prompt);

  const generateText: TextGenerationPipeline = await getPipeline(model!, onProgress, {}, signal);

  if (isArrayInput) {
    const prompts = input.prompt as string[];
    const texts: string[] = [];
    const allToolCalls: Record<string, unknown>[] = [];

    for (const promptText of prompts) {
      const messages: Array<{ role: string; content: string }> = [];
      if (input.systemPrompt) {
        messages.push({ role: "system", content: input.systemPrompt as string });
      }
      messages.push({ role: "user", content: promptText });

      const singleInput = { ...input, prompt: promptText } as ToolCallingTaskInput;
      const tools = resolveHFTToolsAndMessages(singleInput, messages);

      const prompt = (generateText.tokenizer as any).apply_chat_template(messages, {
        tools,
        tokenize: false,
        add_generation_prompt: true,
      }) as string;

      let results = await generateText(prompt, {
        max_new_tokens: input.maxTokens ?? 1024,
        temperature: input.temperature ?? undefined,
        return_full_text: false,
      });

      if (!Array.isArray(results)) {
        results = [results];
      }

      const responseText = extractGeneratedText(
        (results[0] as TextGenerationOutput[number])?.generated_text
      ).trim();

      const parsed = parseToolCallsFromText(responseText);
      texts.push(parsed.text);
      allToolCalls.push(filterValidToolCalls(parsed.toolCalls, input.tools));
    }

    return { text: texts, toolCalls: allToolCalls };
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt as string });
  }
  messages.push({ role: "user", content: input.prompt as string });

  const tools = resolveHFTToolsAndMessages(input, messages);

  // Use the tokenizer's chat template to format the prompt with tool definitions
  const prompt = (generateText.tokenizer as any).apply_chat_template(messages, {
    tools,
    tokenize: false,
    add_generation_prompt: true,
  }) as string;

  const streamer = createTextStreamer(generateText.tokenizer, onProgress);

  let results = await generateText(prompt, {
    max_new_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? undefined,
    return_full_text: false,
    streamer,
  });

  if (!Array.isArray(results)) {
    results = [results];
  }

  const responseText = extractGeneratedText(
    (results[0] as TextGenerationOutput[number])?.generated_text
  ).trim();

  const { text, toolCalls } = parseToolCallsFromText(responseText);
  return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
};

export const HFT_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const noopProgress = () => {};
  const generateText: TextGenerationPipeline = await getPipeline(model!, noopProgress, {}, signal);

  const messages: Array<{ role: string; content: string }> = [];
  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt as string });
  }
  messages.push({ role: "user", content: input.prompt as string });

  const tools = resolveHFTToolsAndMessages(input, messages);

  const prompt = (generateText.tokenizer as any).apply_chat_template(messages, {
    tools,
    tokenize: false,
    add_generation_prompt: true,
  }) as string;

  // Two queues: the inner queue receives raw tokens from the TextStreamer,
  // the outer queue receives filtered text-delta events (markup stripped).
  const innerQueue = createStreamEventQueue<StreamEvent<ToolCallingTaskOutput>>();
  const outerQueue = createStreamEventQueue<StreamEvent<ToolCallingTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateText.tokenizer, innerQueue);

  let fullText = "";
  const filter = createToolCallMarkupFilter((text) => {
    outerQueue.push({ type: "text-delta", port: "text", textDelta: text });
  });

  // Intercept raw text-delta events: accumulate the full text for post-hoc
  // parsing and feed tokens through the markup filter before forwarding.
  const originalPush = innerQueue.push;
  innerQueue.push = (event: StreamEvent<ToolCallingTaskOutput>) => {
    if (event.type === "text-delta" && "textDelta" in event) {
      fullText += event.textDelta;
      filter.feed(event.textDelta);
    } else {
      outerQueue.push(event);
    }
    // Still call originalPush so the inner queue's done/error mechanics work
    originalPush(event);
  };

  const originalDone = innerQueue.done;
  innerQueue.done = () => {
    filter.flush();
    outerQueue.done();
    originalDone();
  };

  const originalError = innerQueue.error;
  innerQueue.error = (e: Error) => {
    filter.flush();
    outerQueue.error(e);
    originalError(e);
  };

  const pipelinePromise = generateText(prompt, {
    max_new_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? undefined,
    return_full_text: false,
    streamer,
  }).then(
    () => innerQueue.done(),
    (err: Error) => innerQueue.error(err)
  );

  yield* outerQueue.iterable;
  await pipelinePromise;

  // Parse the accumulated (unfiltered) text for tool calls. The filter already
  // stripped tag-based markup from text-delta events; this pass also handles
  // bare-JSON tool calls and produces the canonical cleanedText for the finish event.
  const { text: cleanedText, toolCalls } = parseToolCallsFromText(fullText);
  const validToolCalls = filterValidToolCalls(toolCalls, input.tools);

  if (Object.keys(validToolCalls).length > 0) {
    yield { type: "object-delta", port: "toolCalls", objectDelta: { ...validToolCalls } };
  }

  yield {
    type: "finish",
    data: { text: cleanedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
  };
};

// ========================================================================
// Model info
// ========================================================================

/** In-memory cache for HF Hub API file-size responses to avoid repeated network calls. */
const hfHubFileSizeCache = new Map<string, Record<string, number> | null>();

/** Fetch file sizes for a HuggingFace model from the Hub API (used when the model is not yet cached locally). */
async function fetchHFHubFileSizes(model_path: string): Promise<Record<string, number> | null> {
  if (hfHubFileSizeCache.has(model_path)) {
    return hfHubFileSizeCache.get(model_path)!;
  }

  try {
    const response = await fetch(`https://huggingface.co/api/models/${model_path}`);
    if (!response.ok) {
      hfHubFileSizeCache.set(model_path, null);
      return null;
    }

    const data = (await response.json()) as {
      siblings?: Array<{ rfilename: string; size?: number | null; lfs?: { size: number } | null }>;
    };

    const siblings = data.siblings;
    if (!siblings || siblings.length === 0) {
      hfHubFileSizeCache.set(model_path, null);
      return null;
    }

    const sizes: Record<string, number> = {};
    for (const sibling of siblings) {
      const size = sibling.lfs?.size ?? sibling.size;
      if (size && size > 0) {
        sizes[sibling.rfilename] = size;
      }
    }

    const result = Object.keys(sizes).length > 0 ? sizes : null;
    hfHubFileSizeCache.set(model_path, result);
    return result;
  } catch {
    hfHubFileSizeCache.set(model_path, null);
    return null;
  }
}

export const HFT_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model) => {
  const is_loaded = pipelines.has(getPipelineCacheKey(model!));

  let is_cached = is_loaded;
  let file_sizes: Record<string, number> | null = null;

  // Try the browser Cache API to check for downloaded model files
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(HTF_CACHE_NAME);
      const keys = await cache.keys();
      const model_path = model!.provider_config.model_path;
      const prefix = `/${model_path}/`;
      const sizes: Record<string, number> = {};

      for (const request of keys) {
        const url = new URL(request.url);
        if (url.pathname.startsWith(prefix)) {
          is_cached = true;
          const response = await cache.match(request);
          const contentLength = response?.headers.get("Content-Length");
          if (contentLength) {
            const filename = url.pathname.slice(prefix.length);
            sizes[filename] = parseInt(contentLength, 10);
          }
        }
      }

      if (Object.keys(sizes).length > 0) {
        file_sizes = sizes;
      }
    } catch {
      // Cache API not available or failed
    }
  }

  // If the model is not cached locally, fall back to the HF Hub API for file sizes
  if (!is_cached) {
    file_sizes = await fetchHFHubFileSizes(model!.provider_config.model_path);
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

// ========================================================================
// Task registries
// ========================================================================

/**
 * All HuggingFace Transformers task run functions, keyed by task type name.
 * Pass this to `new HuggingFaceTransformersProvider(HFT_TASKS, HFT_STREAM_TASKS, HFT_REACTIVE_TASKS)` when the
 * actual run function implementations are needed (inline mode, worker server).
 */
export const HFT_TASKS = {
  DownloadModelTask: HFT_Download,
  UnloadModelTask: HFT_Unload,
  ModelInfoTask: HFT_ModelInfo,
  CountTokensTask: HFT_CountTokens,
  TextEmbeddingTask: HFT_TextEmbedding,
  TextGenerationTask: HFT_TextGeneration,
  TextQuestionAnswerTask: HFT_TextQuestionAnswer,
  TextLanguageDetectionTask: HFT_TextLanguageDetection,
  TextClassificationTask: HFT_TextClassification,
  TextFillMaskTask: HFT_TextFillMask,
  TextNamedEntityRecognitionTask: HFT_TextNamedEntityRecognition,
  TextRewriterTask: HFT_TextRewriter,
  TextSummaryTask: HFT_TextSummary,
  TextTranslationTask: HFT_TextTranslation,
  ImageSegmentationTask: HFT_ImageSegmentation,
  ImageToTextTask: HFT_ImageToText,
  BackgroundRemovalTask: HFT_BackgroundRemoval,
  ImageEmbeddingTask: HFT_ImageEmbedding,
  ImageClassificationTask: HFT_ImageClassification,
  ObjectDetectionTask: HFT_ObjectDetection,
  ToolCallingTask: HFT_ToolCalling,
} as const;

/**
 * Streaming variants of HuggingFace Transformers task run functions.
 * Pass this as the second argument to `new HuggingFaceTransformersProvider(HFT_TASKS, HFT_STREAM_TASKS, HFT_REACTIVE_TASKS)`.
 */
export const HFT_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, HfTransformersOnnxModelConfig>
> = {
  TextGenerationTask: HFT_TextGeneration_Stream,
  TextRewriterTask: HFT_TextRewriter_Stream,
  TextSummaryTask: HFT_TextSummary_Stream,
  TextQuestionAnswerTask: HFT_TextQuestionAnswer_Stream,
  TextTranslationTask: HFT_TextTranslation_Stream,
  ToolCallingTask: HFT_ToolCalling_Stream,
};

export const HFT_REACTIVE_TASKS: Record<
  string,
  AiProviderReactiveRunFn<any, any, HfTransformersOnnxModelConfig>
> = {
  CountTokensTask: HFT_CountTokens_Reactive,
};
