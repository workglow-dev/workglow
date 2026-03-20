/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensTaskOutput,
  DownloadModelTask,
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
  TextClassificationTaskOutput,
  TextEmbeddingTaskOutput,
  TextFillMaskTaskOutput,
  TextGenerationTaskOutput,
  TextLanguageDetectionTaskOutput,
  TextNamedEntityRecognitionTaskOutput,
  TextQuestionAnswerTaskOutput,
} from "@workglow/ai";
import {
  clearPipelineCache,
  HF_TRANSFORMERS_ONNX,
  registerHuggingFaceTransformersInline,
  type HfTransformersOnnxModelRecord,
} from "@workglow/ai-provider/hf-transformers";
import { getTaskQueueRegistry, setTaskQueueRegistry, Workflow } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getTestingLogger } from "../../binding/TestingLogger";

describe("HFT array input/output support", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  beforeAll(async () => {
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    clearPipelineCache();
    await registerHuggingFaceTransformersInline();
  });

  afterAll(async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  });

  // ========================================================================
  // Helper: register and download a model once
  // ========================================================================
  async function ensureModel(record: HfTransformersOnnxModelRecord) {
    await getGlobalModelRepository().addModel(record);
    const download = new DownloadModelTask({ model: record.model_id });
    download.on("progress", (progress, _message, details) => {
      logger.info(
        `Download ${record.model_id}: ${progress}% | ${details?.file || "?"} @ ${(details?.progress || 0).toFixed(1)}%`
      );
    });
    await download.run();
  }

  // ========================================================================
  // TextEmbedding (reference — already supported, included for completeness)
  // ========================================================================
  describe("TextEmbedding", () => {
    const modelId = "onnx:Xenova/gte-small:q8";

    it("registers model", async () => {
      await ensureModel({
        model_id: modelId,
        title: "gte-small",
        description: "Xenova/gte-small q8",
        tasks: ["TextEmbeddingTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "feature-extraction",
          model_path: "Xenova/gte-small",
          dtype: "q8",
          native_dimensions: 384,
        },
        metadata: {},
      });
    }, 120000);

    it("single text returns single vector", async () => {
      const workflow = new Workflow();
      workflow.textEmbedding({ model: modelId, text: "Hello world" });
      const result = (await workflow.run()) as TextEmbeddingTaskOutput;
      expect(result.vector).toBeDefined();
      expect(Array.isArray(result.vector) || result.vector instanceof Float32Array).toBe(true);
      expect((result.vector as Float32Array).length).toBe(384);
    }, 120000);

    it("text[] returns vector[]", async () => {
      const texts = ["Hello world", "Goodbye world"];
      const workflow = new Workflow();
      workflow.textEmbedding({ model: modelId, text: texts });
      const result = (await workflow.run()) as TextEmbeddingTaskOutput;
      const vectors = result.vector as unknown as (Float32Array | number[])[];
      expect(Array.isArray(vectors)).toBe(true);
      expect(vectors).toHaveLength(2);
      for (const v of vectors) {
        expect(v.length).toBe(384);
      }
    }, 120000);
  });

  // ========================================================================
  // TextGeneration
  // ========================================================================
  describe("TextGeneration", () => {
    const modelId = "onnx:Xenova/distilgpt2:q8";

    it("registers model", async () => {
      await ensureModel({
        model_id: modelId,
        title: "distilgpt2",
        description: "Xenova/distilgpt2 q8",
        tasks: ["TextGenerationTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "text-generation",
          model_path: "Xenova/distilgpt2",
          dtype: "q8",
        },
        metadata: {},
      });
    }, 120000);

    it("single prompt returns single text", async () => {
      const workflow = new Workflow();
      workflow.textGeneration({ model: modelId, prompt: "Once upon a time" });
      const result = (await workflow.run()) as TextGenerationTaskOutput;
      expect(result.text).toBeDefined();
      expect(typeof result.text).toBe("string");
      expect((result.text as string).length).toBeGreaterThan(0);
    }, 120000);

    it("prompt[] returns text[]", async () => {
      const prompts = ["Once upon a time", "The weather today is"];
      const workflow = new Workflow();
      workflow.textGeneration({ model: modelId, prompt: prompts });
      const result = (await workflow.run()) as TextGenerationTaskOutput;
      const texts = result.text as unknown as string[];
      expect(Array.isArray(texts)).toBe(true);
      expect(texts).toHaveLength(2);
      for (const t of texts) {
        expect(typeof t).toBe("string");
        expect(t.length).toBeGreaterThan(0);
      }
    }, 120000);
  });

  // ========================================================================
  // TextClassification
  // ========================================================================
  describe("TextClassification", () => {
    const modelId = "onnx:Xenova/distilbert-base-uncased-finetuned-sst-2-english:q8";

    it("registers model", async () => {
      await ensureModel({
        model_id: modelId,
        title: "distilbert-sst2",
        description: "Sentiment analysis",
        tasks: ["TextClassificationTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "text-classification",
          model_path: "Xenova/distilbert-base-uncased-finetuned-sst-2-english",
          dtype: "q8",
        },
        metadata: {},
      });
    }, 120000);

    it("single text returns single categories[]", async () => {
      const workflow = new Workflow();
      workflow.textClassification({ model: modelId, text: "I love this product!" });
      const result = (await workflow.run()) as TextClassificationTaskOutput;
      expect(result.categories).toBeDefined();
      expect(Array.isArray(result.categories)).toBe(true);
      expect(result.categories.length).toBeGreaterThan(0);
      expect(result.categories[0]).toHaveProperty("label");
      expect(result.categories[0]).toHaveProperty("score");
    }, 120000);

    it("text[] returns categories[][]", async () => {
      const texts = ["I love this!", "This is terrible."];
      const workflow = new Workflow();
      workflow.textClassification({ model: modelId, text: texts });
      const result = (await workflow.run()) as TextClassificationTaskOutput;
      const categories = result.categories as unknown as Array<
        Array<{ label: string; score: number }>
      >;
      expect(Array.isArray(categories)).toBe(true);
      expect(categories).toHaveLength(2);
      for (const cats of categories) {
        expect(Array.isArray(cats)).toBe(true);
        expect(cats.length).toBeGreaterThan(0);
        expect(cats[0]).toHaveProperty("label");
        expect(cats[0]).toHaveProperty("score");
      }
    }, 120000);
  });

  // ========================================================================
  // TextFillMask
  // ========================================================================
  describe("TextFillMask", () => {
    const modelId = "onnx:Xenova/bert-base-uncased:q8";

    it("registers model", async () => {
      await ensureModel({
        model_id: modelId,
        title: "bert-base-uncased",
        description: "BERT fill mask",
        tasks: ["TextFillMaskTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "fill-mask",
          model_path: "Xenova/bert-base-uncased",
          dtype: "q8",
        },
        metadata: {},
      });
    }, 120000);

    it("single text returns single predictions[]", async () => {
      const workflow = new Workflow();
      workflow.textFillMask({ model: modelId, text: "Paris is the [MASK] of France." });
      const result = (await workflow.run()) as TextFillMaskTaskOutput;
      expect(result.predictions).toBeDefined();
      expect(Array.isArray(result.predictions)).toBe(true);
      expect(result.predictions.length).toBeGreaterThan(0);
      expect(result.predictions[0]).toHaveProperty("entity");
      expect(result.predictions[0]).toHaveProperty("score");
      expect(result.predictions[0]).toHaveProperty("sequence");
    }, 120000);

    it("text[] returns predictions[][]", async () => {
      const texts = ["Paris is the [MASK] of France.", "The [MASK] is shining brightly today."];
      const workflow = new Workflow();
      workflow.textFillMask({ model: modelId, text: texts });
      const result = (await workflow.run()) as TextFillMaskTaskOutput;
      const predictions = result.predictions as unknown as Array<
        Array<{ entity: string; score: number; sequence: string }>
      >;
      expect(Array.isArray(predictions)).toBe(true);
      expect(predictions).toHaveLength(2);
      for (const preds of predictions) {
        expect(Array.isArray(preds)).toBe(true);
        expect(preds.length).toBeGreaterThan(0);
        expect(preds[0]).toHaveProperty("entity");
      }
    }, 120000);
  });

  // ========================================================================
  // CountTokens
  // ========================================================================
  describe("CountTokens", () => {
    // Reuses gte-small model's tokenizer from above
    const modelId = "onnx:Xenova/gte-small:q8";

    it("single text returns single count", async () => {
      const workflow = new Workflow();
      workflow.countTokens({ model: modelId, text: "Hello world" });
      const result = (await workflow.run()) as CountTokensTaskOutput;
      expect(result.count).toBeDefined();
      expect(typeof result.count).toBe("number");
      expect(result.count as number).toBeGreaterThan(0);
    }, 120000);

    it("text[] returns count[]", async () => {
      const texts = ["Hello world", "This is a longer sentence with more tokens"];
      const workflow = new Workflow();
      workflow.countTokens({ model: modelId, text: texts });
      const result = (await workflow.run()) as CountTokensTaskOutput;
      const counts = result.count as unknown as number[];
      expect(Array.isArray(counts)).toBe(true);
      expect(counts).toHaveLength(2);
      for (const c of counts) {
        expect(typeof c).toBe("number");
        expect(c).toBeGreaterThan(0);
      }
      // Longer text should have more tokens
      expect(counts[1]).toBeGreaterThan(counts[0]);
    }, 120000);
  });

  // ========================================================================
  // TextLanguageDetection
  // ========================================================================
  describe("TextLanguageDetection", () => {
    const modelId = "onnx:Xenova/bert-base-uncased:q8:langdetect";

    it("registers model", async () => {
      // Reuse bert-base-uncased (already downloaded); language detection uses
      // text-classification pipeline — the labels won't be real languages with
      // this model, but it exercises the array code path.
      await getGlobalModelRepository().addModel({
        model_id: modelId,
        title: "bert-langdetect",
        description: "Language detection via classification",
        tasks: ["TextLanguageDetectionTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "text-classification",
          model_path: "Xenova/bert-base-uncased",
          dtype: "q8",
        },
        metadata: {},
      });
    }, 120000);

    it("single text returns single languages[]", async () => {
      const workflow = new Workflow();
      workflow.textLanguageDetection({ model: modelId, text: "Hello world" });
      const result = (await workflow.run()) as TextLanguageDetectionTaskOutput;
      expect(result.languages).toBeDefined();
      expect(Array.isArray(result.languages)).toBe(true);
      expect(result.languages.length).toBeGreaterThan(0);
      expect(result.languages[0]).toHaveProperty("language");
      expect(result.languages[0]).toHaveProperty("score");
    }, 120000);

    it("text[] returns languages[][]", async () => {
      const texts = ["Hello world", "Bonjour le monde"];
      const workflow = new Workflow();
      workflow.textLanguageDetection({ model: modelId, text: texts });
      const result = (await workflow.run()) as TextLanguageDetectionTaskOutput;
      const languages = result.languages as unknown as Array<
        Array<{ language: string; score: number }>
      >;
      expect(Array.isArray(languages)).toBe(true);
      expect(languages).toHaveLength(2);
      for (const langs of languages) {
        expect(Array.isArray(langs)).toBe(true);
        expect(langs.length).toBeGreaterThan(0);
        expect(langs[0]).toHaveProperty("language");
        expect(langs[0]).toHaveProperty("score");
      }
    }, 120000);
  });

  // ========================================================================
  // TextNamedEntityRecognition
  // ========================================================================
  describe("TextNamedEntityRecognition", () => {
    const modelId = "onnx:Xenova/bert-base-NER:q8";

    it("registers model", async () => {
      await ensureModel({
        model_id: modelId,
        title: "bert-base-NER",
        description: "Named entity recognition",
        tasks: ["TextNamedEntityRecognitionTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "token-classification",
          model_path: "Xenova/bert-base-NER",
          dtype: "q8",
        },
        metadata: {},
      });
    }, 120000);

    it("single text returns single entities[]", async () => {
      const workflow = new Workflow();
      workflow.textNamedEntityRecognition({
        model: modelId,
        text: "John works at Google in New York.",
      });
      const result = (await workflow.run()) as TextNamedEntityRecognitionTaskOutput;
      expect(result.entities).toBeDefined();
      expect(Array.isArray(result.entities)).toBe(true);
      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.entities[0]).toHaveProperty("entity");
      expect(result.entities[0]).toHaveProperty("score");
      expect(result.entities[0]).toHaveProperty("word");
    }, 120000);

    it("text[] returns entities[][]", async () => {
      const texts = [
        "John works at Google in New York.",
        "Marie lives in Paris and works for Airbus.",
      ];
      const workflow = new Workflow();
      workflow.textNamedEntityRecognition({ model: modelId, text: texts });
      const result = (await workflow.run()) as TextNamedEntityRecognitionTaskOutput;
      const entities = result.entities as unknown as Array<
        Array<{ entity: string; score: number; word: string }>
      >;
      expect(Array.isArray(entities)).toBe(true);
      expect(entities).toHaveLength(2);
      for (const ents of entities) {
        expect(Array.isArray(ents)).toBe(true);
        expect(ents.length).toBeGreaterThan(0);
        expect(ents[0]).toHaveProperty("entity");
      }
    }, 120000);
  });

  // ========================================================================
  // TextQuestionAnswer
  // ========================================================================
  describe("TextQuestionAnswer", () => {
    const modelId = "onnx:Xenova/distilbert-base-cased-distilled-squad:q8";

    it("registers model", async () => {
      await ensureModel({
        model_id: modelId,
        title: "distilbert-squad",
        description: "Question answering",
        tasks: ["TextQuestionAnswerTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "question-answering",
          model_path: "Xenova/distilbert-base-cased-distilled-squad",
          dtype: "q8",
        },
        metadata: {},
      });
    }, 120000);

    it("single question returns single text", async () => {
      const workflow = new Workflow();
      workflow.textQuestionAnswer({
        model: modelId,
        question: "What is the capital of France?",
        context: "Paris is the capital and largest city of France.",
      });
      const result = (await workflow.run()) as TextQuestionAnswerTaskOutput;
      expect(result.text).toBeDefined();
      expect(typeof result.text).toBe("string");
      expect((result.text as string).length).toBeGreaterThan(0);
    }, 120000);

    it("question[] + context[] returns text[]", async () => {
      const questions = ["What is the capital of France?", "What color is the sky?"];
      const contexts = [
        "Paris is the capital and largest city of France.",
        "The sky is blue on a clear day.",
      ];
      const workflow = new Workflow();
      workflow.textQuestionAnswer({ model: modelId, question: questions, context: contexts });
      const result = (await workflow.run()) as TextQuestionAnswerTaskOutput;
      const texts = result.text as unknown as string[];
      expect(Array.isArray(texts)).toBe(true);
      expect(texts).toHaveLength(2);
      for (const t of texts) {
        expect(typeof t).toBe("string");
        expect(t.length).toBeGreaterThan(0);
      }
    }, 120000);
  });
});
