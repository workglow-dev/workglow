/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "@workglow/ai";
import { OPENAI, OpenAiModelConfig, OpenAiProvider } from "@workglow/ai-provider";
import {
  OPENAI_TASKS,
  OpenAI_CountTokens,
  OpenAI_StructuredGeneration,
  OpenAI_StructuredGeneration_Stream,
  OpenAI_TextEmbedding,
  OpenAI_TextGeneration,
  OpenAI_TextGeneration_Stream,
  OpenAI_TextRewriter,
  OpenAI_TextRewriter_Stream,
  OpenAI_TextSummary,
  OpenAI_TextSummary_Stream,
  OpenAI_ToolCalling,
  OpenAI_ToolCalling_Stream,
  _setTiktokenForTesting,
  _resetOpenAISDKForTesting,
} from "@workglow/ai-provider/openai";
import {
  TaskQueueRegistry,
  getTaskQueueRegistry,
  setTaskQueueRegistry,
} from "@workglow/task-graph";
import { JsonSchema, setLogger } from "@workglow/util";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

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

const makeModel = (modelName: string, credential_key = "test-key") => ({
  model_id: "test-uuid",
  title: "Test Model",
  description: "Test",
  tasks: ["TextGenerationTask"],
  provider: OPENAI as typeof OPENAI,
  provider_config: { model_name: modelName, credential_key },
  metadata: {},
});

const noopProgress = () => {};
const abortSignal = new AbortController().signal;

describe("OpenAiProvider", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let registry: AiProviderRegistry;

  beforeEach(async () => {
    _resetOpenAISDKForTesting();
    await setTaskQueueRegistry(new TaskQueueRegistry());
    setAiProviderRegistry(new AiProviderRegistry());
    registry = getAiProviderRegistry();
    _setTiktokenForTesting({
      encoding_for_model: vi.fn((model: string) => {
        if (model === "unknown-model") throw new Error("Unknown model");
        return { encode: mockTiktokenEncode };
      }),
      get_encoding: vi.fn((_name: string) => ({ encode: mockTiktokenEncode })),
    } as any);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
  });

  afterAll(async () => {
    _setTiktokenForTesting(undefined);
    await setTaskQueueRegistry(null);
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
        "ModelInfoTask",
        "StructuredGenerationTask",
        "ToolCallingTask",
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
      expect(registry.getDirectRunFn(OPENAI, "StructuredGenerationTask")).toBeDefined();
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

      expect(mockServer.registerFunction).toHaveBeenCalledTimes(8);
    });
  });

  describe("OpenAI_TextGeneration", () => {
    test("should call chat.completions.create with correct params", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "Hello world" } }],
      });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_TextGeneration(
        { prompt: "Say hello", model: model },
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
          model: model,
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
        { prompt: "test", model: model },
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

    test("should embed an array of strings", async () => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      });

      const model = makeModel("text-embedding-3-small");
      const result = await OpenAI_TextEmbedding(
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

  describe("OpenAI_TextRewriter", () => {
    test("should use system prompt for rewriting", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "Rewritten text" } }],
      });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_TextRewriter(
        { text: "Original text", prompt: "Make it formal", model: model },
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
        { text: "Long text here", model: model },
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
      const savedKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      try {
        await expect(
          OpenAI_TextGeneration(
            { prompt: "test", model: {} as any },
            { provider_config: { model_name: "gpt-4o" }, provider: OPENAI } as OpenAiModelConfig,
            noopProgress,
            abortSignal
          )
        ).rejects.toThrow(/Missing OpenAI API key/);
      } finally {
        if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
      }
    });

    test("should throw when model name is missing", async () => {
      await expect(
        OpenAI_TextGeneration(
          { prompt: "test", model: {} as any },
          { provider_config: { api_key: "key" }, provider: OPENAI } as any,
          noopProgress,
          abortSignal
        )
      ).rejects.toThrow(/Missing model name/);
    });

    test("should propagate SDK errors", async () => {
      mockCreate.mockRejectedValue(new Error("Rate limit exceeded"));

      const model = makeModel("gpt-4o");
      await expect(
        OpenAI_TextGeneration({ prompt: "test", model: model }, model, noopProgress, abortSignal)
      ).rejects.toThrow("Rate limit exceeded");
    });
  });

  describe("OpenAI_CountTokens", () => {
    test("should return token count for known model", async () => {
      mockTiktokenEncode.mockReturnValue([1, 2, 3, 4, 5]);

      const model = makeModel("gpt-4o");
      const result = await OpenAI_CountTokens(
        { text: "Hello world", model: model },
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
        { text: "Hi", model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result).toEqual({ count: 2 });
    });
  });

  describe("OpenAI_ToolCalling", () => {
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

    test("should map toolChoice and tools into the OpenAI request", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "Checking weather…", tool_calls: [] } }],
      });

      const model = makeModel("gpt-4o");
      await OpenAI_ToolCalling(
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

      const [params] = mockCreate.mock.calls[0];
      expect(params.tools).toHaveLength(1);
      expect(params.tools[0].type).toBe("function");
      expect(params.tools[0].function.name).toBe("get_weather");
      expect(params.tool_choice).toBe("auto");
    });

    test("should parse message.tool_calls into Record keyed by id", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call_1",
                  function: { name: "get_weather", arguments: '{"location":"London"}' },
                },
              ],
            },
          },
        ],
      });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_ToolCalling(
        { prompt: "What is the weather in London?", tools: sampleTools, model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.toolCalls).toHaveProperty("call_1");
      expect((result.toolCalls as any)["call_1"]).toEqual({
        id: "call_1",
        name: "get_weather",
        input: { location: "London" },
      });
    });

    test("should fall back gracefully when tool arguments are invalid JSON", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                { id: "call_2", function: { name: "get_weather", arguments: '{"location":' } },
              ],
            },
          },
        ],
      });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_ToolCalling(
        { prompt: "test", tools: sampleTools, model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.toolCalls).toHaveProperty("call_2");
    });

    test("should accumulate tool_calls deltas in streaming mode", async () => {
      const chunks = [
        { choices: [{ delta: { content: "Here you go" }, finish_reason: null }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_3", function: { name: "get_weather", arguments: "" } },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"location":"Paris"}' } }],
              },
              finish_reason: null,
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ];

      async function* chunkStream() {
        for (const c of chunks) yield c;
      }
      mockCreate.mockResolvedValue(chunkStream());

      const model = makeModel("gpt-4o");
      const events: any[] = [];
      for await (const event of OpenAI_ToolCalling_Stream(
        { prompt: "Weather in Paris?", tools: sampleTools, model: model },
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
      expect(lastDelta.objectDelta).toHaveProperty("call_3");
      expect((lastDelta.objectDelta as any)["call_3"].name).toBe("get_weather");

      const finish = events.find((e) => e.type === "finish");
      expect(finish).toBeDefined();
      expect(finish.data.toolCalls).toHaveProperty("call_3");
    });

    test("should filter out tool calls with unknown names", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                { id: "ok_1", function: { name: "get_weather", arguments: '{"location":"NYC"}' } },
                { id: "bad_1", function: { name: "unknown_tool", arguments: '{"x":1}' } },
              ],
            },
          },
        ],
      });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_ToolCalling(
        { prompt: "test", tools: sampleTools, model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.toolCalls).toHaveProperty("ok_1");
      expect(result.toolCalls).not.toHaveProperty("bad_1");
    });
  });

  // ========================================================================
  // Structured generation
  // ========================================================================
  describe("OpenAI_StructuredGeneration", () => {
    test("should use json_schema response format", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '{"name":"Alice"}' } }],
      });

      const model = makeModel("gpt-4o");
      const schema = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      } as const;
      const result = await OpenAI_StructuredGeneration(
        { prompt: "Extract name", model: model, outputSchema: schema },
        model,
        noopProgress,
        abortSignal,
        schema
      );

      expect(result.object).toEqual({ name: "Alice" });
      const [params] = mockCreate.mock.calls[0];
      expect(params.response_format.type).toBe("json_schema");
      expect(params.response_format.json_schema.strict).toBe(true);
    });

    test("should prefer input outputSchema over outputSchema parameter", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '{"x":1}' } }],
      });

      const inputSchema = { type: "object", properties: { x: { type: "number" } } } as const;
      const fallbackSchema = {
        type: "object",
        properties: { y: { type: "number" } },
      } as const;

      const model = makeModel("gpt-4o");
      await OpenAI_StructuredGeneration(
        { prompt: "test", model: model, outputSchema: inputSchema },
        model,
        noopProgress,
        abortSignal,
        fallbackSchema
      );

      const [params] = mockCreate.mock.calls[0];
      expect(params.response_format.json_schema.schema).toEqual(inputSchema);
    });
  });

  describe("OpenAI_StructuredGeneration_Stream", () => {
    test("should yield object-delta events and finish with final object", async () => {
      const chunks = [
        { choices: [{ delta: { content: '{"name":' } }] },
        { choices: [{ delta: { content: '"Bob"}' } }] },
      ];

      async function* chunkStream() {
        for (const c of chunks) yield c;
      }
      mockCreate.mockResolvedValue(chunkStream());

      const model = makeModel("gpt-4o");
      const schema = { type: "object", properties: { name: { type: "string" } } } as const;
      const events: any[] = [];
      for await (const event of OpenAI_StructuredGeneration_Stream(
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
  describe("OpenAI_TextGeneration_Stream", () => {
    test("should yield text-delta events and a finish event", async () => {
      const chunks = [
        { choices: [{ delta: { content: "Hello " } }] },
        { choices: [{ delta: { content: "world" } }] },
      ];

      async function* chunkStream() {
        for (const c of chunks) yield c;
      }
      mockCreate.mockResolvedValue(chunkStream());

      const model = makeModel("gpt-4o");
      const events: any[] = [];
      for await (const event of OpenAI_TextGeneration_Stream(
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
    });
  });

  describe("OpenAI_TextRewriter_Stream", () => {
    test("should yield text-delta events and a finish event", async () => {
      const chunks = [{ choices: [{ delta: { content: "Rewritten" } }] }];

      async function* chunkStream() {
        for (const c of chunks) yield c;
      }
      mockCreate.mockResolvedValue(chunkStream());

      const model = makeModel("gpt-4o");
      const events: any[] = [];
      for await (const event of OpenAI_TextRewriter_Stream(
        { text: "Original", prompt: "Make formal", model: model },
        model,
        abortSignal
      )) {
        events.push(event);
      }

      const textDeltas = events.filter((e) => e.type === "text-delta");
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0].textDelta).toBe("Rewritten");

      const finish = events.find((e) => e.type === "finish");
      expect(finish).toBeDefined();
    });
  });

  describe("OpenAI_TextSummary_Stream", () => {
    test("should yield text-delta events and a finish event", async () => {
      const chunks = [{ choices: [{ delta: { content: "TL;DR" } }] }];

      async function* chunkStream() {
        for (const c of chunks) yield c;
      }
      mockCreate.mockResolvedValue(chunkStream());

      const model = makeModel("gpt-4o");
      const events: any[] = [];
      for await (const event of OpenAI_TextSummary_Stream(
        { text: "Long text", model: model },
        model,
        abortSignal
      )) {
        events.push(event);
      }

      const textDeltas = events.filter((e) => e.type === "text-delta");
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0].textDelta).toBe("TL;DR");

      const finish = events.find((e) => e.type === "finish");
      expect(finish).toBeDefined();
    });
  });

  // ========================================================================
  // Multi-turn conversation (ToolCalling with messages)
  // ========================================================================
  describe("OpenAI_ToolCalling multi-turn", () => {
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

    test("should convert messages array into OpenAI format via toOpenAIMessages", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "Sunny", tool_calls: [] } }],
      });

      const model = makeModel("gpt-4o");
      await OpenAI_ToolCalling(
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
                  id: "call_1",
                  name: "get_weather",
                  input: { location: "London" },
                },
              ],
            },
            {
              role: "tool",
              content: [
                { tool_use_id: "call_1", content: "Sunny, 22°C" },
              ],
            },
          ],
        },
        model,
        noopProgress,
        abortSignal
      );

      const [params] = mockCreate.mock.calls[0];
      expect(params.messages.length).toBeGreaterThanOrEqual(3);
    });

    test("should handle toolChoice 'none' correctly", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "No tools", tool_calls: [] } }],
      });

      const model = makeModel("gpt-4o");
      await OpenAI_ToolCalling(
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

      const [params] = mockCreate.mock.calls[0];
      expect(params.tool_choice).toBe("none");
    });

    test("should handle toolChoice 'required'", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                { id: "call_1", function: { name: "get_weather", arguments: '{"location":"NYC"}' } },
              ],
            },
          },
        ],
      });

      const model = makeModel("gpt-4o");
      await OpenAI_ToolCalling(
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

      const [params] = mockCreate.mock.calls[0];
      expect(params.tool_choice).toBe("required");
    });

    test("should map specific tool name to function choice", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                { id: "call_1", function: { name: "get_weather", arguments: '{"location":"NYC"}' } },
              ],
            },
          },
        ],
      });

      const model = makeModel("gpt-4o");
      await OpenAI_ToolCalling(
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

      const [params] = mockCreate.mock.calls[0];
      expect(params.tool_choice).toEqual({ type: "function", function: { name: "get_weather" } });
    });
  });

  // ========================================================================
  // Batch/array input
  // ========================================================================
  describe("batch input handling", () => {
    test("should process array prompts sequentially for TextGeneration", async () => {
      mockCreate
        .mockResolvedValueOnce({ choices: [{ message: { content: "Reply 1" } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: "Reply 2" } }] });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_TextGeneration(
        { prompt: ["Prompt 1", "Prompt 2"], model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.text).toEqual(["Reply 1", "Reply 2"]);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    test("should process array texts sequentially for TextRewriter", async () => {
      mockCreate
        .mockResolvedValueOnce({ choices: [{ message: { content: "Formal 1" } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: "Formal 2" } }] });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_TextRewriter(
        { text: ["Casual 1", "Casual 2"], prompt: "Make formal", model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.text).toEqual(["Formal 1", "Formal 2"]);
    });

    test("should process array texts sequentially for TextSummary", async () => {
      mockCreate
        .mockResolvedValueOnce({ choices: [{ message: { content: "Summary 1" } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: "Summary 2" } }] });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_TextSummary(
        { text: ["Long 1", "Long 2"], model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.text).toEqual(["Summary 1", "Summary 2"]);
    });

    test("should process array texts sequentially for CountTokens", async () => {
      mockTiktokenEncode
        .mockReturnValueOnce([1, 2, 3])
        .mockReturnValueOnce([1, 2, 3, 4, 5]);

      const model = makeModel("gpt-4o");
      const result = await OpenAI_CountTokens(
        { text: ["Short", "Longer text here"], model: model },
        model,
        noopProgress,
        abortSignal
      );

      expect(result.count).toEqual([3, 5]);
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

      mockCreate
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: "Checking 1",
                tool_calls: [
                  { id: "c1", function: { name: "get_weather", arguments: '{"location":"NYC"}' } },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: "Checking 2",
                tool_calls: [
                  { id: "c2", function: { name: "get_weather", arguments: '{"location":"LA"}' } },
                ],
              },
            },
          ],
        });

      const model = makeModel("gpt-4o");
      const result = await OpenAI_ToolCalling(
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
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "Hello" } }],
      });

      const model = makeModel("gpt-4o");
      const progressCalls: number[] = [];
      await OpenAI_TextGeneration(
        { prompt: "test", model: model },
        model,
        (pct) => progressCalls.push(pct),
        abortSignal
      );

      expect(progressCalls).toContain(0);
      expect(progressCalls).toContain(100);
    });
  });

  describe("OPENAI_TASKS", () => {
    test("should export all task run functions", () => {
      expect(OPENAI_TASKS).toHaveProperty("TextGenerationTask");
      expect(OPENAI_TASKS).toHaveProperty("TextEmbeddingTask");
      expect(OPENAI_TASKS).toHaveProperty("TextRewriterTask");
      expect(OPENAI_TASKS).toHaveProperty("TextSummaryTask");
      expect(OPENAI_TASKS).toHaveProperty("CountTokensTask");
      expect(OPENAI_TASKS).toHaveProperty("ModelInfoTask");
      expect(OPENAI_TASKS).toHaveProperty("StructuredGenerationTask");
      expect(OPENAI_TASKS).toHaveProperty("ToolCallingTask");
      expect(Object.keys(OPENAI_TASKS)).toHaveLength(8);
    });
  });
});
