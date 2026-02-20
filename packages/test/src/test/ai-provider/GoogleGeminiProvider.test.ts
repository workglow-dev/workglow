/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "@workglow/ai";
import { GOOGLE_GEMINI, GoogleGeminiProvider } from "@workglow/ai-provider";
import {
  GEMINI_TASKS,
  Gemini_TextEmbedding,
  Gemini_TextGeneration,
  Gemini_TextRewriter,
  Gemini_TextSummary,
} from "@workglow/ai-provider/google-gemini";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskQueueRegistry,
} from "@workglow/task-graph";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockGenerateContent = vi.fn();
const mockEmbedContent = vi.fn();
const mockBatchEmbedContents = vi.fn();

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class MockGoogleGenerativeAI {
    constructor(_apiKey: string) {}
    getGenerativeModel(_opts: any) {
      return {
        generateContent: mockGenerateContent,
        embedContent: mockEmbedContent,
        batchEmbedContents: mockBatchEmbedContents,
      };
    }
  },
}));

const makeModel = (modelName: string, apiKey = "test-key") => ({
  model_id: "test-uuid",
  title: "Test Model",
  description: "Test",
  tasks: ["TextGenerationTask"],
  provider: GOOGLE_GEMINI as typeof GOOGLE_GEMINI,
  provider_config: { model_name: modelName, api_key: apiKey },
  metadata: {},
});

const noopProgress = () => {};
const abortSignal = new AbortController().signal;

describe("GoogleGeminiProvider", () => {
  let registry: AiProviderRegistry;

  beforeEach(() => {
    setTaskQueueRegistry(new TaskQueueRegistry());
    setAiProviderRegistry(new AiProviderRegistry());
    registry = getAiProviderRegistry();
    vi.clearAllMocks();
  });

  afterEach(() => {
    getTaskQueueRegistry().stopQueues().clearQueues();
  });

  afterAll(() => {
    setTaskQueueRegistry(null);
  });

  describe("provider class", () => {
    test("should have correct name and task types", () => {
      const provider = new GoogleGeminiProvider();
      expect(provider.name).toBe(GOOGLE_GEMINI);
      expect(provider.supportedTaskTypes).toEqual([
        "CountTokensTask",
        "TextGenerationTask",
        "TextEmbeddingTask",
        "TextRewriterTask",
        "TextSummaryTask",
      ]);
    });

    test("should register in inline mode", async () => {
      const provider = new GoogleGeminiProvider(GEMINI_TASKS);
      await provider.register({ mode: "inline", queue: { autoCreate: false } });

      expect(registry.getProvider(GOOGLE_GEMINI)).toBe(provider);
      expect(registry.getDirectRunFn(GOOGLE_GEMINI, "TextGenerationTask")).toBeDefined();
      expect(registry.getDirectRunFn(GOOGLE_GEMINI, "TextEmbeddingTask")).toBeDefined();
    });

    test("should register on worker server", () => {
      const mockServer = { registerFunction: vi.fn() };
      const provider = new GoogleGeminiProvider(GEMINI_TASKS);
      provider.registerOnWorkerServer(mockServer as any);

      expect(mockServer.registerFunction).toHaveBeenCalledTimes(5);
    });
  });

  describe("Gemini_TextGeneration", () => {
    test("should call generateContent with correct params", async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => "Hello from Gemini" },
      });

      const model = makeModel("gemini-2.0-flash");
      const result = await Gemini_TextGeneration(
        { prompt: "Say hello", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "Hello from Gemini" });
      expect(mockGenerateContent).toHaveBeenCalledOnce();
    });
  });

  describe("Gemini_TextEmbedding", () => {
    test("should embed a single string", async () => {
      mockEmbedContent.mockResolvedValue({
        embedding: { values: [0.1, 0.2, 0.3] },
      });

      const model = makeModel("text-embedding-004");
      const result = await Gemini_TextEmbedding(
        { text: "hello", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.vector).toBeInstanceOf(Float32Array);
      expect(Array.from(result.vector as Float32Array)).toEqual([
        expect.closeTo(0.1),
        expect.closeTo(0.2),
        expect.closeTo(0.3),
      ]);
    });

    test("should embed an array using batchEmbedContents", async () => {
      mockBatchEmbedContents.mockResolvedValue({
        embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
      });

      const model = makeModel("text-embedding-004");
      const result = await Gemini_TextEmbedding(
        { text: ["hello", "world"], model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(Array.isArray(result.vector)).toBe(true);
      const vectors = result.vector as Float32Array[];
      expect(vectors).toHaveLength(2);
      expect(vectors[0]).toBeInstanceOf(Float32Array);
    });
  });

  describe("Gemini_TextRewriter", () => {
    test("should rewrite text", async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => "Rewritten text" },
      });

      const model = makeModel("gemini-2.0-flash");
      const result = await Gemini_TextRewriter(
        { text: "Original", prompt: "Make formal", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "Rewritten text" });
    });
  });

  describe("Gemini_TextSummary", () => {
    test("should summarize text", async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => "Summary" },
      });

      const model = makeModel("gemini-2.0-flash");
      const result = await Gemini_TextSummary(
        { text: "Long text", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "Summary" });
    });
  });

  describe("error handling", () => {
    test("should throw when API key is missing", async () => {
      await expect(
        Gemini_TextGeneration(
          { prompt: "test", model: {} as any },
          { provider_config: { model_name: "gemini-2.0-flash" } } as any,
          noopProgress,
          abortSignal
        )
      ).rejects.toThrow(/Missing Google API key/);
    });

    test("should propagate SDK errors", async () => {
      mockGenerateContent.mockRejectedValue(new Error("Quota exceeded"));

      const model = makeModel("gemini-2.0-flash");
      await expect(
        Gemini_TextGeneration(
          { prompt: "test", model: model as any },
          model,
          noopProgress,
          abortSignal
        )
      ).rejects.toThrow("Quota exceeded");
    });
  });

  describe("GEMINI_TASKS", () => {
    test("should export all task run functions", () => {
      expect(GEMINI_TASKS).toHaveProperty("CountTokensTask");
      expect(GEMINI_TASKS).toHaveProperty("TextGenerationTask");
      expect(GEMINI_TASKS).toHaveProperty("TextEmbeddingTask");
      expect(GEMINI_TASKS).toHaveProperty("TextRewriterTask");
      expect(GEMINI_TASKS).toHaveProperty("TextSummaryTask");
      expect(Object.keys(GEMINI_TASKS)).toHaveLength(5);
    });
  });
});
