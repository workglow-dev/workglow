/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BackgroundRemovalPipeline,
  DocumentQuestionAnsweringSingle,
  FeatureExtractionPipeline,
  FillMaskPipeline,
  FillMaskSingle,
  ImageClassificationPipeline,
  ImageFeatureExtractionPipeline,
  ImageSegmentationPipeline,
  ImageToTextPipeline,
  ObjectDetectionPipeline,
  // @ts-ignore temporary "fix"
  PretrainedModelOptions,
  QuestionAnsweringPipeline,
  RawImage,
  SummarizationPipeline,
  SummarizationSingle,
  TextClassificationOutput,
  TextClassificationPipeline,
  TextGenerationPipeline,
  TextGenerationSingle,
  TokenClassificationPipeline,
  TokenClassificationSingle,
  TranslationPipeline,
  TranslationSingle,
  ZeroShotClassificationPipeline,
  ZeroShotImageClassificationPipeline,
  ZeroShotObjectDetectionPipeline,
} from "@sroussey/transformers";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput,
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
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";

let _transformersSdk: typeof import("@sroussey/transformers") | undefined;
async function loadTransformersSDK() {
  if (!_transformersSdk) {
    try {
      _transformersSdk = await import("@sroussey/transformers");
    } catch {
      throw new Error(
        "@sroussey/transformers is required for HuggingFace Transformers tasks. Install it with: bun add @sroussey/transformers"
      );
    }
  }
  return _transformersSdk;
}

import { TypedArray } from "@workglow/util";
import { CallbackStatus } from "./HFT_CallbackStatus";
import { HTF_CACHE_NAME } from "./HFT_Constants";
import { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";

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
  progressScaleMax: number = 10
) => {
  const cacheKey = getPipelineCacheKey(model);
  if (pipelines.has(cacheKey)) {
    return pipelines.get(cacheKey);
  }

  // Single-flight: only one load per model at a time to avoid concurrent writes to the same
  // ONNX cache path (which can yield "Protobuf parsing failed" when one process reads while another writes).
  const inFlight = pipelineLoadPromises.get(cacheKey);
  if (inFlight) {
    await inFlight;
    const cached = pipelines.get(cacheKey);
    if (cached) return cached;
    // Load failed for the other caller; fall through to retry (we remove from map in finally).
  }

  const loadPromise = doGetPipeline(model, onProgress, options, progressScaleMax, cacheKey).finally(
    () => {
      pipelineLoadPromises.delete(cacheKey);
    }
  );
  pipelineLoadPromises.set(cacheKey, loadPromise);
  return loadPromise;
};

const doGetPipeline = async (
  model: HfTransformersOnnxModelConfig,
  onProgress: (progress: number, message?: string, details?: any) => void,
  options: PretrainedModelOptions,
  progressScaleMax: number,
  cacheKey: string
) => {
  // Track file sizes and progress for weighted calculation
  const fileSizes = new Map<string, number>();
  const fileProgress = new Map<string, number>();
  const fileCompleted = new Set<string>();
  const fileFirstSent = new Set<string>();
  const fileLastSent = new Set<string>();
  const fileLastEventTime = new Map<string, number>();
  const pendingProgressByFile = new Map<
    string,
    { progress: number; file: string; fileProgress: number }
  >();
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  const THROTTLE_MS = 160;

  // Pre-estimate total download size based on typical model structure:
  // 3 tiny files (~1KB each) + 1 medium file (~20MB) + 0-2 large files (~1GB each if present)
  const estimatedTinyFiles = 3;
  const estimatedMediumFiles = 1;
  const estimatedTinySize = 1024; // 1KB
  const estimatedMediumSize = 20 * 1024 * 1024; // 20MB
  const estimatedLargeSize = 1024 * 1024 * 1024; // 1GB

  // Start with minimum estimate (4 files), add large files dynamically as we discover them
  const baseEstimate =
    estimatedTinyFiles * estimatedTinySize + estimatedMediumFiles * estimatedMediumSize;

  /**
   * Sends a progress event, respecting throttling but always sending first/last per file
   */
  const sendProgress = (
    overallProgress: number,
    file: string,
    fileProgressValue: number,
    isFirst: boolean,
    isLast: boolean
  ): void => {
    const now = Date.now();
    const lastTime = fileLastEventTime.get(file) || 0;
    const timeSinceLastEvent = now - lastTime;
    const shouldThrottle = !isFirst && !isLast && timeSinceLastEvent < THROTTLE_MS;

    if (shouldThrottle) {
      // Store pending progress for this file
      pendingProgressByFile.set(file, {
        progress: overallProgress,
        file,
        fileProgress: fileProgressValue,
      });
      // Schedule sending if not already scheduled
      if (!throttleTimer) {
        const timeRemaining = Math.max(1, THROTTLE_MS - timeSinceLastEvent);
        throttleTimer = setTimeout(() => {
          // Send all pending progress events
          for (const [pendingFile, pending] of pendingProgressByFile.entries()) {
            onProgress(Math.round(pending.progress), "Downloading model", {
              file: pendingFile,
              progress: pending.fileProgress,
            });
            fileLastEventTime.set(pendingFile, Date.now());
          }
          pendingProgressByFile.clear();
          throttleTimer = null;
        }, timeRemaining);
      }
      return;
    }

    // Send immediately
    onProgress(Math.round(overallProgress), "Downloading model", {
      file,
      progress: fileProgressValue,
    });
    fileLastEventTime.set(file, now);
    // Clear any pending progress for this file since we're sending it now
    pendingProgressByFile.delete(file);
    if (throttleTimer && pendingProgressByFile.size === 0) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
  };

  // Track whether we've seen a substantial file (to avoid premature progress reports for tiny config files)
  let hasSeenSubstantialFile = false;
  const substantialFileThreshold = 1024 * 1024; // 1MB - files larger than this are substantial

  // Get the abort signal from options if provided
  const abortSignal = options.abort_signal;

  // Create a callback status object for progress tracking
  const progressCallback = (status: CallbackStatus) => {
    // Check if operation has been aborted before processing progress
    if (abortSignal?.aborted) {
      return; // Don't process progress for aborted operations
    }

    if (status.status === "progress") {
      const file = status.file;
      const fileTotal = status.total;
      const fileProgressValue = status.progress;

      // Track file size on first progress event
      if (!fileSizes.has(file)) {
        fileSizes.set(file, fileTotal);
        fileProgress.set(file, 0);

        // Check if this is a substantial file
        if (fileTotal >= substantialFileThreshold) {
          hasSeenSubstantialFile = true;
        }
      }

      // Update file progress
      fileProgress.set(file, fileProgressValue);

      // Check if file is complete
      const isComplete = fileProgressValue >= 100;
      if (isComplete && !fileCompleted.has(file)) {
        fileCompleted.add(file);
        fileProgress.set(file, 100);
      }

      // Calculate actual loaded bytes and adjust estimated total
      let actualLoadedSize = 0;
      let actualTotalSize = 0;

      // Categorize seen files and track their actual sizes
      const tinyThreshold = 100 * 1024; // 100KB - files smaller are config/vocab
      const mediumThreshold = 100 * 1024 * 1024; // 100MB - tokenizer and small models
      let seenTinyCount = 0;
      let seenMediumCount = 0;
      let seenLargeCount = 0;

      for (const [trackedFile, size] of fileSizes.entries()) {
        actualTotalSize += size;
        const progress = fileProgress.get(trackedFile) || 0;
        actualLoadedSize += (size * progress) / 100;

        // Categorize file
        if (size < tinyThreshold) {
          seenTinyCount++;
        } else if (size < mediumThreshold) {
          seenMediumCount++;
        } else {
          seenLargeCount++;
        }
      }

      // Adjust estimated total size:
      // - Start with actual sizes of seen files
      // - Add estimates for unseen tiny/medium files
      // - For large files: conservatively assume 1 until we've seen all expected files
      const unseenTinyFiles = Math.max(0, estimatedTinyFiles - seenTinyCount);
      const unseenMediumFiles = Math.max(0, estimatedMediumFiles - seenMediumCount);

      // Dynamically estimate large files:
      // - If we've seen a large file, assume up to 2 total
      // - Otherwise, conservatively assume 1 large file might exist to prevent premature 100% progress
      // - This prevents the progress from jumping when a large file appears unexpectedly
      let estimatedLargeFiles: number;
      if (seenLargeCount > 0) {
        estimatedLargeFiles = 2; // We've seen at least one, expect up to 2
      } else {
        estimatedLargeFiles = 1; // Haven't seen any large files yet, but assume 1 might exist
      }
      const unseenLargeFiles = Math.max(0, estimatedLargeFiles - seenLargeCount);

      const adjustedTotalSize =
        actualTotalSize +
        unseenTinyFiles * estimatedTinySize +
        unseenMediumFiles * estimatedMediumSize +
        unseenLargeFiles * estimatedLargeSize;

      // Scale progress to the configured range (0-100 for download-only, 0-10 for download+run)
      const rawProgress = adjustedTotalSize > 0 ? (actualLoadedSize / adjustedTotalSize) * 100 : 0;
      const overallProgress = (rawProgress * progressScaleMax) / 100;

      // Determine if this is first or last event for this file
      const isFirst = !fileFirstSent.has(file);
      const isLast = isComplete && !fileLastSent.has(file);

      if (isFirst) {
        fileFirstSent.add(file);
      }
      if (isLast) {
        fileLastSent.add(file);
      }

      // Only report progress if we've seen a substantial file (to avoid premature 100% for tiny config files)
      if (hasSeenSubstantialFile) {
        sendProgress(overallProgress, file, fileProgressValue, isFirst, isLast);
      }
    } else if (status.status === "done" || status.status === "download") {
      // Handle file completion from bookend events
      const file = status.file;

      // Check if this file should mark the start of substantial downloads
      const fileSize = fileSizes.get(file) || 0;
      if (fileSize >= substantialFileThreshold) {
        hasSeenSubstantialFile = true;
      }

      if (!fileCompleted.has(file)) {
        fileCompleted.add(file);
        fileProgress.set(file, 100);

        // Recalculate overall progress using same logic as progress handler
        let actualLoadedSize = 0;
        let actualTotalSize = 0;

        const tinyThreshold = 100 * 1024; // 100KB - files smaller are config/vocab
        const mediumThreshold = 100 * 1024 * 1024; // 100MB - tokenizer and small models
        let seenTinyCount = 0;
        let seenMediumCount = 0;
        let seenLargeCount = 0;

        for (const [trackedFile, size] of fileSizes.entries()) {
          actualTotalSize += size;
          const progress = fileProgress.get(trackedFile) || 0;
          actualLoadedSize += (size * progress) / 100;

          // Categorize file
          if (size < tinyThreshold) {
            seenTinyCount++;
          } else if (size < mediumThreshold) {
            seenMediumCount++;
          } else {
            seenLargeCount++;
          }
        }

        // Adjust estimated total size (same logic as progress handler)
        const unseenTinyFiles = Math.max(0, estimatedTinyFiles - seenTinyCount);
        const unseenMediumFiles = Math.max(0, estimatedMediumFiles - seenMediumCount);

        // Dynamically estimate large files (same logic as progress handler)
        let estimatedLargeFiles: number;
        if (seenLargeCount > 0) {
          estimatedLargeFiles = 2;
        } else {
          estimatedLargeFiles = 1;
        }
        const unseenLargeFiles = Math.max(0, estimatedLargeFiles - seenLargeCount);

        const adjustedTotalSize =
          actualTotalSize +
          unseenTinyFiles * estimatedTinySize +
          unseenMediumFiles * estimatedMediumSize +
          unseenLargeFiles * estimatedLargeSize;

        // Scale progress to the configured range (0-100 for download-only, 0-10 for download+run)
        const rawProgress =
          adjustedTotalSize > 0 ? (actualLoadedSize / adjustedTotalSize) * 100 : 0;
        const overallProgress = (rawProgress * progressScaleMax) / 100;
        const isLast = !fileLastSent.has(file);
        if (isLast) {
          fileLastSent.add(file);
          // Only report if we've seen a substantial file
          if (hasSeenSubstantialFile) {
            sendProgress(overallProgress, file, 100, false, true);
          }
        }
      }
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
    throw new Error("Operation aborted before pipeline creation");
  }

  const pipelineType = model.provider_config.pipeline;

  // Wrap the pipeline call with abort handling
  // Create a promise that rejects when aborted
  const abortPromise = new Promise<never>((_, reject) => {
    if (abortSignal) {
      const handleAbort = () => {
        reject(new Error("Pipeline download aborted"));
      };

      if (abortSignal.aborted) {
        handleAbort();
      } else {
        abortSignal.addEventListener("abort", handleAbort, { once: true });
      }
    }
  });

  // Race between pipeline creation and abort
  const { pipeline } = await loadTransformersSDK();
  const pipelinePromise = pipeline(pipelineType, model.provider_config.model_path, pipelineOptions);

  try {
    const result = await (abortSignal
      ? Promise.race([pipelinePromise, abortPromise])
      : pipelinePromise);

    // Check if aborted after pipeline creation
    if (abortSignal?.aborted) {
      throw new Error("Operation aborted after pipeline creation");
    }

    pipelines.set(cacheKey, result);
    return result;
  } catch (error: any) {
    // If aborted, throw a clean abort error rather than internal stream errors
    if (abortSignal?.aborted) {
      throw new Error("Pipeline download aborted");
    }
    // Otherwise, re-throw the original error
    throw error;
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
  // Download the model by creating a pipeline
  // Use 100 as progressScaleMax since this is download-only (0-100%)
  await getPipeline(model!, onProgress, { abort_signal: signal }, 100);

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
  const generateEmbedding: FeatureExtractionPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });

  // Generate the embedding
  const hfVector = await generateEmbedding(input.text, {
    pooling: model?.provider_config.pooling || "mean",
    normalize: model?.provider_config.normalize,
    ...(signal ? { abort_signal: signal } : {}),
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
    const vectors: TypedArray[] = Array.from(
      { length: numTexts },
      (_, i) => (hfVector as any)[i].data as TypedArray
    );

    return { vector: vectors };
  }

  // Single text input - validate dimensions
  if (hfVector.size !== embeddingDim) {
    console.warn(
      `HuggingFace Embedding vector length does not match model dimensions v${hfVector.size} != m${embeddingDim}`,
      input,
      hfVector
    );
    throw new Error(
      `HuggingFace Embedding vector length does not match model dimensions v${hfVector.size} != m${embeddingDim}`
    );
  }

  return { vector: hfVector.data as TypedArray };
};

export const HFT_TextClassification: AiProviderRunFn<
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
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
      {
        abort_signal: signal,
      }
    );
    const result: any = await zeroShotClassifier(input.text, input.candidateLabels as string[], {});

    return {
      categories: result.labels.map((label: string, idx: number) => ({
        label,
        score: result.scores[idx],
      })),
    };
  }

  const TextClassification: TextClassificationPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });
  const result = await TextClassification(input.text, {
    top_k: input.maxCategories || undefined,
    ...(signal ? { abort_signal: signal } : {}),
  });

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
  const TextClassification: TextClassificationPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });
  const result = await TextClassification(input.text, {
    top_k: input.maxLanguages || undefined,
    ...(signal ? { abort_signal: signal } : {}),
  });

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
  const textNamedEntityRecognition: TokenClassificationPipeline = await getPipeline(
    model!,
    onProgress,
    {
      abort_signal: signal,
    }
  );
  let results = await textNamedEntityRecognition(input.text, {
    ignore_labels: input.blockList as string[] | undefined,
    ...(signal ? { abort_signal: signal } : {}),
  });
  let entities: TokenClassificationSingle[] = [];
  if (!Array.isArray(results)) {
    entities = [results];
  } else {
    entities = results as TokenClassificationSingle[];
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
  const unmasker: FillMaskPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });
  let results = await unmasker(input.text);
  let predictions: FillMaskSingle[] = [];
  if (!Array.isArray(results)) {
    predictions = [results];
  } else {
    predictions = results as FillMaskSingle[];
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
  const generateText: TextGenerationPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });

  const streamer = createTextStreamer(generateText.tokenizer, onProgress, signal);

  let results = await generateText(input.prompt, {
    streamer,
    ...(signal ? { abort_signal: signal } : {}),
  });

  if (!Array.isArray(results)) {
    results = [results];
  }
  let text = (results[0] as TextGenerationSingle)?.generated_text;

  if (Array.isArray(text)) {
    text = text[text.length - 1]?.content;
  }
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
  const translate: TranslationPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });
  const streamer = createTextStreamer(translate.tokenizer, onProgress);

  const result = await translate(input.text, {
    src_lang: input.source_lang,
    tgt_lang: input.target_lang,
    streamer,
    ...(signal ? { abort_signal: signal } : {}),
  } as any);

  const translatedText = Array.isArray(result)
    ? (result[0] as TranslationSingle)?.translation_text || ""
    : (result as TranslationSingle)?.translation_text || "";

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
  const generateText: TextGenerationPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });
  const streamer = createTextStreamer(generateText.tokenizer, onProgress);

  // This lib doesn't support this kind of rewriting with a separate prompt vs text
  const promptedText = (input.prompt ? input.prompt + "\n" : "") + input.text;

  let results = await generateText(promptedText, {
    streamer,
    ...(signal ? { abort_signal: signal } : {}),
  });

  if (!Array.isArray(results)) {
    results = [results];
  }

  let text = (results[0] as TextGenerationSingle)?.generated_text;
  if (Array.isArray(text)) {
    text = text[text.length - 1]?.content;
  }

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
  const generateSummary: SummarizationPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });
  const streamer = createTextStreamer(generateSummary.tokenizer, onProgress);

  let result = await generateSummary(input.text, {
    streamer,
    ...(signal ? { abort_signal: signal } : {}),
  } as any);

  let summaryText = "";
  if (Array.isArray(result)) {
    summaryText = (result[0] as SummarizationSingle)?.summary_text || "";
  } else {
    summaryText = (result as SummarizationSingle)?.summary_text || "";
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
  // Get the question answering pipeline
  const generateAnswer: QuestionAnsweringPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });
  const streamer = createTextStreamer(generateAnswer.tokenizer, onProgress);

  const result = await generateAnswer(input.question, input.context, {
    streamer,
    ...(signal ? { abort_signal: signal } : {}),
  } as any);

  let answerText = "";
  if (Array.isArray(result)) {
    answerText = (result[0] as DocumentQuestionAnsweringSingle)?.answer || "";
  } else {
    answerText = (result as DocumentQuestionAnsweringSingle)?.answer || "";
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
  const segmenter: ImageSegmentationPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });

  const result = await segmenter(input.image as any, {
    threshold: input.threshold,
    mask_threshold: input.maskThreshold,
    ...(signal ? { abort_signal: signal } : {}),
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
  const captioner: ImageToTextPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });

  const result: any = await captioner(input.image as string, {
    max_new_tokens: input.maxTokens,
    ...(signal ? { abort_signal: signal } : {}),
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
  const remover: BackgroundRemovalPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });

  const result = await remover(input.image as string, {
    ...(signal ? { abort_signal: signal } : {}),
  });

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
  const embedder: ImageFeatureExtractionPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });

  const result: any = await embedder(input.image as string);

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
      {
        abort_signal: signal,
      }
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

  const classifier: ImageClassificationPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });
  const result: any = await classifier(input.image as string, {
    top_k: (input as any).maxCategories,
    ...(signal ? { abort_signal: signal } : {}),
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
      {
        abort_signal: signal,
      }
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

  const detector: ObjectDetectionPipeline = await getPipeline(model!, onProgress, {
    abort_signal: signal,
  });
  const result: any = await detector(input.image as string, {
    threshold: (input as any).threshold,
    ...(signal ? { abort_signal: signal } : {}),
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
 * @param signal - The signal to use for the streamer for aborting
 * @returns The text streamer
 */
function createTextStreamer(
  tokenizer: any,
  updateProgress: (progress: number, message?: string, details?: any) => void,
  signal?: AbortSignal
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
    ...(signal ? { abort_signal: signal } : {}),
  });
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
function createStreamingTextStreamer(
  tokenizer: any,
  queue: StreamEventQueue<StreamEvent<any>>,
  signal?: AbortSignal
) {
  const { TextStreamer } = _transformersSdk!;
  return new TextStreamer(tokenizer, {
    skip_prompt: true,
    decode_kwargs: { skip_special_tokens: true },
    callback_function: (text: string) => {
      queue.push({ type: "text-delta", port: "text", textDelta: text });
    },
    ...(signal ? { abort_signal: signal } : {}),
  });
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
  const generateText: TextGenerationPipeline = await getPipeline(model!, noopProgress, {
    abort_signal: signal,
  });

  const queue = createStreamEventQueue<StreamEvent<TextGenerationTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateText.tokenizer, queue, signal);

  const pipelinePromise = generateText(input.prompt, {
    streamer,
    ...(signal ? { abort_signal: signal } : {}),
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
  const generateText: TextGenerationPipeline = await getPipeline(model!, noopProgress, {
    abort_signal: signal,
  });

  const queue = createStreamEventQueue<StreamEvent<TextRewriterTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateText.tokenizer, queue);

  const promptedText = (input.prompt ? input.prompt + "\n" : "") + input.text;

  const pipelinePromise = generateText(promptedText, {
    streamer,
    ...(signal ? { abort_signal: signal } : {}),
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
  const generateSummary: SummarizationPipeline = await getPipeline(model!, noopProgress, {
    abort_signal: signal,
  });

  const queue = createStreamEventQueue<StreamEvent<TextSummaryTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateSummary.tokenizer, queue);

  const pipelinePromise = generateSummary(input.text, {
    streamer,
    ...(signal ? { abort_signal: signal } : {}),
  } as any).then(
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
  const generateAnswer: QuestionAnsweringPipeline = await getPipeline(model!, noopProgress, {
    abort_signal: signal,
  });

  const queue = createStreamEventQueue<StreamEvent<TextQuestionAnswerTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateAnswer.tokenizer, queue);

  let pipelineResult:
    | DocumentQuestionAnsweringSingle
    | DocumentQuestionAnsweringSingle[]
    | undefined;
  const pipelinePromise = generateAnswer(input.question, input.context, {
    streamer,
    ...(signal ? { abort_signal: signal } : {}),
  } as any).then(
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
      answerText = (pipelineResult[0] as DocumentQuestionAnsweringSingle)?.answer ?? "";
    } else {
      answerText = (pipelineResult as DocumentQuestionAnsweringSingle)?.answer ?? "";
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
  const translate: TranslationPipeline = await getPipeline(model!, noopProgress, {
    abort_signal: signal,
  });

  const queue = createStreamEventQueue<StreamEvent<TextTranslationTaskOutput>>();
  const streamer = createStreamingTextStreamer(translate.tokenizer, queue);

  const pipelinePromise = translate(input.text, {
    src_lang: input.source_lang,
    tgt_lang: input.target_lang,
    streamer,
    ...(signal ? { abort_signal: signal } : {}),
  } as any).then(
    () => queue.done(),
    (err: Error) => queue.error(err)
  );

  yield* queue.iterable;
  await pipelinePromise;
  yield { type: "finish", data: { target_lang: input.target_lang } as TextTranslationTaskOutput };
};

// ========================================================================
// Task registries
// ========================================================================

/**
 * All HuggingFace Transformers task run functions, keyed by task type name.
 * Pass this to `new HuggingFaceTransformersProvider(HFT_TASKS)` when the
 * actual run function implementations are needed (inline mode, worker server).
 */
export const HFT_TASKS = {
  DownloadModelTask: HFT_Download,
  UnloadModelTask: HFT_Unload,
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
} as const;

/**
 * Streaming variants of HuggingFace Transformers task run functions.
 * Pass this as the second argument to `new HuggingFaceTransformersProvider(HFT_TASKS, HFT_STREAM_TASKS)`.
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
};
