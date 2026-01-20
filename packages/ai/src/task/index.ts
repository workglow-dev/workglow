/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import { BackgroundRemovalTask } from "./BackgroundRemovalTask";
import { ChunkRetrievalTask } from "./ChunkRetrievalTask";
import { ChunkToVectorTask } from "./ChunkToVectorTask";
import { ChunkVectorHybridSearchTask } from "./ChunkVectorHybridSearchTask";
import { ChunkVectorSearchTask } from "./ChunkVectorSearchTask";
import { ChunkVectorUpsertTask } from "./ChunkVectorUpsertTask";
import { ContextBuilderTask } from "./ContextBuilderTask";
import { DocumentEnricherTask } from "./DocumentEnricherTask";
import { DownloadModelTask } from "./DownloadModelTask";
import { FaceDetectorTask } from "./FaceDetectorTask";
import { FaceLandmarkerTask } from "./FaceLandmarkerTask";
import { GestureRecognizerTask } from "./GestureRecognizerTask";
import { HandLandmarkerTask } from "./HandLandmarkerTask";
import { HierarchicalChunkerTask } from "./HierarchicalChunkerTask";
import { HierarchyJoinTask } from "./HierarchyJoinTask";
import { ImageClassificationTask } from "./ImageClassificationTask";
import { ImageEmbeddingTask } from "./ImageEmbeddingTask";
import { ImageSegmentationTask } from "./ImageSegmentationTask";
import { ImageToTextTask } from "./ImageToTextTask";
import { ObjectDetectionTask } from "./ObjectDetectionTask";
import { PoseLandmarkerTask } from "./PoseLandmarkerTask";
import { QueryExpanderTask } from "./QueryExpanderTask";
import { RerankerTask } from "./RerankerTask";
import { StructuralParserTask } from "./StructuralParserTask";
import { TextChunkerTask } from "./TextChunkerTask";
import { TextClassificationTask } from "./TextClassificationTask";
import { TextEmbeddingTask } from "./TextEmbeddingTask";
import { TextFillMaskTask } from "./TextFillMaskTask";
import { TextGenerationTask } from "./TextGenerationTask";
import { TextLanguageDetectionTask } from "./TextLanguageDetectionTask";
import { TextNamedEntityRecognitionTask } from "./TextNamedEntityRecognitionTask";
import { TextQuestionAnswerTask } from "./TextQuestionAnswerTask";
import { TextRewriterTask } from "./TextRewriterTask";
import { TextSummaryTask } from "./TextSummaryTask";
import { TextTranslationTask } from "./TextTranslationTask";
import { TopicSegmenterTask } from "./TopicSegmenterTask";
import { UnloadModelTask } from "./UnloadModelTask";
import { VectorQuantizeTask } from "./VectorQuantizeTask";
import { VectorSimilarityTask } from "./VectorSimilarityTask";

// Register all AI tasks with the TaskRegistry.
// Centralized registration ensures tasks are available for JSON deserialization
// and prevents tree-shaking issues.
export const registerAiTasks = () => {
  [
    BackgroundRemovalTask,
    ChunkToVectorTask,
    ContextBuilderTask,
    DocumentEnricherTask,
    ChunkRetrievalTask,
    ChunkVectorHybridSearchTask,
    ChunkVectorSearchTask,
    ChunkVectorUpsertTask,
    DownloadModelTask,
    FaceDetectorTask,
    FaceLandmarkerTask,
    GestureRecognizerTask,
    HandLandmarkerTask,
    HierarchicalChunkerTask,
    HierarchyJoinTask,
    ImageClassificationTask,
    ImageEmbeddingTask,
    ImageSegmentationTask,
    ImageToTextTask,
    ObjectDetectionTask,
    PoseLandmarkerTask,
    QueryExpanderTask,
    RerankerTask,
    StructuralParserTask,
    TextChunkerTask,
    TextClassificationTask,
    TextEmbeddingTask,
    TextFillMaskTask,
    TextGenerationTask,
    TextLanguageDetectionTask,
    TextNamedEntityRecognitionTask,
    TextQuestionAnswerTask,
    TextRewriterTask,
    TextSummaryTask,
    TextTranslationTask,
    TopicSegmenterTask,
    UnloadModelTask,
    VectorQuantizeTask,
    VectorSimilarityTask,
  ].map(TaskRegistry.registerTask);
};

export * from "./BackgroundRemovalTask";
export * from "./base/AiTask";
export * from "./base/AiTaskSchemas";
export * from "./ChunkRetrievalTask";
export * from "./ChunkToVectorTask";
export * from "./ChunkVectorHybridSearchTask";
export * from "./ChunkVectorSearchTask";
export * from "./ChunkVectorUpsertTask";
export * from "./ContextBuilderTask";
export * from "./DocumentEnricherTask";
export * from "./DownloadModelTask";
export * from "./FaceDetectorTask";
export * from "./FaceLandmarkerTask";
export * from "./GestureRecognizerTask";
export * from "./HandLandmarkerTask";
export * from "./HierarchicalChunkerTask";
export * from "./HierarchyJoinTask";
export * from "./ImageClassificationTask";
export * from "./ImageEmbeddingTask";
export * from "./ImageSegmentationTask";
export * from "./ImageToTextTask";
export * from "./ObjectDetectionTask";
export * from "./PoseLandmarkerTask";
export * from "./QueryExpanderTask";
export * from "./RerankerTask";
export * from "./StructuralParserTask";
export * from "./TextChunkerTask";
export * from "./TextClassificationTask";
export * from "./TextEmbeddingTask";
export * from "./TextFillMaskTask";
export * from "./TextGenerationTask";
export * from "./TextLanguageDetectionTask";
export * from "./TextNamedEntityRecognitionTask";
export * from "./TextQuestionAnswerTask";
export * from "./TextRewriterTask";
export * from "./TextSummaryTask";
export * from "./TextTranslationTask";
export * from "./TopicSegmenterTask";
export * from "./UnloadModelTask";
export * from "./VectorQuantizeTask";
export * from "./VectorSimilarityTask";

