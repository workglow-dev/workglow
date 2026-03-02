/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "@workglow/ai";
import { OLLAMA, OllamaProvider } from "@workglow/ai-provider";
import {
  OLLAMA_TASKS,
  Ollama_TextEmbedding,
  Ollama_TextGeneration,
  Ollama_TextRewriter,
  Ollama_TextSummary,
  Ollama_ToolCalling,
  Ollama_ToolCalling_Stream,
} from "@workglow/ai-provider/ollama";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskQueueRegistry,
} from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

const mockChat = vi.fn();
const mockEmbed = vi.fn();

vi.mock("ollama/browser", () => ({
  Ollama: class MockOllama {
    constructor(_opts: any) {}
    chat = mockChat;
    embed = mockEmbed;
  },
}));

const makeModel = (modelName: string) => ({
  model_id: "test-uuid",
  title: "Test Model",
  description: "Test",
  tasks: ["TextGenerationTask"],
  provider: OLLAMA as typeof OLLAMA,
  provider_config: { model_name: modelName },
  metadata: {},
});

const noopProgress = () => {};
const abortSignal = new AbortController().signal;

describe("OllamaProvider", () => {
  let logger = getTestingLogger();
  setLogger(logger);
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
      const provider = new OllamaProvider();
      expect(provider.name).toBe(OLLAMA);
      expect(provider.supportedTaskTypes).toEqual([
        "ModelInfoTask",
        "TextGenerationTask",
        "TextEmbeddingTask",
        "TextRewriterTask",
        "TextSummaryTask",
        "ToolCallingTask",
      ]);
    });

    test("should register in inline mode", async () => {
      const provider = new OllamaProvider(OLLAMA_TASKS);
      await provider.register({ mode: "inline", queue: { autoCreate: false } });

      expect(registry.getProvider(OLLAMA)).toBe(provider);
      expect(registry.getDirectRunFn(OLLAMA, "TextGenerationTask")).toBeDefined();
      expect(registry.getDirectRunFn(OLLAMA, "TextEmbeddingTask")).toBeDefined();
      expect(registry.getDirectRunFn(OLLAMA, "ToolCallingTask")).toBeDefined();
    });

    test("should register on worker server", () => {
      const mockServer = { registerFunction: vi.fn() };
      const provider = new OllamaProvider(OLLAMA_TASKS);
      provider.registerOnWorkerServer(mockServer as any);

      expect(mockServer.registerFunction).toHaveBeenCalledTimes(6);
    });
  });

  describe("Ollama_TextGeneration", () => {
    test("should call chat with correct params", async () => {
      mockChat.mockResolvedValue({ message: { content: "Hello from Ollama" } });

      const model = makeModel("llama3.2");
      const result = await Ollama_TextGeneration(
        { prompt: "Say hello", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "Hello from Ollama" });
      const [params] = mockChat.mock.calls[0];
      expect(params.model).toBe("llama3.2");
      expect(params.messages).toEqual([{ role: "user", content: "Say hello" }]);
    });

    test("should pass generation options", async () => {
      mockChat.mockResolvedValue({ message: { content: "result" } });

      const model = makeModel("llama3.2");
      await Ollama_TextGeneration(
        { prompt: "test", model: model as any, maxTokens: 100, temperature: 0.5, topP: 0.9 },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockChat.mock.calls[0];
      expect(params.options.temperature).toBe(0.5);
      expect(params.options.top_p).toBe(0.9);
      expect(params.options.num_predict).toBe(100);
    });
  });

  describe("Ollama_TextEmbedding", () => {
    test("should embed a single string", async () => {
      mockEmbed.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });

      const model = makeModel("nomic-embed-text");
      const result = await Ollama_TextEmbedding(
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
      mockEmbed.mockResolvedValue({
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      });

      const model = makeModel("nomic-embed-text");
      const result = await Ollama_TextEmbedding(
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

  describe("Ollama_TextRewriter", () => {
    test("should use system message for rewriting", async () => {
      mockChat.mockResolvedValue({ message: { content: "Rewritten" } });

      const model = makeModel("llama3.2");
      const result = await Ollama_TextRewriter(
        { text: "Original", prompt: "Make formal", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "Rewritten" });
      const [params] = mockChat.mock.calls[0];
      expect(params.messages).toEqual([
        { role: "system", content: "Make formal" },
        { role: "user", content: "Original" },
      ]);
    });
  });

  describe("Ollama_TextSummary", () => {
    test("should use summarization system message", async () => {
      mockChat.mockResolvedValue({ message: { content: "Summary" } });

      const model = makeModel("llama3.2");
      const result = await Ollama_TextSummary(
        { text: "Long text", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "Summary" });
      const [params] = mockChat.mock.calls[0];
      expect(params.messages[0].content).toContain("Summarize");
    });
  });

  describe("Ollama_ToolCalling", () => {
    const sampleTools = [
      {
        name: "get_weather",
        description: "Get the current weather for a city",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string", description: "The city name" },
          },
          required: ["city"],
        },
      },
    ];

    test("should call chat with tools and extract tool calls", async () => {
      mockChat.mockResolvedValue({
        message: {
          content: "",
          tool_calls: [
            {
              function: {
                name: "get_weather",
                arguments: { city: "San Francisco" },
              },
            },
          ],
        },
      });

      const model = makeModel("llama3.2");
      const result = await Ollama_ToolCalling(
        { prompt: "What's the weather in SF?", model: model as any, tools: sampleTools },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.text).toBe("");
      expect(Object.keys(result.toolCalls)).toHaveLength(1);
      expect(result.toolCalls["call_0"]).toEqual({
        id: "call_0",
        name: "get_weather",
        input: { city: "San Francisco" },
      });

      const [params] = mockChat.mock.calls[0];
      expect(params.tools).toBeDefined();
      expect(params.tools[0].type).toBe("function");
      expect(params.tools[0].function.name).toBe("get_weather");
    });

    test("should return text when model responds without tool calls", async () => {
      mockChat.mockResolvedValue({
        message: {
          content: "I can help with that! Let me check the weather.",
          tool_calls: [],
        },
      });

      const model = makeModel("llama3.2");
      const result = await Ollama_ToolCalling(
        { prompt: "Hello", model: model as any, tools: sampleTools },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.text).toBe("I can help with that! Let me check the weather.");
      expect(Object.keys(result.toolCalls)).toHaveLength(0);
    });

    test("should not send tools when toolChoice is none", async () => {
      mockChat.mockResolvedValue({
        message: { content: "No tools needed", tool_calls: [] },
      });

      const model = makeModel("llama3.2");
      await Ollama_ToolCalling(
        {
          prompt: "Hello",
          model: model as any,
          tools: sampleTools,
          toolChoice: "none",
        },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockChat.mock.calls[0];
      expect(params.tools).toBeUndefined();
    });

    test("should pass system prompt", async () => {
      mockChat.mockResolvedValue({
        message: { content: "OK", tool_calls: [] },
      });

      const model = makeModel("llama3.2");
      await Ollama_ToolCalling(
        {
          prompt: "Hello",
          model: model as any,
          tools: sampleTools,
          systemPrompt: "You are a weather assistant.",
        },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockChat.mock.calls[0];
      expect(params.messages[0]).toEqual({
        role: "system",
        content: "You are a weather assistant.",
      });
      expect(params.messages[1]).toEqual({ role: "user", content: "Hello" });
    });

    test("should handle string arguments from tool calls", async () => {
      mockChat.mockResolvedValue({
        message: {
          content: "",
          tool_calls: [
            {
              function: {
                name: "get_weather",
                arguments: '{"city":"New York"}',
              },
            },
          ],
        },
      });

      const model = makeModel("llama3.2");
      const result = await Ollama_ToolCalling(
        { prompt: "Weather in NY?", model: model as any, tools: sampleTools },
        model,
        noopProgress,
        abortSignal
      );

      expect((result.toolCalls["call_0"] as any).input).toEqual({ city: "New York" });
    });

    test("should filter out tool calls with unknown names", async () => {
      mockChat.mockResolvedValue({
        message: {
          content: "",
          tool_calls: [
            {
              function: {
                name: "get_weather",
                arguments: { city: "London" },
              },
            },
            {
              function: {
                name: "unknown_tool",
                arguments: { foo: "bar" },
              },
            },
          ],
        },
      });

      const model = makeModel("llama3.2");
      const result = await Ollama_ToolCalling(
        { prompt: "test", model: model as any, tools: sampleTools },
        model,
        noopProgress,
        abortSignal
      );

      expect(Object.keys(result.toolCalls)).toHaveLength(1);
      expect((result.toolCalls["call_0"] as any).name).toBe("get_weather");
    });

    test("should stream text and tool calls", async () => {
      const chunks = [
        { message: { content: "Checking " } },
        { message: { content: "weather..." } },
        {
          message: {
            content: "",
            tool_calls: [
              {
                function: {
                  name: "get_weather",
                  arguments: { city: "Paris" },
                },
              },
            ],
          },
        },
      ];

      async function* fakeStream() {
        for (const c of chunks) yield c;
      }
      const stream = fakeStream() as any;
      stream.abort = () => {};
      mockChat.mockResolvedValue(stream);

      const model = makeModel("llama3.2");
      const events: any[] = [];
      for await (const event of Ollama_ToolCalling_Stream(
        { prompt: "Weather in Paris?", model: model as any, tools: sampleTools },
        model,
        abortSignal
      )) {
        events.push(event);
      }

      const textDeltas = events.filter((e) => e.type === "text-delta");
      expect(textDeltas).toHaveLength(2);
      expect(textDeltas[0].textDelta).toBe("Checking ");
      expect(textDeltas[1].textDelta).toBe("weather...");

      const objectDeltas = events.filter((e) => e.type === "object-delta");
      expect(objectDeltas.length).toBeGreaterThan(0);

      const finish = events.find((e) => e.type === "finish");
      expect(finish).toBeDefined();
      expect(Object.keys(finish.data.toolCalls)).toHaveLength(1);
      expect((finish.data.toolCalls["call_0"] as any).name).toBe("get_weather");
    });
  });

  describe("error handling", () => {
    test("should throw when model name is missing", async () => {
      await expect(
        Ollama_TextGeneration(
          { prompt: "test", model: {} as any },
          { provider_config: {} } as any,
          noopProgress,
          abortSignal
        )
      ).rejects.toThrow(/Missing model name/);
    });

    test("should propagate SDK errors", async () => {
      mockChat.mockRejectedValue(new Error("Connection refused"));

      const model = makeModel("llama3.2");
      await expect(
        Ollama_TextGeneration(
          { prompt: "test", model: model as any },
          model,
          noopProgress,
          abortSignal
        )
      ).rejects.toThrow("Connection refused");
    });
  });

  describe("OLLAMA_TASKS", () => {
    test("should export all task run functions", () => {
      expect(OLLAMA_TASKS).toHaveProperty("ModelInfoTask");
      expect(OLLAMA_TASKS).toHaveProperty("TextGenerationTask");
      expect(OLLAMA_TASKS).toHaveProperty("TextEmbeddingTask");
      expect(OLLAMA_TASKS).toHaveProperty("TextRewriterTask");
      expect(OLLAMA_TASKS).toHaveProperty("TextSummaryTask");
      expect(OLLAMA_TASKS).toHaveProperty("ToolCallingTask");
      expect(Object.keys(OLLAMA_TASKS)).toHaveLength(6);
    });
  });
});
