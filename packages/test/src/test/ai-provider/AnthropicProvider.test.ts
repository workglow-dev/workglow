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
  Anthropic_StructuredGeneration,
  Anthropic_StructuredGeneration_Stream,
  Anthropic_TextGeneration,
  Anthropic_TextGeneration_Stream,
  Anthropic_TextRewriter,
  Anthropic_TextRewriter_Stream,
  Anthropic_TextSummary,
  Anthropic_TextSummary_Stream,
  Anthropic_ToolCalling,
  Anthropic_ToolCalling_Stream,
} from "@workglow/ai-provider/anthropic";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskQueueRegistry,
} from "@workglow/task-graph";
import { JsonSchema, setLogger } from "@workglow/util";
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
    test("should have correct name and task types (no embedding)", () => {
      const provider = new AnthropicProvider();
      expect(provider.name).toBe(ANTHROPIC);
      expect(provider.supportedTaskTypes).toEqual([
        "CountTokensTask",
        "ModelInfoTask",
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

      expect(mockServer.registerFunction).toHaveBeenCalledTimes(7);
    });
  });

  describe("Anthropic_TextGeneration", () => {
    test("should call messages.create with correct params", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "Hello from Claude" }],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_TextGeneration(
        { prompt: "Say hello", model: model },
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
        { prompt: "test", model: model },
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
        { prompt: "test", model: model, maxTokens: 500 },
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
        { prompt: "test", model: model },
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
        { text: "Original", prompt: "Make formal", model: model },
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
        { text: "Long text", model: model },
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
        Anthropic_TextGeneration({ prompt: "test", model: model }, model, noopProgress, abortSignal)
      ).rejects.toThrow("Overloaded");
    });
  });

  describe("Anthropic_CountTokens", () => {
    test("should call messages.countTokens and map input_tokens to count", async () => {
      mockMessagesCountTokens.mockResolvedValue({ input_tokens: 42 });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_CountTokens(
        { text: "Hello Claude", model: model },
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
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"],
        } as const satisfies JsonSchema,
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
          model: model,
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
        { prompt: "Weather in London?", tools: sampleTools, model: model },
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
        { prompt: "Weather in Berlin?", tools: sampleTools, model: model },
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
        { prompt: "test", tools: sampleTools, model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.toolCalls).toHaveProperty("tu_ok");
      expect(result.toolCalls).not.toHaveProperty("tu_bad");
    });
  });

  // ========================================================================
  // Structured generation
  // ========================================================================
  describe("Anthropic_StructuredGeneration", () => {
    test("should use tool_use trick to force structured output", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: "tool_use", id: "tu_1", name: "structured_output", input: { name: "Alice" } },
        ],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      const schema = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      } as const;
      const result = await Anthropic_StructuredGeneration(
        { prompt: "Extract name", model: model, outputSchema: schema },
        model,
        noopProgress,
        abortSignal,
        schema
      );

      expect(result.object).toEqual({ name: "Alice" });
      const [params] = mockMessagesCreate.mock.calls[0];
      expect(params.tools[0].name).toBe("structured_output");
      expect(params.tool_choice).toEqual({ type: "tool", name: "structured_output" });
    });

    test("should return empty object when no tool_use block found", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "No structured output" }],
      });

      const schema = { type: "object", properties: {} } as const;
      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_StructuredGeneration(
        { prompt: "test", model: model, outputSchema: schema },
        model,
        noopProgress,
        abortSignal,
        schema
      );

      expect(result.object).toEqual({});
    });
  });

  describe("Anthropic_StructuredGeneration_Stream", () => {
    test("should yield object-delta events and a finish with final object", async () => {
      const streamEvents = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tu_1", name: "structured_output" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"name":' },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '"Bob"}' },
        },
      ];

      async function* fakeStream() {
        for (const e of streamEvents) yield e;
      }
      mockMessagesStream.mockReturnValue(fakeStream());

      const model = makeModel("claude-sonnet-4-20250514");
      const schema = { type: "object", properties: { name: { type: "string" } } } as const;
      const events: any[] = [];
      for await (const event of Anthropic_StructuredGeneration_Stream(
        { prompt: "Extract", model: model, outputSchema: schema },
        model,
        abortSignal,
        schema
      )) {
        events.push(event);
      }

      const objectDeltas = events.filter((e) => e.type === "object-delta");
      expect(objectDeltas.length).toBeGreaterThan(0);

      const finish = events.find((e) => e.type === "finish");
      expect(finish).toBeDefined();
      expect(finish.data.object).toEqual({ name: "Bob" });
    });
  });

  // ========================================================================
  // Streaming: TextGeneration, TextRewriter, TextSummary
  // ========================================================================
  describe("Anthropic_TextGeneration_Stream", () => {
    test("should yield text-delta events and include accumulated text in finish", async () => {
      const streamEvents = [
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "world" } },
      ];

      async function* fakeStream() {
        for (const e of streamEvents) yield e;
      }
      mockMessagesStream.mockReturnValue(fakeStream());

      const model = makeModel("claude-sonnet-4-20250514");
      const events: any[] = [];
      for await (const event of Anthropic_TextGeneration_Stream(
        { prompt: "Say hello", model: model },
        model,
        abortSignal
      )) {
        events.push(event);
      }

      const textDeltas = events.filter((e) => e.type === "text-delta");
      expect(textDeltas).toHaveLength(2);
      expect(textDeltas[0].textDelta).toBe("Hello ");
      expect(textDeltas[1].textDelta).toBe("world");

      const finish = events.find((e) => e.type === "finish");
      expect(finish).toBeDefined();
      expect(finish.data.text).toBe("Hello world");
    });
  });

  describe("Anthropic_TextRewriter_Stream", () => {
    test("should accumulate text and include it in finish event", async () => {
      const streamEvents = [
        { type: "content_block_delta", delta: { type: "text_delta", text: "Rewritten" } },
      ];

      async function* fakeStream() {
        for (const e of streamEvents) yield e;
      }
      mockMessagesStream.mockReturnValue(fakeStream());

      const model = makeModel("claude-sonnet-4-20250514");
      const events: any[] = [];
      for await (const event of Anthropic_TextRewriter_Stream(
        { text: "Original", prompt: "Make formal", model: model },
        model,
        abortSignal
      )) {
        events.push(event);
      }

      const finish = events.find((e) => e.type === "finish");
      expect(finish.data.text).toBe("Rewritten");
    });
  });

  describe("Anthropic_TextSummary_Stream", () => {
    test("should accumulate text and include it in finish event", async () => {
      const streamEvents = [
        { type: "content_block_delta", delta: { type: "text_delta", text: "TL;DR" } },
      ];

      async function* fakeStream() {
        for (const e of streamEvents) yield e;
      }
      mockMessagesStream.mockReturnValue(fakeStream());

      const model = makeModel("claude-sonnet-4-20250514");
      const events: any[] = [];
      for await (const event of Anthropic_TextSummary_Stream(
        { text: "Long text", model: model },
        model,
        abortSignal
      )) {
        events.push(event);
      }

      const finish = events.find((e) => e.type === "finish");
      expect(finish.data.text).toBe("TL;DR");
    });
  });

  // ========================================================================
  // Multi-turn conversation (ToolCalling with messages)
  // ========================================================================
  describe("Anthropic_ToolCalling multi-turn", () => {
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

    test("should convert messages array into Anthropic format", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "The weather is sunny" }],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      await Anthropic_ToolCalling(
        {
          prompt: "What is the weather?",
          tools: sampleTools,
          model: model,
          messages: [
            { role: "user", content: "What is the weather in London?" },
            {
              role: "assistant",
              content: [
                { type: "text", text: "Let me check." },
                {
                  type: "tool_use",
                  id: "tu_1",
                  name: "get_weather",
                  input: { location: "London" },
                },
              ],
            },
            {
              role: "tool",
              content: [
                { tool_use_id: "tu_1", content: "Sunny, 22°C" },
              ],
            },
          ],
        },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockMessagesCreate.mock.calls[0];
      // Should have 3 messages: user, assistant, user (tool_result)
      expect(params.messages).toHaveLength(3);
      expect(params.messages[0].role).toBe("user");
      expect(params.messages[1].role).toBe("assistant");
      // Anthropic sends tool results as role: "user"
      expect(params.messages[2].role).toBe("user");
      expect(params.messages[2].content[0].type).toBe("tool_result");
    });

    test("should send systemPrompt as top-level system param", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "Result" }],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      await Anthropic_ToolCalling(
        {
          prompt: "test",
          tools: sampleTools,
          model: model,
          systemPrompt: "You are a helpful assistant",
        },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockMessagesCreate.mock.calls[0];
      expect(params.system).toBe("You are a helpful assistant");
    });

    test("should handle toolChoice 'none' by omitting tools", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "No tools" }],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      await Anthropic_ToolCalling(
        {
          prompt: "test",
          tools: sampleTools,
          model: model,
          toolChoice: "none",
        },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockMessagesCreate.mock.calls[0];
      expect(params.tools).toBeUndefined();
      expect(params.tool_choice).toBeUndefined();
    });

    test("should map toolChoice 'required' to Anthropic 'any'", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: "tool_use", id: "tu_1", name: "get_weather", input: { location: "NYC" } },
        ],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      await Anthropic_ToolCalling(
        {
          prompt: "test",
          tools: sampleTools,
          model: model,
          toolChoice: "required",
        },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockMessagesCreate.mock.calls[0];
      expect(params.tool_choice).toEqual({ type: "any" });
    });

    test("should map specific tool name to Anthropic tool choice", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: "tool_use", id: "tu_1", name: "get_weather", input: { location: "NYC" } },
        ],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      await Anthropic_ToolCalling(
        {
          prompt: "test",
          tools: sampleTools,
          model: model,
          toolChoice: "get_weather",
        },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockMessagesCreate.mock.calls[0];
      expect(params.tool_choice).toEqual({ type: "tool", name: "get_weather" });
    });
  });

  // ========================================================================
  // Batch/array input
  // ========================================================================
  describe("batch input handling", () => {
    test("should process array prompts sequentially for TextGeneration", async () => {
      mockMessagesCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "Reply 1" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "Reply 2" }] });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_TextGeneration(
        { prompt: ["Prompt 1", "Prompt 2"], model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.text).toEqual(["Reply 1", "Reply 2"]);
      expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    });

    test("should process array texts sequentially for TextRewriter", async () => {
      mockMessagesCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "Formal 1" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "Formal 2" }] });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_TextRewriter(
        { text: ["Casual 1", "Casual 2"], prompt: "Make formal", model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.text).toEqual(["Formal 1", "Formal 2"]);
    });

    test("should process array texts sequentially for TextSummary", async () => {
      mockMessagesCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "Summary 1" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "Summary 2" }] });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_TextSummary(
        { text: ["Long 1", "Long 2"], model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.text).toEqual(["Summary 1", "Summary 2"]);
    });

    test("should process array texts sequentially for CountTokens", async () => {
      mockMessagesCountTokens
        .mockResolvedValueOnce({ input_tokens: 5 })
        .mockResolvedValueOnce({ input_tokens: 10 });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_CountTokens(
        { text: ["Short", "Longer text here"], model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.count).toEqual([5, 10]);
    });

    test("should process array prompts sequentially for ToolCalling", async () => {
      const sampleTools = [
        {
          name: "get_weather",
          description: "Get weather",
          inputSchema: {
            type: "object",
            properties: { location: { type: "string" } },
            required: ["location"],
          } as const satisfies JsonSchema,
        },
      ];

      mockMessagesCreate
        .mockResolvedValueOnce({
          content: [
            { type: "text", text: "Checking 1" },
            { type: "tool_use", id: "tu_1", name: "get_weather", input: { location: "NYC" } },
          ],
        })
        .mockResolvedValueOnce({
          content: [
            { type: "text", text: "Checking 2" },
            { type: "tool_use", id: "tu_2", name: "get_weather", input: { location: "LA" } },
          ],
        });

      const model = makeModel("claude-sonnet-4-20250514");
      const result = await Anthropic_ToolCalling(
        { prompt: ["Weather NYC?", "Weather LA?"], tools: sampleTools, model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.text).toEqual(["Checking 1", "Checking 2"]);
      expect(Array.isArray(result.toolCalls)).toBe(true);
      expect((result.toolCalls as any[])).toHaveLength(2);
    });
  });

  // ========================================================================
  // Progress callback
  // ========================================================================
  describe("progress callback", () => {
    test("should call progress at 0 and 100 for TextGeneration", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "Hello" }],
      });

      const model = makeModel("claude-sonnet-4-20250514");
      const progressCalls: number[] = [];
      await Anthropic_TextGeneration(
        { prompt: "test", model: model },
        model,
        (pct) => progressCalls.push(pct),
        abortSignal
      );

      expect(progressCalls).toContain(0);
      expect(progressCalls).toContain(100);
    });
  });

  describe("ANTHROPIC_TASKS", () => {
    test("should export three task run functions (no embedding)", () => {
      expect(ANTHROPIC_TASKS).toHaveProperty("CountTokensTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("ModelInfoTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("TextGenerationTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("TextRewriterTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("TextSummaryTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("StructuredGenerationTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("ToolCallingTask");
      expect(ANTHROPIC_TASKS).not.toHaveProperty("TextEmbeddingTask");
      expect(Object.keys(ANTHROPIC_TASKS)).toHaveLength(7);
    });
  });
});
