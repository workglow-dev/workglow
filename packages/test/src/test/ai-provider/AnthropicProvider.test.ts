/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "@workglow/ai";
import { ANTHROPIC, AnthropicProvider } from "@workglow/ai-provider";
import {
  Anthropic_CountTokens,
  ANTHROPIC_TASKS,
  Anthropic_TextGeneration,
  Anthropic_TextRewriter,
  Anthropic_TextSummary,
  Anthropic_ToolCalling,
  Anthropic_ToolCalling_Stream,
} from "@workglow/ai-provider/anthropic";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskQueueRegistry,
} from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

const mockMessagesCreate = vi.fn();
const mockMessagesCountTokens = vi.fn();
const mockMessagesStream = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mockMessagesCreate,
      countTokens: mockMessagesCountTokens,
      stream: mockMessagesStream,
    };
    constructor(_opts: any) {}
  },
}));

const makeModel = (modelName: string, credential_key = "test-key") => ({
  model_id: "test-uuid",
  title: "Test Model",
  description: "Test",
  tasks: ["TextGenerationTask"],
  provider: ANTHROPIC as typeof ANTHROPIC,
  provider_config: { model_name: modelName, credential_key },
  metadata: {},
});

const noopProgress = () => {};
const abortSignal = new AbortController().signal;

describe("AnthropicProvider", () => {
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
    test("should have correct name and task types (no embedding)", () => {
      const provider = new AnthropicProvider();
      expect(provider.name).toBe(ANTHROPIC);
      expect(provider.supportedTaskTypes).toEqual([
        "CountTokensTask",
        "TextGenerationTask",
        "TextRewriterTask",
        "TextSummaryTask",
        "StructuredGenerationTask",
        "ToolCallingTask",
      ]);
      expect(provider.supportedTaskTypes).not.toContain("TextEmbeddingTask");
    });

    test("should register in inline mode", async () => {
      const provider = new AnthropicProvider(ANTHROPIC_TASKS);
      await provider.register({ mode: "inline", queue: { autoCreate: false } });

      expect(registry.getProvider(ANTHROPIC)).toBe(provider);
      expect(registry.getDirectRunFn(ANTHROPIC, "TextGenerationTask")).toBeDefined();
    });

    test("should register on worker server with 4 functions", () => {
      const mockServer = { registerFunction: vi.fn() };
      const provider = new AnthropicProvider(ANTHROPIC_TASKS);
      provider.registerOnWorkerServer(mockServer as any);

      expect(mockServer.registerFunction).toHaveBeenCalledTimes(6);
    });
  });

  describe("Anthropic_TextGeneration", () => {
    test("should call messages.create with correct params", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "Hello from Claude" }],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_TextGeneration(
        { prompt: "Say hello", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "Hello from Claude" });
      const [params] = mockMessagesCreate.mock.calls[0];
      expect(params.model).toBe("claude-sonnet-4-20250514");
      expect(params.messages).toEqual([{ role: "user", content: "Say hello" }]);
    });

    test("should default max_tokens to 1024", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "result" }],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      await Anthropic_TextGeneration(
        { prompt: "test", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockMessagesCreate.mock.calls[0];
      expect(params.max_tokens).toBe(1024);
    });

    test("should use maxTokens from input when provided", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "result" }],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      await Anthropic_TextGeneration(
        { prompt: "test", model: model as any, maxTokens: 500 },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockMessagesCreate.mock.calls[0];
      expect(params.max_tokens).toBe(500);
    });

    test("should handle non-text content blocks", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "tool_use", id: "test", name: "test", input: {} }],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_TextGeneration(
        { prompt: "test", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "" });
    });
  });

  describe("Anthropic_TextRewriter", () => {
    test("should use system parameter (top-level, not message role)", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "Rewritten" }],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_TextRewriter(
        { text: "Original", prompt: "Make formal", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "Rewritten" });
      const [params] = mockMessagesCreate.mock.calls[0];
      expect(params.system).toBe("Make formal");
      expect(params.messages).toEqual([{ role: "user", content: "Original" }]);
    });
  });

  describe("Anthropic_TextSummary", () => {
    test("should use system parameter for summarization", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "Summary" }],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_TextSummary(
        { text: "Long text", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ text: "Summary" });
      const [params] = mockMessagesCreate.mock.calls[0];
      expect(params.system).toContain("Summarize");
    });
  });

  describe("error handling", () => {
    test("should throw when API key is missing", async () => {
      await expect(
        Anthropic_TextGeneration(
          { prompt: "test", model: {} as any },
          { provider_config: { model_name: "claude-sonnet-4-20250514" } } as any,
          noopProgress,
          abortSignal
        )
      ).rejects.toThrow(/Missing Anthropic API key/);
    });

    test("should propagate SDK errors", async () => {
      mockMessagesCreate.mockRejectedValue(new Error("Overloaded"));

      const model = makeModel("claude-sonnet-4-20250514");
      await expect(
        Anthropic_TextGeneration(
          { prompt: "test", model: model as any },
          model,
          noopProgress,
          abortSignal
        )
      ).rejects.toThrow("Overloaded");
    });
  });

  describe("Anthropic_CountTokens", () => {
    test("should call messages.countTokens and map input_tokens to count", async () => {
      mockMessagesCountTokens.mockResolvedValue({ input_tokens: 42 });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_CountTokens(
        { text: "Hello Claude", model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ count: 42 });
      expect(mockMessagesCountTokens).toHaveBeenCalledOnce();
      const [params] = mockMessagesCountTokens.mock.calls[0];
      expect(params.model).toBe("claude-sonnet-4-20250514");
      expect(params.messages).toEqual([{ role: "user", content: "Hello Claude" }]);
    });
  });

  describe("Anthropic_ToolCalling", () => {
    const sampleTools = [
      {
        name: "get_weather",
        description: "Get the weather for a location",
        inputSchema: {
          type: "object" as const,
          properties: { location: { type: "string" } },
          required: ["location"],
        },
      },
    ];

    test("should map tool_choice and tools into the Anthropic request", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "Checking weather…" }],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      await Anthropic_ToolCalling(
        {
          prompt: "What is the weather?",
          tools: sampleTools,
          toolChoice: "auto",
          model: model as any,
        },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockMessagesCreate.mock.calls[0];
      expect(params.tools).toHaveLength(1);
      expect(params.tools[0].name).toBe("get_weather");
      expect(params.tool_choice).toEqual({ type: "auto" });
    });

    test("should parse tool_use blocks into Record keyed by id", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: "text", text: "" },
          { type: "tool_use", id: "tu_1", name: "get_weather", input: { location: "London" } },
        ],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_ToolCalling(
        { prompt: "Weather in London?", tools: sampleTools, model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.toolCalls).toHaveProperty("tu_1");
      expect((result.toolCalls as any)["tu_1"]).toEqual({
        id: "tu_1",
        name: "get_weather",
        input: { location: "London" },
      });
    });

    test("should accumulate input_json_delta events in streaming mode", async () => {
      const streamEvents = [
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Here you go" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "tu_2", name: "get_weather" },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"location":"Berlin"}' },
        },
        { type: "content_block_stop", index: 1 },
      ];

      async function* fakeStream() {
        for (const e of streamEvents) yield e;
      }
      mockMessagesStream.mockReturnValue(fakeStream());

      const model = makeModel("claude-sonnet-4-20250514");
      const events: any[] = [];
      for await (const event of Anthropic_ToolCalling_Stream(
        { prompt: "Weather in Berlin?", tools: sampleTools, model: model as any },
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
      expect(lastDelta.objectDelta).toHaveProperty("tu_2");

      const finish = events.find((e) => e.type === "finish");
      expect(finish).toBeDefined();
      expect(finish.data.toolCalls).toHaveProperty("tu_2");
      expect((finish.data.toolCalls as any)["tu_2"].name).toBe("get_weather");
    });

    test("should filter out tool calls with unknown names", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: "tool_use", id: "tu_ok", name: "get_weather", input: { location: "NYC" } },
          { type: "tool_use", id: "tu_bad", name: "unknown_tool", input: { x: 1 } },
        ],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_ToolCalling(
        { prompt: "test", tools: sampleTools, model: model as any },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.toolCalls).toHaveProperty("tu_ok");
      expect(result.toolCalls).not.toHaveProperty("tu_bad");
    });
  });

  describe("ANTHROPIC_TASKS", () => {
    test("should export three task run functions (no embedding)", () => {
      expect(ANTHROPIC_TASKS).toHaveProperty("CountTokensTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("TextGenerationTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("TextRewriterTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("TextSummaryTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("StructuredGenerationTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("ToolCallingTask");
      expect(ANTHROPIC_TASKS).not.toHaveProperty("TextEmbeddingTask");
      expect(Object.keys(ANTHROPIC_TASKS)).toHaveLength(6);
    });
  });
});
