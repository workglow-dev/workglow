/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FilesetResolver,
  LanguageDetector,
  TextClassifier,
  TextEmbedder,
} from "@mediapipe/tasks-text";
import {
  FaceDetector,
  FaceLandmarker,
  GestureRecognizer,
  HandLandmarker,
  ImageClassifier,
  ImageEmbedder,
  ImageSegmenter,
  ObjectDetector,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import type {
  AiProviderRunFn,
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  FaceDetectorTaskInput,
  FaceDetectorTaskOutput,
  FaceLandmarkerTaskInput,
  FaceLandmarkerTaskOutput,
  GestureRecognizerTaskInput,
  GestureRecognizerTaskOutput,
  HandLandmarkerTaskInput,
  HandLandmarkerTaskOutput,
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
  PoseLandmarkerTaskInput,
  PoseLandmarkerTaskOutput,
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { TFMPModelConfig } from "./TFMP_ModelSchema";

interface TFMPWasmFileset {
  /** The path to the Wasm loader script. */
  wasmLoaderPath: string;
  /** The path to the Wasm binary. */
  wasmBinaryPath: string;
  /** The optional path to the asset loader script. */
  assetLoaderPath?: string;
  /** The optional path to the assets binary. */
  assetBinaryPath?: string;
}

/**
 * Cache for WASM filesets by task engine (text, audio, vision, genai).
 * Multiple models may share the same WASM fileset.
 */
const wasm_tasks = new Map<string, TFMPWasmFileset>();

/**
 * Reference counts tracking how many models are using each WASM fileset.
 * When count reaches 0, the WASM fileset can be safely unloaded.
 */
const wasm_reference_counts = new Map<string, number>();

/**
 * Helper function to get a WASM task for a model
 */
const getWasmTask = async (
  model: TFMPModelConfig,
  onProgress: (progress: number, message?: string, details?: any) => void,
  signal: AbortSignal
): Promise<TFMPWasmFileset> => {
  const task_engine = model.provider_config.task_engine;

  if (wasm_tasks.has(task_engine)) {
    return wasm_tasks.get(task_engine)!;
  }

  if (signal.aborted) {
    throw new PermanentJobError("Aborted job");
  }

  onProgress(0.1, "Loading WASM task");

  let wasmFileset: TFMPWasmFileset;

  switch (task_engine) {
    case "text":
      wasmFileset = await FilesetResolver.forTextTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@latest/wasm"
      );
      break;
    case "audio":
      wasmFileset = await FilesetResolver.forAudioTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@latest/wasm"
      );
      break;
    case "vision":
      wasmFileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      break;
    case "genai":
      wasmFileset = await FilesetResolver.forGenAiTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@latest/wasm"
      );
      break;
    default:
      throw new PermanentJobError("Invalid task engine");
  }

  wasm_tasks.set(task_engine, wasmFileset);
  return wasmFileset;
};

type TaskType =
  | typeof TextEmbedder
  | typeof TextClassifier
  | typeof LanguageDetector
  | typeof ImageClassifier
  | typeof ImageEmbedder
  | typeof ImageSegmenter
  | typeof ObjectDetector
  | typeof GestureRecognizer
  | typeof HandLandmarker
  | typeof FaceDetector
  | typeof FaceLandmarker
  | typeof PoseLandmarker;

type TaskInstance =
  | TextEmbedder
  | TextClassifier
  | LanguageDetector
  | ImageClassifier
  | ImageEmbedder
  | ImageSegmenter
  | ObjectDetector
  | GestureRecognizer
  | HandLandmarker
  | FaceDetector
  | FaceLandmarker
  | PoseLandmarker;

interface CachedModelTask {
  readonly task: TaskInstance;
  readonly options: Record<string, unknown>;
  readonly task_engine: string;
}

const modelTaskCache = new Map<string, CachedModelTask[]>();

type InferTaskInstance<T> = T extends typeof TextEmbedder
  ? TextEmbedder
  : T extends typeof TextClassifier
    ? TextClassifier
    : T extends typeof LanguageDetector
      ? LanguageDetector
      : T extends typeof ImageClassifier
        ? ImageClassifier
        : T extends typeof ImageEmbedder
          ? ImageEmbedder
          : T extends typeof ImageSegmenter
            ? ImageSegmenter
            : T extends typeof ObjectDetector
              ? ObjectDetector
              : T extends typeof GestureRecognizer
                ? GestureRecognizer
                : T extends typeof HandLandmarker
                  ? HandLandmarker
                  : T extends typeof FaceDetector
                    ? FaceDetector
                    : T extends typeof FaceLandmarker
                      ? FaceLandmarker
                      : T extends typeof PoseLandmarker
                        ? PoseLandmarker
                        : never;

/**
 * Checks if two option objects are deeply equal.
 */
const optionsMatch = (opts1: Record<string, unknown>, opts2: Record<string, unknown>): boolean => {
  const keys1 = Object.keys(opts1).sort();
  const keys2 = Object.keys(opts2).sort();

  if (keys1.length !== keys2.length) return false;

  return keys1.every((key) => {
    const val1 = opts1[key];
    const val2 = opts2[key];

    if (Array.isArray(val1) && Array.isArray(val2)) {
      return JSON.stringify(val1) === JSON.stringify(val2);
    }

    return val1 === val2;
  });
};

const getModelTask = async <T extends TaskType>(
  model: TFMPModelConfig,
  options: Record<string, unknown>,
  onProgress: (progress: number, message?: string, details?: any) => void,
  signal: AbortSignal,
  TaskType: T
): Promise<InferTaskInstance<T>> => {
  const model_path = model.provider_config.model_path;
  const task_engine = model.provider_config.task_engine;

  // Check if we have a cached instance with matching options
  const cachedTasks = modelTaskCache.get(model_path);
  if (cachedTasks) {
    const matchedTask = cachedTasks.find((cached) => optionsMatch(cached.options, options));
    if (matchedTask) {
      return matchedTask.task as InferTaskInstance<T>;
    }
  }

  // Load WASM if needed
  const wasmFileset = await getWasmTask(model, onProgress, signal);

  onProgress(0.2, "Creating model task");

  // Create new model instance
  const task = await TaskType.createFromOptions(wasmFileset, {
    baseOptions: {
      modelAssetPath: model_path,
    },
    ...options,
  });

  // Cache the task with its options and task engine
  const cachedTask: CachedModelTask = { task, options, task_engine };
  if (!modelTaskCache.has(model_path)) {
    modelTaskCache.set(model_path, []);
  }
  modelTaskCache.get(model_path)!.push(cachedTask);

  // Increment WASM reference count for this cached task
  wasm_reference_counts.set(task_engine, (wasm_reference_counts.get(task_engine) || 0) + 1);

  return task as any;
};

/**
 * Core implementation for downloading and caching a MediaPipe TFJS model.
 * This is shared between inline and worker implementations.
 */
export const TFMP_Download: AiProviderRunFn<
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  let task: TaskInstance;
  switch (model?.provider_config.pipeline) {
    // Text pipelines
    case "text-embedder":
      task = await getModelTask(model, {}, onProgress, signal, TextEmbedder);
      break;
    case "text-classifier":
      task = await getModelTask(model, {}, onProgress, signal, TextClassifier);
      break;
    case "text-language-detector":
      task = await getModelTask(model, {}, onProgress, signal, LanguageDetector);
      break;
    // Vision pipelines
    case "vision-image-classifier":
      task = await getModelTask(model, {}, onProgress, signal, ImageClassifier);
      break;
    case "vision-image-embedder":
      task = await getModelTask(model, {}, onProgress, signal, ImageEmbedder);
      break;
    case "vision-image-segmenter":
      task = await getModelTask(model, {}, onProgress, signal, ImageSegmenter);
      break;
    case "vision-object-detector":
      task = await getModelTask(model, {}, onProgress, signal, ObjectDetector);
      break;
    case "vision-face-detector":
      task = await getModelTask(model, {}, onProgress, signal, FaceDetector);
      break;
    case "vision-face-landmarker":
      task = await getModelTask(model, {}, onProgress, signal, FaceLandmarker);
      break;
    case "vision-gesture-recognizer":
      task = await getModelTask(model, {}, onProgress, signal, GestureRecognizer);
      break;
    case "vision-hand-landmarker":
      task = await getModelTask(model, {}, onProgress, signal, HandLandmarker);
      break;
    case "vision-pose-landmarker":
      task = await getModelTask(model, {}, onProgress, signal, PoseLandmarker);
      break;
    default:
      throw new PermanentJobError(
        `Invalid pipeline: ${model?.provider_config.pipeline}. Supported pipelines: text-embedder, text-classifier, text-language-detector, vision-image-classifier, vision-image-embedder, vision-image-segmenter, vision-object-detector, vision-face-detector, vision-face-landmarker, vision-gesture-recognizer, vision-hand-landmarker, vision-pose-landmarker`
      );
  }
  onProgress(0.9, "Pipeline loaded");
  task.close(); // Close the task to release the resources, but it is still in the browser cache
  // Decrease reference count for WASM fileset for this cached task since this is a fake model cache entry
  const task_engine = model?.provider_config.task_engine;
  wasm_reference_counts.set(task_engine, wasm_reference_counts.get(task_engine)! - 1);

  return {
    model: input.model,
  };
};

/**
 * Core implementation for text embedding using MediaPipe TFJS.
 * This is shared between inline and worker implementations.
 */
export const TFMP_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const textEmbedder = await getModelTask(model!, {}, onProgress, signal, TextEmbedder);

  // Handle array of texts
  if (Array.isArray(input.text)) {
    const embeddings = input.text.map((text) => {
      const result = textEmbedder.embed(text);

      if (!result.embeddings?.[0]?.floatEmbedding) {
        throw new PermanentJobError("Failed to generate embedding: Empty result");
      }

      return Float32Array.from(result.embeddings[0].floatEmbedding);
    });

    return {
      vector: embeddings,
    };
  }

  // Handle single text
  const result = textEmbedder.embed(input.text);

  if (!result.embeddings?.[0]?.floatEmbedding) {
    throw new PermanentJobError("Failed to generate embedding: Empty result");
  }

  const embedding = Float32Array.from(result.embeddings[0].floatEmbedding);

  return {
    vector: embedding,
  };
};

/**
 * Core implementation for text classification using MediaPipe TFJS.
 * This is shared between inline and worker implementations.
 */
export const TFMP_TextClassification: AiProviderRunFn<
  TextClassificationTaskInput,
  TextClassificationTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const TextClassification = await getModelTask(
    model!,
    {
      maxCategories: input.maxCategories,
      // scoreThreshold: input.scoreThreshold,
      // allowList: input.allowList,
      // blockList: input.blockList,
    },
    onProgress,
    signal,
    TextClassifier
  );
  const result = TextClassification.classify(input.text);

  if (!result.classifications?.[0]?.categories) {
    throw new PermanentJobError("Failed to classify text: Empty result");
  }

  const categories = result.classifications[0].categories.map((category) => ({
    label: category.categoryName,
    score: category.score,
  }));

  return {
    categories,
  };
};

/**
 * Core implementation for language detection using MediaPipe TFJS.
 * This is shared between inline and worker implementations.
 */
export const TFMP_TextLanguageDetection: AiProviderRunFn<
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const maxLanguages = input.maxLanguages === 0 ? -1 : input.maxLanguages;

  const textLanguageDetector = await getModelTask(
    model!,
    {
      maxLanguages,
      // scoreThreshold: input.scoreThreshold,
      // allowList: input.allowList,
      // blockList: input.blockList,
    },
    onProgress,
    signal,
    LanguageDetector
  );
  const result = textLanguageDetector.detect(input.text);

  if (!result.languages?.[0]?.languageCode) {
    throw new PermanentJobError("Failed to detect language: Empty result");
  }

  const languages = result.languages.map((language) => ({
    language: language.languageCode,
    score: language.probability,
  }));

  return {
    languages,
  };
};

/**
 * Core implementation for unloading a MediaPipe TFJS model.
 * This is shared between inline and worker implementations.
 *
 * When a model is unloaded, this function:
 * 1. Disposes of all cached model instances for the given model path
 * 2. Decrements the reference count for the associated WASM fileset for each instance
 * 3. If no other models are using the WASM fileset (count reaches 0), unloads the WASM
 */
export const TFMP_Unload: AiProviderRunFn<
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const model_path = model!.provider_config.model_path;
  onProgress(10, "Unloading model");
  // Dispose of all cached model tasks if they exist
  if (modelTaskCache.has(model_path)) {
    const cachedTasks = modelTaskCache.get(model_path)!;

    for (const cachedTask of cachedTasks) {
      const task = cachedTask.task;
      if ("close" in task && typeof task.close === "function") task.close();

      // Decrease reference count for WASM fileset for this cached task
      const task_engine = cachedTask.task_engine;
      const currentCount = wasm_reference_counts.get(task_engine) || 0;
      const newCount = currentCount - 1;

      if (newCount <= 0) {
        // No more models using this WASM fileset, unload it
        wasm_tasks.delete(task_engine);
        wasm_reference_counts.delete(task_engine);
      } else {
        wasm_reference_counts.set(task_engine, newCount);
      }
    }

    modelTaskCache.delete(model_path);
  }

  return {
    model: input.model,
  };
};

/**
 * Core implementation for image segmentation using MediaPipe.
 */
export const TFMP_ImageSegmentation: AiProviderRunFn<
  ImageSegmentationTaskInput,
  ImageSegmentationTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const imageSegmenter = await getModelTask(model!, {}, onProgress, signal, ImageSegmenter);
  const result = imageSegmenter.segment(input.image as any);

  if (!result.categoryMask) {
    throw new PermanentJobError("Failed to segment image: Empty result");
  }

  // MediaPipe returns a single mask, create a placeholder result
  const masks = [
    {
      label: "segment",
      score: 1.0,
      mask: {
        data: result.categoryMask.canvas,
        width: result.categoryMask.width,
        height: result.categoryMask.height,
      },
    },
  ];

  return {
    masks,
  };
};

/**
 * Core implementation for image embedding using MediaPipe.
 */
export const TFMP_ImageEmbedding: AiProviderRunFn<
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const imageEmbedder = await getModelTask(model!, {}, onProgress, signal, ImageEmbedder);
  const result = imageEmbedder.embed(input.image as any);

  if (!result.embeddings?.[0]?.floatEmbedding) {
    throw new PermanentJobError("Failed to generate embedding: Empty result");
  }

  const embedding = Float32Array.from(result.embeddings[0].floatEmbedding);

  return {
    vector: embedding,
  } as ImageEmbeddingTaskOutput;
};

/**
 * Core implementation for image classification using MediaPipe.
 */
export const TFMP_ImageClassification: AiProviderRunFn<
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const imageClassifier = await getModelTask(
    model!,
    {
      maxResults: (input as any).maxCategories,
    },
    onProgress,
    signal,
    ImageClassifier
  );
  const result = imageClassifier.classify(input.image as any);

  if (!result.classifications?.[0]?.categories) {
    throw new PermanentJobError("Failed to classify image: Empty result");
  }

  const categories = result.classifications[0].categories.map((category: any) => ({
    label: category.categoryName,
    score: category.score,
  }));

  return {
    categories,
  };
};

/**
 * Core implementation for object detection using MediaPipe.
 */
export const TFMP_ObjectDetection: AiProviderRunFn<
  ObjectDetectionTaskInput,
  ObjectDetectionTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const objectDetector = await getModelTask(
    model!,
    {
      scoreThreshold: (input as any).threshold,
    },
    onProgress,
    signal,
    ObjectDetector
  );
  const result = objectDetector.detect(input.image as any);

  if (!result.detections) {
    throw new PermanentJobError("Failed to detect objects: Empty result");
  }

  const detections = result.detections.map((detection: any) => ({
    label: detection.categories?.[0]?.categoryName || "unknown",
    score: detection.categories?.[0]?.score || 0,
    box: {
      x: detection.boundingBox?.originX || 0,
      y: detection.boundingBox?.originY || 0,
      width: detection.boundingBox?.width || 0,
      height: detection.boundingBox?.height || 0,
    },
  }));

  return {
    detections,
  };
};

/**
 * Core implementation for gesture recognition using MediaPipe.
 */
export const TFMP_GestureRecognizer: AiProviderRunFn<
  GestureRecognizerTaskInput,
  GestureRecognizerTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const gestureRecognizer = await getModelTask(
    model!,
    {
      numHands: (input as any).numHands,
      minHandDetectionConfidence: (input as any).minHandDetectionConfidence,
      minHandPresenceConfidence: (input as any).minHandPresenceConfidence,
      minTrackingConfidence: (input as any).minTrackingConfidence,
    },
    onProgress,
    signal,
    GestureRecognizer
  );
  const result = gestureRecognizer.recognize(input.image as any);

  if (!result.gestures || !result.landmarks) {
    throw new PermanentJobError("Failed to recognize gestures: Empty result");
  }

  const hands = result.gestures.map((gestures: any, index: number) => ({
    gestures: gestures.map((g: any) => ({
      label: g.categoryName,
      score: g.score,
    })),
    handedness: result.handedness[index].map((h: any) => ({
      label: h.categoryName,
      score: h.score,
    })),
    landmarks: result.landmarks[index].map((l: any) => ({
      x: l.x,
      y: l.y,
      z: l.z,
    })),
    worldLandmarks: result.worldLandmarks[index].map((l: any) => ({
      x: l.x,
      y: l.y,
      z: l.z,
    })),
  }));

  return {
    hands,
  };
};

/**
 * Core implementation for hand landmark detection using MediaPipe.
 */
export const TFMP_HandLandmarker: AiProviderRunFn<
  HandLandmarkerTaskInput,
  HandLandmarkerTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const handLandmarker = await getModelTask(
    model!,
    {
      numHands: (input as any).numHands,
      minHandDetectionConfidence: (input as any).minHandDetectionConfidence,
      minHandPresenceConfidence: (input as any).minHandPresenceConfidence,
      minTrackingConfidence: (input as any).minTrackingConfidence,
    },
    onProgress,
    signal,
    HandLandmarker
  );
  const result = handLandmarker.detect(input.image as any);

  if (!result.landmarks) {
    throw new PermanentJobError("Failed to detect hand landmarks: Empty result");
  }

  const hands = result.landmarks.map((landmarks: any, index: number) => ({
    handedness: result.handedness[index].map((h: any) => ({
      label: h.categoryName,
      score: h.score,
    })),
    landmarks: landmarks.map((l: any) => ({
      x: l.x,
      y: l.y,
      z: l.z,
    })),
    worldLandmarks: result.worldLandmarks[index].map((l: any) => ({
      x: l.x,
      y: l.y,
      z: l.z,
    })),
  }));

  return {
    hands,
  };
};

/**
 * Core implementation for face detection using MediaPipe.
 */
export const TFMP_FaceDetector: AiProviderRunFn<
  FaceDetectorTaskInput,
  FaceDetectorTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const faceDetector = await getModelTask(
    model!,
    {
      minDetectionConfidence: (input as any).minDetectionConfidence,
      minSuppressionThreshold: (input as any).minSuppressionThreshold,
    },
    onProgress,
    signal,
    FaceDetector
  );
  const result = faceDetector.detect(input.image as any);

  if (!result.detections) {
    throw new PermanentJobError("Failed to detect faces: Empty result");
  }

  const faces = result.detections.map((detection: any) => ({
    box: {
      x: detection.boundingBox?.originX || 0,
      y: detection.boundingBox?.originY || 0,
      width: detection.boundingBox?.width || 0,
      height: detection.boundingBox?.height || 0,
    },
    keypoints:
      detection.keypoints?.map((kp: any) => ({
        x: kp.x,
        y: kp.y,
        label: kp.label,
      })) || [],
    score: detection.categories?.[0]?.score || 0,
  }));

  return {
    faces,
  };
};

/**
 * Core implementation for face landmark detection using MediaPipe.
 */
export const TFMP_FaceLandmarker: AiProviderRunFn<
  FaceLandmarkerTaskInput,
  FaceLandmarkerTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const faceLandmarker = await getModelTask(
    model!,
    {
      numFaces: (input as any).numFaces,
      minFaceDetectionConfidence: (input as any).minFaceDetectionConfidence,
      minFacePresenceConfidence: (input as any).minFacePresenceConfidence,
      minTrackingConfidence: (input as any).minTrackingConfidence,
      outputFaceBlendshapes: (input as any).outputFaceBlendshapes,
      outputFacialTransformationMatrixes: (input as any).outputFacialTransformationMatrixes,
    },
    onProgress,
    signal,
    FaceLandmarker
  );
  const result = faceLandmarker.detect(input.image as any);

  if (!result.faceLandmarks) {
    throw new PermanentJobError("Failed to detect face landmarks: Empty result");
  }

  const faces = result.faceLandmarks.map((landmarks: any, index: number) => {
    const face: any = {
      landmarks: landmarks.map((l: any) => ({
        x: l.x,
        y: l.y,
        z: l.z,
      })),
    };

    if (result.faceBlendshapes && result.faceBlendshapes[index]) {
      face.blendshapes = result.faceBlendshapes[index].categories.map((b: any) => ({
        label: b.categoryName,
        score: b.score,
      }));
    }

    if (result.facialTransformationMatrixes && result.facialTransformationMatrixes[index]) {
      face.transformationMatrix = Array.from(result.facialTransformationMatrixes[index].data);
    }

    return face;
  });

  return {
    faces,
  };
};

/**
 * Core implementation for pose landmark detection using MediaPipe.
 */
export const TFMP_PoseLandmarker: AiProviderRunFn<
  PoseLandmarkerTaskInput,
  PoseLandmarkerTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const poseLandmarker = await getModelTask(
    model!,
    {
      numPoses: (input as any).numPoses,
      minPoseDetectionConfidence: (input as any).minPoseDetectionConfidence,
      minPosePresenceConfidence: (input as any).minPosePresenceConfidence,
      minTrackingConfidence: (input as any).minTrackingConfidence,
      outputSegmentationMasks: (input as any).outputSegmentationMasks,
    },
    onProgress,
    signal,
    PoseLandmarker
  );
  const result = poseLandmarker.detect(input.image as any);

  if (!result.landmarks) {
    throw new PermanentJobError("Failed to detect pose landmarks: Empty result");
  }

  const poses = result.landmarks.map((landmarks: any, index: number) => {
    const pose: any = {
      landmarks: landmarks.map((l: any) => ({
        x: l.x,
        y: l.y,
        z: l.z,
        visibility: l.visibility,
        presence: l.presence,
      })),
      worldLandmarks: result.worldLandmarks[index].map((l: any) => ({
        x: l.x,
        y: l.y,
        z: l.z,
        visibility: l.visibility,
        presence: l.presence,
      })),
    };

    if (result.segmentationMasks && result.segmentationMasks[index]) {
      const mask = result.segmentationMasks[index];
      pose.segmentationMask = {
        data: mask.canvas || mask,
        width: mask.width,
        height: mask.height,
      };
    }

    return pose;
  });

  return {
    poses,
  };
};

/**
 * All TensorFlow MediaPipe task run functions, keyed by task type name.
 * Pass this to `new TensorFlowMediaPipeProvider(TFMP_TASKS)` when the
 * actual run function implementations are needed (inline mode, worker server).
 */
export const TFMP_TASKS = {
  DownloadModelTask: TFMP_Download,
  UnloadModelTask: TFMP_Unload,
  TextEmbeddingTask: TFMP_TextEmbedding,
  TextLanguageDetectionTask: TFMP_TextLanguageDetection,
  TextClassificationTask: TFMP_TextClassification,
  ImageSegmentationTask: TFMP_ImageSegmentation,
  ImageEmbeddingTask: TFMP_ImageEmbedding,
  ImageClassificationTask: TFMP_ImageClassification,
  ObjectDetectionTask: TFMP_ObjectDetection,
  GestureRecognizerTask: TFMP_GestureRecognizer,
  HandLandmarkerTask: TFMP_HandLandmarker,
  FaceDetectorTask: TFMP_FaceDetector,
  FaceLandmarkerTask: TFMP_FaceLandmarker,
  PoseLandmarkerTask: TFMP_PoseLandmarker,
} as const;
