/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProviderRegistry, getAiProviderRegistry, setAiProviderRegistry } from "@workglow/ai";
import { ANTHROPIC, AnthropicProvider } from "@workglow/ai-provider";
import {
  ANTHROPIC_TASKS,
  Anthropic_TextGeneration,
  Anthropic_TextRewriter,
  Anthropic_TextSummary,
} from "@workglow/ai-provider/anthropic";
import {
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskQueueRegistry,
} from "@workglow/task-graph";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockMessagesCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockMessagesCreate };
    constructor(_opts: any) {}
  },
}));

const makeModel = (modelName: string, apiKey = "test-key") => ({
  model_id: "test-uuid",
  title: "Test Model",
  description: "Test",
  tasks: ["TextGenerationTask"],
  provider: ANTHROPIC as typeof ANTHROPIC,
  provider_config: { model_name: modelName, api_key: apiKey },
  metadata: {},
});

const noopProgress = () => {};
const abortSignal = new AbortController().signal;

describe("AnthropicProvider", () => {
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

      expect(mockServer.registerFunction).toHaveBeenCalledTimes(4);
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

  describe("ANTHROPIC_TASKS", () => {
    test("should export three task run functions (no embedding)", () => {
      expect(ANTHROPIC_TASKS).toHaveProperty("CountTokensTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("TextGenerationTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("TextRewriterTask");
      expect(ANTHROPIC_TASKS).toHaveProperty("TextSummaryTask");
      expect(ANTHROPIC_TASKS).not.toHaveProperty("TextEmbeddingTask");
      expect(Object.keys(ANTHROPIC_TASKS)).toHaveLength(4);
    });
  });
});
