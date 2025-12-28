/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DownloadModelTask,
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
  TextEmbeddingTaskOutput,
} from "@workglow/ai";
import {
  HF_TRANSFORMERS_ONNX,
  HfTransformersOnnxModelRecord,
  register_HFT_InlineJobFns,
  register_TFMP_InlineJobFns,
} from "@workglow/ai-provider";
import { getTaskQueueRegistry, setTaskQueueRegistry, Workflow } from "@workglow/task-graph";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("TextEmbeddingTask with real models", () => {
  beforeAll(async () => {
    setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await register_HFT_InlineJobFns();
    await register_TFMP_InlineJobFns();
  });

  afterAll(async () => {
    getTaskQueueRegistry().stopQueues().clearQueues();
    setTaskQueueRegistry(null);
  });

  beforeEach(() => {});

  describe("HuggingFace Transformers", () => {
    it("should generate embeddings with gte-small model", async () => {
      // Register model
      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Supabase/gte-small:q8",
        title: "gte-small",
        description: "Supabase/gte-small quantized to 8bit",
        tasks: ["TextEmbeddingTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "feature-extraction",
          model_path: "Supabase/gte-small",
          dtype: "q8",
          native_dimensions: 384,
        },
        metadata: {},
      };

      await getGlobalModelRepository().addModel(model);

      // First download the model
      const download = new DownloadModelTask({
        model: "onnx:Supabase/gte-small:q8",
      });
      let lastProgress = -1;
      download.on("progress", (progress, message, details) => {
        if (progress !== lastProgress) {
          console.log(
            `Overall: ${progress}% | File: ${details?.file || "?"} @ ${(details?.progress || 0).toFixed(1)}%`
          );
          lastProgress = progress;
        }
      });

      await download.run();

      // Now test embeddings
      const embeddingWorkflow = new Workflow();
      embeddingWorkflow.textEmbedding({
        model: "onnx:Supabase/gte-small:q8",
        text: "The quick brown fox jumps over the lazy dog",
      });

      const result = (await embeddingWorkflow.run()) as TextEmbeddingTaskOutput;

      // Validate result
      expect(result).toBeDefined();
      expect(result.vector).toBeDefined();
      const vector = result.vector as Float32Array | number[];
      expect(Array.isArray(vector) || vector instanceof Float32Array).toBe(true);
      expect(vector.length).toBe(384);

      // Verify the vector has meaningful values (not all zeros)
      const vectorSum = Array.from(vector).reduce((sum, val) => sum + Math.abs(val as number), 0);
      expect(vectorSum).toBeGreaterThan(0);
    }, 120000); // 2 minute timeout for model download

    it("should generate embeddings with bge-base-en-v1.5 model", async () => {
      // Register model
      const model: HfTransformersOnnxModelRecord = {
        model_id: "onnx:Xenova/bge-base-en-v1.5:q8",
        title: "bge-base-en-v1.5",
        description: "Xenova/bge-base-en-v1.5 quantized to 8bit",
        tasks: ["TextEmbeddingTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "feature-extraction",
          model_path: "Xenova/bge-base-en-v1.5",
          native_dimensions: 768,
        },
        metadata: {},
      };

      await getGlobalModelRepository().addModel(model);

      // Download the model
      const downloadWorkflow = new Workflow();
      downloadWorkflow.downloadModel({
        model: "onnx:Xenova/bge-base-en-v1.5:q8",
      });
      await downloadWorkflow.run();

      // Test embeddings
      const embeddingWorkflow = new Workflow();
      embeddingWorkflow.textEmbedding({
        model: "onnx:Xenova/bge-base-en-v1.5:q8",
        text: "Machine learning is a subset of artificial intelligence",
      });

      const result = (await embeddingWorkflow.run()) as TextEmbeddingTaskOutput;

      // Validate result
      expect(result).toBeDefined();
      expect(result.vector).toBeDefined();
      const vector = result.vector as Float32Array | number[];
      expect(Array.isArray(vector) || vector instanceof Float32Array).toBe(true);
      expect(vector.length).toBe(768);

      // Verify the vector has meaningful values
      const vectorSum = Array.from(vector).reduce((sum, val) => sum + Math.abs(val as number), 0);
      expect(vectorSum).toBeGreaterThan(0);
    }, 120000);
  });
});
