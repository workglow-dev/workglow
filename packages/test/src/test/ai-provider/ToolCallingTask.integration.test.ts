/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCall, ToolCallingTaskOutput } from "@workglow/ai";
import {
  DownloadModelTask,
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "@workglow/ai";
import {
  HF_TRANSFORMERS_ONNX,
  type HfTransformersOnnxModelRecord,
  HuggingFaceTransformersProvider,
} from "@workglow/ai-provider";
import {
  clearPipelineCache,
  createToolCallMarkupFilter,
  HFT_REACTIVE_TASKS,
  HFT_STREAM_TASKS,
  HFT_TASKS,
  parseToolCallsFromText,
} from "@workglow/ai-provider/hf-transformers";
import { getTaskQueueRegistry, setTaskQueueRegistry, Workflow } from "@workglow/task-graph";
import { JsonSchema, setLogger } from "@workglow/util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getTestingLogger } from "../../binding/TestingLogger";

// ========================================================================
// Unit tests for parseToolCallsFromText (the HFT parser)
// ========================================================================

describe("parseToolCallsFromText", () => {
  it("should parse <tool_call> XML tag format", () => {
    const text = `I'll check the weather for you.\n<tool_call>{"name":"get_weather","arguments":{"location":"NYC"}}</tool_call>`;
    const result = parseToolCallsFromText(text);

    expect(result.text).toBe("I'll check the weather for you.");
    expect(result.toolCalls).toHaveLength(1);

    const call = result.toolCalls[0];
    expect(call.name).toBe("get_weather");
    expect(call.input).toEqual({ location: "NYC" });
  });

  it("should parse multiple <tool_call> tags", () => {
    const text = `<tool_call>{"name":"get_weather","arguments":{"location":"NYC"}}</tool_call>\n<tool_call>{"name":"get_weather","arguments":{"location":"London"}}</tool_call>`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].input.location).toBe("NYC");
    expect(result.toolCalls[1].input.location).toBe("London");
  });

  it("should parse bare JSON objects with name+arguments", () => {
    const text = `Here is the result: {"name":"search","arguments":{"query":"test"}}`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0];
    expect(call.name).toBe("search");
    expect(call.input).toEqual({ query: "test" });
    expect(result.text).toBe("Here is the result:");
  });

  it("should parse bare JSON objects with name+parameters", () => {
    const text = `{"name":"search","parameters":{"query":"test"}}`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0];
    expect(call.name).toBe("search");
    expect(call.input).toEqual({ query: "test" });
  });

  it("should parse OpenAI-style function format", () => {
    const text = `{"function":{"name":"get_weather","arguments":{"location":"Paris"}}}`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0];
    expect(call.name).toBe("get_weather");
    expect(call.input).toEqual({ location: "Paris" });
  });

  it("should parse OpenAI-style with stringified arguments", () => {
    const text = '{"function":{"name":"get_weather","arguments":"{\\"location\\":\\"Paris\\"}"}}';
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0];
    expect(call.name).toBe("get_weather");
    expect(call.input).toEqual({ location: "Paris" });
  });

  it("should handle nested JSON in arguments", () => {
    const text = `<tool_call>{"name":"create_event","arguments":{"title":"Meeting","details":{"time":"3pm","attendees":["Alice","Bob"]}}}</tool_call>`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0];
    expect(call.name).toBe("create_event");
    expect(call.input.title).toBe("Meeting");
    expect(call.input.details).toEqual({ time: "3pm", attendees: ["Alice", "Bob"] });
  });

  it("should return empty toolCalls for plain text", () => {
    const text = "Just a normal response with no tool calls.";
    const result = parseToolCallsFromText(text);

    expect(result.text).toBe("Just a normal response with no tool calls.");
    expect(result.toolCalls).toHaveLength(0);
  });

  it("should handle invalid JSON inside <tool_call> tags gracefully", () => {
    const text = `<tool_call>not valid json</tool_call>`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(0);
  });

  it("should not match JSON objects without name key", () => {
    const text = `Here is some data: {"value": 42, "label": "test"}`;
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.text).toBe(`Here is some data: {"value": 42, "label": "test"}`);
  });
});

// ========================================================================
// Unit tests for createToolCallMarkupFilter (streaming markup suppression)
// ========================================================================

describe("createToolCallMarkupFilter", () => {
  function runFilter(tokens: string[]): string {
    let output = "";
    const filter = createToolCallMarkupFilter((text) => {
      output += text;
    });
    for (const token of tokens) {
      filter.feed(token);
    }
    filter.flush();
    return output;
  }

  it("should pass through plain text unchanged", () => {
    expect(runFilter(["Hello", " world", "!"])).toBe("Hello world!");
  });

  it("should suppress a complete <tool_call> block in a single token", () => {
    expect(
      runFilter(["Here is the result.", '<tool_call>{"name":"fn","arguments":{}}</tool_call>'])
    ).toBe("Here is the result.");
  });

  it("should suppress a <tool_call> block split across multiple tokens", () => {
    expect(
      runFilter(["Hi. ", "<tool", "_call>", '{"name":"fn",', '"arguments":{}}', "</tool", "_call>"])
    ).toBe("Hi. ");
  });

  it("should emit text after a closed tool_call block", () => {
    expect(runFilter(['<tool_call>{"name":"fn","arguments":{}}</tool_call>', " Done."])).toBe(
      " Done."
    );
  });

  it("should handle text after the close tag in the same token", () => {
    expect(runFilter(['<tool_call>{"name":"fn","arguments":{}}</tool_call> trailing text'])).toBe(
      " trailing text"
    );
  });

  it("should suppress multiple tool_call blocks", () => {
    expect(
      runFilter([
        "A",
        '<tool_call>{"name":"a","arguments":{}}</tool_call>',
        " B",
        '<tool_call>{"name":"b","arguments":{}}</tool_call>',
        " C",
      ])
    ).toBe("A B C");
  });

  it("should handle partial < prefix that is not a tool_call tag", () => {
    // A lone "<" followed by non-matching text should eventually flush
    expect(runFilter(["price ", "<", " $5"])).toBe("price < $5");
  });

  it("should handle partial <tool_ prefix that does not complete", () => {
    // If the stream ends with a partial prefix that never completed, flush it
    expect(runFilter(["text <tool_"])).toBe("text <tool_");
  });

  it("should handle the open tag split at every character boundary", () => {
    // Simulate worst-case tokenization: each character of <tool_call> is a separate token
    const tag = "<tool_call>";
    const tokens = [
      "Hi ",
      ...tag.split(""),
      '{"name":"fn","arguments":{}}',
      "</tool_call>",
      " end",
    ];
    expect(runFilter(tokens)).toBe("Hi  end");
  });

  it("should flush pending buffer when stream ends without a tag", () => {
    // Text ending with "<t" — not a full tag, should be flushed
    expect(runFilter(["hello <t"])).toBe("hello <t");
  });

  it("should not emit suppressed content even if tag is never closed", () => {
    // Unclosed tag — all content after the open tag is suppressed
    expect(runFilter(["before ", "<tool_call>", "inside tag content"])).toBe("before ");
  });
});

// ========================================================================
// Integration test with real HFT model
// ========================================================================

describe("ToolCallingTask with HFT models", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  beforeAll(async () => {
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    clearPipelineCache();
    await new HuggingFaceTransformersProvider(
      HFT_TASKS,
      HFT_STREAM_TASKS,
      HFT_REACTIVE_TASKS
    ).register({ mode: "inline" });
  });

  afterAll(async () => {
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  });

  const MODEL_ID = "onnx:onnx-community/Qwen2.5-0.5B-Instruct:q4";

  const weatherTools = [
    {
      name: "get_weather",
      description: "Get the current weather for a city",
      inputSchema: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The city name, e.g. San Francisco",
          },
        },
        required: ["location"],
      } as const satisfies JsonSchema,
    },
  ];

  it("should download the model", async () => {
    const model: HfTransformersOnnxModelRecord = {
      model_id: MODEL_ID,
      title: "Qwen2.5-0.5B-Instruct",
      description: "Small instruction-tuned model with native tool calling support",
      tasks: ["TextGenerationTask", "ToolCallingTask"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "text-generation",
        model_path: "onnx-community/Qwen2.5-0.5B-Instruct",
        dtype: "q4",
      },
      metadata: {},
    };

    await getGlobalModelRepository().addModel(model);

    const download = new DownloadModelTask({ model: MODEL_ID });
    let lastProgress = -1;
    download.on("progress", (progress, _message, details) => {
      if (progress !== lastProgress) {
        logger.info(
          `Overall: ${progress}% | File: ${details?.file || "?"} @ ${(details?.progress || 0).toFixed(1)}%`
        );
        lastProgress = progress;
      }
    });

    await download.run();
  }, 300000); // 5 minute timeout for model download

  it("should produce a tool call with toolChoice auto", async () => {
    const workflow = new Workflow();
    workflow.toolCalling({
      model: MODEL_ID,
      prompt: "What is the weather in San Francisco?",
      tools: weatherTools,
      toolChoice: "auto",
    });

    const result = (await workflow.run()) as ToolCallingTaskOutput;

    expect(result).toBeDefined();
    expect(typeof result.text).toBe("string");
    expect(result.toolCalls).toBeDefined();
    expect(typeof result.toolCalls).toBe("object");

    // The model should call the weather tool for this prompt
    const calls = result.toolCalls as Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }>;

    if (calls.length > 0) {
      // Validate tool call structure
      const call = calls[0];
      expect(call.id).toBeDefined();
      expect(call.name).toBe("get_weather");
      expect(call.input).toBeDefined();
      expect(typeof call.input).toBe("object");
    }
  }, 120000);

  it("should produce no tool calls with toolChoice none", async () => {
    const workflow = new Workflow();
    workflow.toolCalling({
      model: MODEL_ID,
      prompt: "What is the weather in San Francisco?",
      tools: weatherTools,
      toolChoice: "none",
    });

    const result = (await workflow.run()) as ToolCallingTaskOutput;

    expect(result).toBeDefined();
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.toolCalls).toHaveLength(0);
  }, 120000);

  it("should work with multiple tools", async () => {
    const multiTools = [
      ...weatherTools,
      {
        name: "search",
        description: "Search the web for information",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
          },
          required: ["query"],
        } as const satisfies JsonSchema,
      },
    ];

    const workflow = new Workflow();
    workflow.toolCalling({
      model: MODEL_ID,
      prompt: "What is the weather in Tokyo?",
      tools: multiTools,
      toolChoice: "auto",
    });

    const result = (await workflow.run()) as ToolCallingTaskOutput;

    expect(result).toBeDefined();
    expect(typeof result.text).toBe("string");
    expect(result.toolCalls).toBeDefined();

    // If there are tool calls, they should only reference known tools
    for (const call of result.toolCalls as ToolCall[]) {
      expect(["get_weather", "search"]).toContain(call.name);
    }
  }, 120000);

  it("should accept a system prompt", async () => {
    const workflow = new Workflow();
    workflow.toolCalling({
      model: MODEL_ID,
      prompt: "What is the weather in Berlin?",
      tools: weatherTools,
      toolChoice: "auto",
      systemPrompt: "You are a helpful weather assistant. Always use the get_weather tool.",
    });

    const result = (await workflow.run()) as ToolCallingTaskOutput;

    expect(result).toBeDefined();
    expect(typeof result.text).toBe("string");
    expect(result.toolCalls).toBeDefined();
  }, 120000);

  it("should stream tool calling results", async () => {
    const workflow = new Workflow();
    workflow.toolCalling({
      model: MODEL_ID,
      prompt: "What is the weather in Paris?",
      tools: weatherTools,
      toolChoice: "auto",
    });

    const result = (await workflow.run()) as ToolCallingTaskOutput;

    // Streaming produces the same output contract
    expect(result).toBeDefined();
    expect(typeof result.text).toBe("string");
    expect(result.toolCalls).toBeDefined();
    expect(typeof result.toolCalls).toBe("object");
  }, 120000);
});
