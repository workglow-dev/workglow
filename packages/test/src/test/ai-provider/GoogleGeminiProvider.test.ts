/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "@workglow/ai";
import { GOOGLE_GEMINI, GoogleGeminiProvider } from "@workglow/ai-provider";
import {
  Gemini_CountTokens,
  GEMINI_TASKS,
  Gemini_TextEmbedding,
  Gemini_TextGeneration,
  Gemini_TextRewriter,
  Gemini_TextSummary,
  Gemini_ToolCalling,
  Gemini_ToolCalling_Stream,
} from "@workglow/ai-provider/google-gemini";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskQueueRegistry,
} from "@workglow/task-graph";
import { JsonSchema, setLogger } from "@workglow/util";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
const mockEmbedContent = vi.fn();
const mockBatchEmbedContents = vi.fn();
const mockCountTokens = vi.fn();

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class MockGoogleGenerativeAI {
    constructor(_apiKey: string) {}
    getGenerativeModel(_opts: any) {
      return {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
        embedContent: mockEmbedContent,
        batchEmbedContents: mockBatchEmbedContents,
        countTokens: mockCountTokens,
      };
    }
  },
}));

const makeModel = (modelName: string, credential_key = "test-key") => ({
  model_id: "test-uuid",
  title: "Test Model",
  description: "Test",
  tasks: ["TextGenerationTask"],
  provider: GOOGLE_GEMINI as typeof GOOGLE_GEMINI,
  provider_config: { model_name: modelName, credential_key },
  metadata: {},
});

const noopProgress = () => {};
const abortSignal = new AbortController().signal;

describe("GoogleGeminiProvider", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let registry: AiProviderRegistry;

  beforeEach(async () => {
    await setTaskQueueRegistry(new TaskQueueRegistry());
    setAiProviderRegistry(new AiProviderRegistry());
    registry = getAiProviderRegistry();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
  });

  afterAll(async () => {
    await setTaskQueueRegistry(null);
  });

  describe("provider class", () => {
    test("should have correct name and task types", () => {
      const provider = new GoogleGeminiProvider();
      expect(provider.name).toBe(GOOGLE_GEMINI);
      expect(provider.supportedTaskTypes).toEqual([
        "CountTokensTask",
        "ModelInfoTask",
        "TextGenerationTask",
        "TextEmbeddingTask",
        "TextRewriterTask",
        "TextSummaryTask",
        "StructuredGenerationTask",
        "ToolCallingTask",
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

      expect(mockServer.registerFunction).toHaveBeenCalledTimes(8);
    });
  });

  describe("Gemini_TextGeneration", () => {
    test("should call generateContent with correct params", async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => "Hello from Gemini" },
      });

      const model = makeModel("gemini-2.0-flash");
      const result = await Gemini_TextGeneration(
        { prompt: "Say hello", model: model },
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
        { text: "hello", model: model },
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
        { text: ["hello", "world"], model: model },
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
        { text: "Original", prompt: "Make formal", model: model },
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
        { text: "Long text", model: model },
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
        Gemini_TextGeneration({ prompt: "test", model: model }, model, noopProgress, abortSignal)
      ).rejects.toThrow("Quota exceeded");
    });
  });

  describe("Gemini_CountTokens", () => {
    test("should call countTokens and map totalTokens to count", async () => {
      mockCountTokens.mockResolvedValue({ totalTokens: 7 });

      const model = makeModel("gemini-2.0-flash");
      const result = await Gemini_CountTokens(
        { text: "Hello Gemini", model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ count: 7 });
      expect(mockCountTokens).toHaveBeenCalledOnce();
      expect(mockCountTokens).toHaveBeenCalledWith("Hello Gemini");
    });
  });

  describe("Gemini_ToolCalling", () => {
    const sampleTools = [
      {
        name: "get_weather",
        description: "Get the weather for a location",
        inputSchema: {
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"],
        } as const satisfies JsonSchema,
      },
    ];

    test("should map toolConfig and tools into the Gemini request", async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [{ content: { parts: [{ text: "Checking weather…" }] } }],
        },
      });

      const model = makeModel("gemini-2.0-flash");
      await Gemini_ToolCalling(
        {
          prompt: "What is the weather?",
          tools: sampleTools,
          toolChoice: "auto",
          model: model,
        },
        model,
        noopProgress,
        abortSignal
      );

      expect(mockGenerateContent).toHaveBeenCalledOnce();
    });

    test("should parse functionCall parts into Record keyed by generated id", async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: "get_weather",
                      args: { location: "Tokyo" },
                    },
                  },
                ],
              },
            },
          ],
        },
      });

      const model = makeModel("gemini-2.0-flash");
      const result = await Gemini_ToolCalling(
        { prompt: "Weather in Tokyo?", tools: sampleTools, model: model },
        model,
        noopProgress,
        abortSignal
      );

      const keys = Object.keys(result.toolCalls as Record<string, unknown>);
      expect(keys).toHaveLength(1);
      const call = (result.toolCalls as any)[keys[0]];
      expect(call.name).toBe("get_weather");
      expect(call.input).toEqual({ location: "Tokyo" });
    });

    test("should stream functionCall parts as object-delta events keyed by id", async () => {
      async function* fakeStream() {
        yield {
          candidates: [{ content: { parts: [{ text: "Here you go" }] } }],
        };
        yield {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: { name: "get_weather", args: { location: "Sydney" } },
                  },
                ],
              },
            },
          ],
        };
      }
      mockGenerateContentStream.mockResolvedValue({ stream: fakeStream() });

      const model = makeModel("gemini-2.0-flash");
      const events: any[] = [];
      for await (const event of Gemini_ToolCalling_Stream(
        { prompt: "Weather in Sydney?", tools: sampleTools, model: model },
        model,
        abortSignal
      )) {
        events.push(event);
      }

      const textDeltas = events.filter((e) => e.type === "text-delta");
      expect(textDeltas[0].textDelta).toBe("Here you go");

      const objectDeltas = events.filter((e) => e.type === "object-delta");
      expect(objectDeltas.length).toBeGreaterThan(0);
      const lastDelta = objectDeltas[objectDeltas.length - 1];
      const keys = Object.keys(lastDelta.objectDelta);
      expect(keys).toHaveLength(1);
      expect((lastDelta.objectDelta as any)[keys[0]].name).toBe("get_weather");

      const finish = events.find((e) => e.type === "finish");
      expect(finish).toBeDefined();
      expect(Object.keys(finish.data.toolCalls as Record<string, unknown>)).toHaveLength(1);
    });

    test("should filter out tool calls with unknown names", async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { name: "get_weather", args: { location: "NYC" } } },
                  { functionCall: { name: "unknown_tool", args: { x: 1 } } },
                ],
              },
            },
          ],
        },
      });

      const model = makeModel("gemini-2.0-flash");
      const result = await Gemini_ToolCalling(
        { prompt: "test", tools: sampleTools, model: model },
        model,
        noopProgress,
        abortSignal
      );

      const keys = Object.keys(result.toolCalls as Record<string, unknown>);
      expect(keys).toHaveLength(1);
      expect((result.toolCalls as any)[keys[0]].name).toBe("get_weather");
    });
  });

  describe("GEMINI_TASKS", () => {
    test("should export all task run functions", () => {
      expect(GEMINI_TASKS).toHaveProperty("CountTokensTask");
      expect(GEMINI_TASKS).toHaveProperty("TextGenerationTask");
      expect(GEMINI_TASKS).toHaveProperty("TextEmbeddingTask");
      expect(GEMINI_TASKS).toHaveProperty("TextRewriterTask");
      expect(GEMINI_TASKS).toHaveProperty("TextSummaryTask");
      expect(GEMINI_TASKS).toHaveProperty("StructuredGenerationTask");
      expect(GEMINI_TASKS).toHaveProperty("ToolCallingTask");
      expect(GEMINI_TASKS).toHaveProperty("ModelInfoTask");
      expect(Object.keys(GEMINI_TASKS)).toHaveLength(8);
    });
  });
});
