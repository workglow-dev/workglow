/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "@workglow/ai";
import { OPENAI, OpenAiProvider } from "@workglow/ai-provider";
import {
  OPENAI_TASKS,
  OpenAI_CountTokens,
  OpenAI_TextEmbedding,
  OpenAI_TextGeneration,
  OpenAI_TextRewriter,
  OpenAI_TextSummary,
} from "@workglow/ai-provider/openai";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskQueueRegistry,
} from "@workglow/task-graph";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockCreate = vi.fn();
const mockEmbeddingsCreate = vi.fn();

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    embeddings = { create: mockEmbeddingsCreate };
    constructor(_opts: any) {}
  },
}));

const mockTiktokenEncode = vi.fn();
vi.mock("tiktoken", () => ({
  encoding_for_model: vi.fn((model: string) => {
    if (model === "unknown-model") throw new Error("Unknown model");
    return { encode: mockTiktokenEncode };
  }),
  get_encoding: vi.fn((_name: string) => ({ encode: mockTiktokenEncode })),
}));

const makeModel = (modelName: string, apiKey = "test-key") => ({
  model_id: "test-uuid",
  title: "Test Model",
  description: "Test",
  tasks: ["TextGenerationTask"],
  provider: OPENAI as typeof OPENAI,
  provider_config: { model_name: modelName, api_key: apiKey },
  metadata: {},
});

const noopProgress = () => {};
const abortSignal = new AbortController().signal;

describe("OpenAiProvider", () => {
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
      const provider = new OpenAiProvider();
      expect(provider.name).toBe(OPENAI);
      expect(provider.supportedTaskTypes).toEqual([
        "TextGenerationTask",
        "TextEmbeddingTask",
        "TextRewriterTask",
        "TextSummaryTask",
        "CountTokensTask",
      ]);
    });

    test("should register in inline mode with tasks", async () => {
      const provider = new OpenAiProvider(OPENAI_TASKS);
      await provider.register({ mode: "inline", queue: { autoCreate: false } });

      expect(registry.getProvider(OPENAI)).toBe(provider);
      expect(registry.getDirectRunFn(OPENAI, "TextGenerationTask")).toBeDefined();
      expect(registry.getDirectRunFn(OPENAI, "TextEmbeddingTask")).toBeDefined();
      expect(registry.getDirectRunFn(OPENAI, "TextRewriterTask")).toBeDefined();
      expect(registry.getDirectRunFn(OPENAI, "TextSummaryTask")).toBeDefined();
    });

    test("should throw in inline mode without tasks", async () => {
      const provider = new OpenAiProvider();
      await expect(
        provider.register({ mode: "inline", queue: { autoCreate: false } })
      ).rejects.toThrow(/tasks must be provided/);
    });

    test("should register on worker server", () => {
      const mockServer = { registerFunction: vi.fn() };
      const provider = new OpenAiProvider(OPENAI_TASKS);
      provider.registerOnWorkerServer(mockServer as any);

      expect(mockServer.registerFunction).toHaveBeenCalledTimes(5);
    });
  });

  describe("OpenAI_TextGeneration", () => {
    test("should call chat.completions.create with correct params", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "Hello world" } }],
      });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_TextGeneration(
        { prompt: "Say hello", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "Hello world" });
      expect(mockCreate).toHaveBeenCalledOnce();
      const [params] = mockCreate.mock.calls[0];
      expect(params.model).toBe("gpt-4o");
      expect(params.messages).toEqual([{ role: "user", content: "Say hello" }]);
    });

    test("should pass optional generation parameters", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "result" } }],
      });

      const model = makeModel("gpt-4o");
      await OpenAI_TextGeneration(
        {
          prompt: "test",
          model: model as any,
          maxTokens: 100,
          temperature: 0.5,
          topP: 0.9,
          frequencyPenalty: 0.1,
          presencePenalty: 0.2,
        },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockCreate.mock.calls[0];
      expect(params.max_completion_tokens).toBe(100);
      expect(params.temperature).toBe(0.5);
      expect(params.top_p).toBe(0.9);
      expect(params.frequency_penalty).toBe(0.1);
      expect(params.presence_penalty).toBe(0.2);
    });

    test("should return empty string when no content", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_TextGeneration(
        { prompt: "test", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "" });
    });
  });

  describe("OpenAI_TextEmbedding", () => {
    test("should embed a single string", async () => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      });

      const model = makeModel("text-embedding-3-small");
      const result = await OpenAI_TextEmbedding(
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

    test("should embed an array of strings", async () => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      });

      const model = makeModel("text-embedding-3-small");
      const result = await OpenAI_TextEmbedding(
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

  describe("OpenAI_TextRewriter", () => {
    test("should use system prompt for rewriting", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "Rewritten text" } }],
      });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_TextRewriter(
        { text: "Original text", prompt: "Make it formal", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "Rewritten text" });
      const [params] = mockCreate.mock.calls[0];
      expect(params.messages).toEqual([
        { role: "system", content: "Make it formal" },
        { role: "user", content: "Original text" },
      ]);
    });
  });

  describe("OpenAI_TextSummary", () => {
    test("should use summarization system prompt", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "Summary" } }],
      });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_TextSummary(
        { text: "Long text here", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "Summary" });
      const [params] = mockCreate.mock.calls[0];
      expect(params.messages[0].role).toBe("system");
      expect(params.messages[0].content).toContain("Summarize");
    });
  });

  describe("error handling", () => {
    test("should throw when API key is missing", async () => {
      await expect(
        OpenAI_TextGeneration(
          { prompt: "test", model: {} as any },
          { provider_config: { model_name: "gpt-4o" } } as any,
          noopProgress,
          abortSignal
        )
      ).rejects.toThrow(/Missing OpenAI API key/);
    });

    test("should throw when model name is missing", async () => {
      await expect(
        OpenAI_TextGeneration(
          { prompt: "test", model: {} as any },
          { provider_config: { api_key: "key" } } as any,
          noopProgress,
          abortSignal
        )
      ).rejects.toThrow(/Missing model name/);
    });

    test("should propagate SDK errors", async () => {
      mockCreate.mockRejectedValue(new Error("Rate limit exceeded"));

      const model = makeModel("gpt-4o");
      await expect(
        OpenAI_TextGeneration(
          { prompt: "test", model: model as any },
          model,
          noopProgress,
          abortSignal
        )
      ).rejects.toThrow("Rate limit exceeded");
    });
  });

  describe("OpenAI_CountTokens", () => {
    test("should return token count for known model", async () => {
      mockTiktokenEncode.mockReturnValue([1, 2, 3, 4, 5]);

      const model = makeModel("gpt-4o");
      const result = await OpenAI_CountTokens(
        { text: "Hello world", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ count: 5 });
      expect(mockTiktokenEncode).toHaveBeenCalledWith("Hello world");
    });

    test("should fall back to cl100k_base for unknown models", async () => {
      mockTiktokenEncode.mockReturnValue([1, 2]);

      const model = makeModel("unknown-model");
      const result = await OpenAI_CountTokens(
        { text: "Hi", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ count: 2 });
    });
  });

  describe("OPENAI_TASKS", () => {
    test("should export all task run functions", () => {
      expect(OPENAI_TASKS).toHaveProperty("TextGenerationTask");
      expect(OPENAI_TASKS).toHaveProperty("TextEmbeddingTask");
      expect(OPENAI_TASKS).toHaveProperty("TextRewriterTask");
      expect(OPENAI_TASKS).toHaveProperty("TextSummaryTask");
      expect(OPENAI_TASKS).toHaveProperty("CountTokensTask");
      expect(Object.keys(OPENAI_TASKS)).toHaveLength(5);
    });
  });
});
