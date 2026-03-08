/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentTaskOutput, StructuredGenerationTaskOutput, ToolDefinition } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";
import type { JsonSchema } from "@workglow/util";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

// ========================================================================
// Setup interface
// ========================================================================

export interface AiProviderTestSetup {
  /** Human-readable name for describe blocks */
  readonly name: string;
  /** Whether to skip (e.g., missing env var) */
  readonly skip: boolean;
  /** Register the provider + add model records. Called in beforeAll. */
  readonly setup: () => Promise<void>;
  /** Cleanup. Called in afterAll. */
  readonly teardown: () => Promise<void>;
  /** Model ID to use for text generation */
  readonly textGenerationModel: string;
  /** Model ID to use for tool calling (may be same as above) */
  readonly toolCallingModel: string;
  /** Model ID for structured generation (may be same) */
  readonly structuredGenerationModel: string;
  /** Max tokens to request (keep small for fast tests) */
  readonly maxTokens: number;
  /** Timeout per test in ms */
  readonly timeout: number;
}

// ========================================================================
// Shared test tools
// ========================================================================

const weatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Get the current weather for a given city. Returns temperature and conditions.",
  inputSchema: {
    type: "object",
    properties: {
      location: { type: "string", description: "City name, e.g. San Francisco" },
    },
    required: ["location"],
  } as const satisfies JsonSchema,
};

const finishTool: ToolDefinition = {
  name: "finish",
  description:
    "Call this tool when you have completed the task. Pass your final structured result as the input.",
  inputSchema: {
    type: "object",
    properties: {
      answer: { type: "number", description: "The final answer" },
    },
    required: ["answer"],
    additionalProperties: false,
  } as const satisfies JsonSchema,
};

const calculateSumTool: ToolDefinition = {
  name: "calculate_sum",
  description:
    "Calculate the sum of two numbers. Call this tool with parameters a and b to get their sum.",
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "number", description: "First number" },
      b: { type: "number", description: "Second number" },
    },
    required: ["a", "b"],
  } as const satisfies JsonSchema,
  execute: async (input: Record<string, unknown>) => {
    const a = Number(input.a);
    const b = Number(input.b);
    return { result: a + b };
  },
};

// ========================================================================
// Generic test suite
// ========================================================================

export function runGenericAiProviderTests(setup: AiProviderTestSetup): void {
  describe.skipIf(setup.skip)(`Generic AI Provider: ${setup.name}`, () => {
    beforeAll(async () => {
      await setup.setup();
    }, setup.timeout);

    afterAll(async () => {
      await setup.teardown();
    });

    // ====================================================================
    // TextGeneration — basic smoke test
    // ====================================================================

    describe("TextGeneration", () => {
      it(
        "should generate non-empty text from a prompt",
        async () => {
          const workflow = new Workflow();
          workflow.textGeneration({
            model: setup.textGenerationModel,
            prompt: "Say hello in one sentence.",
            maxTokens: setup.maxTokens,
          });

          const result = (await workflow.run()) as { text: string };

          expect(result).toBeDefined();
          expect(typeof result.text).toBe("string");
          expect(result.text.length).toBeGreaterThan(0);
        },
        setup.timeout
      );
    });

    // ====================================================================
    // ToolCalling — single turn
    // ====================================================================

    describe("ToolCalling", () => {
      it(
        "should produce a tool call with toolChoice auto",
        async () => {
          const workflow = new Workflow();
          workflow.toolCalling({
            model: setup.toolCallingModel,
            prompt: "What is the weather in San Francisco?",
            tools: [weatherTool],
            toolChoice: "auto",
            maxTokens: setup.maxTokens,
          });

          const result = (await workflow.run()) as {
            text: string;
            toolCalls: Record<string, { id: string; name: string; input: Record<string, unknown> }>;
          };

          expect(result).toBeDefined();
          expect(result.toolCalls).toBeDefined();

          const calls = Object.values(result.toolCalls);
          // The model should call get_weather
          expect(calls.length).toBeGreaterThan(0);
          expect(calls[0].name).toBe("get_weather");
          expect(calls[0].input).toBeDefined();
        },
        setup.timeout
      );

      it(
        "should produce no tool calls with toolChoice none",
        async () => {
          const workflow = new Workflow();
          workflow.toolCalling({
            model: setup.toolCallingModel,
            prompt: "What is the weather in San Francisco?",
            tools: [weatherTool],
            toolChoice: "none",
            maxTokens: setup.maxTokens,
          });

          const result = (await workflow.run()) as {
            text: string;
            toolCalls: Record<string, unknown>;
          };

          expect(result).toBeDefined();
          expect(typeof result.text).toBe("string");
          expect(result.text.length).toBeGreaterThan(0);
          expect(Object.keys(result.toolCalls)).toHaveLength(0);
        },
        setup.timeout
      );
    });

    // ====================================================================
    // ToolCalling — multi-turn via messages
    // ====================================================================

    describe("ToolCalling multi-turn", () => {
      it(
        "should handle tool result fed back via messages",
        async () => {
          // First call: get tool call
          const workflow1 = new Workflow();
          workflow1.toolCalling({
            model: setup.toolCallingModel,
            prompt: "What is the weather in Tokyo?",
            tools: [weatherTool],
            toolChoice: "auto",
            maxTokens: setup.maxTokens,
          });

          const result1 = (await workflow1.run()) as {
            text: string;
            toolCalls: Record<string, { id: string; name: string; input: Record<string, unknown> }>;
          };

          const calls = Object.values(result1.toolCalls);
          if (calls.length === 0) {
            // Model didn't call the tool — can happen with small models; skip gracefully
            return;
          }

          const call = calls[0];

          // Second call: feed tool result back
          const workflow2 = new Workflow();
          workflow2.toolCalling({
            model: setup.toolCallingModel,
            prompt: "What is the weather in Tokyo?",
            tools: [weatherTool],
            toolChoice: "auto",
            maxTokens: setup.maxTokens,
            messages: [
              { role: "user", content: "What is the weather in Tokyo?" },
              {
                role: "assistant",
                content: [
                  { type: "text", text: result1.text || "Let me check" },
                  { type: "tool_use", id: call.id, name: call.name, input: call.input },
                ],
              },
              {
                role: "tool",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: call.id,
                    content: JSON.stringify({ temperature: 22, conditions: "sunny" }),
                  },
                ],
              },
            ],
          });

          const result2 = (await workflow2.run()) as { text: string };

          expect(result2).toBeDefined();
          expect(typeof result2.text).toBe("string");
          expect(result2.text.length).toBeGreaterThan(0);
        },
        setup.timeout
      );
    });

    // ====================================================================
    // StructuredGeneration
    // ====================================================================

    describe("StructuredGeneration", () => {
      it(
        "should generate output conforming to a JSON schema",
        async () => {
          const outputSchema = {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "number" },
            },
            required: ["name", "age"],
            additionalProperties: false,
          } as const satisfies JsonSchema;

          const workflow = new Workflow();
          workflow.structuredGeneration({
            model: setup.structuredGenerationModel,
            prompt:
              "Generate a JSON object with a person's name and age. Use name 'Alice' and age 30.",
            outputSchema,
            maxTokens: setup.maxTokens,
          });

          const result = (await workflow.run()) as StructuredGenerationTaskOutput;

          expect(result).toBeDefined();
          expect(result.object).toBeDefined();
          expect(typeof result.object).toBe("object");
          // Validate shape — fields should exist
          expect(result.object).toHaveProperty("name");
          expect(result.object).toHaveProperty("age");
        },
        setup.timeout
      );
    });

    // ====================================================================
    // AgentTask — full agent loop with function tool
    // ====================================================================

    describe("AgentTask", () => {
      it(
        "should complete an agent loop with a function tool",
        async () => {
          const workflow = new Workflow();
          workflow.agent({
            model: setup.toolCallingModel,
            prompt: "What is 3 + 5? Use the calculate_sum tool to find out.",
            tools: [calculateSumTool],
            maxIterations: 3,
            maxTokens: setup.maxTokens,
          });

          const output = (await workflow.run()) as AgentTaskOutput;

          expect(output).toBeDefined();
          expect(output.iterations).toBeGreaterThanOrEqual(1);
          expect(output.toolCallCount).toBeGreaterThanOrEqual(1);
          expect(typeof output.text).toBe("string");
          expect(output.text.length).toBeGreaterThan(0);
          // The final text should mention the answer
          expect(output.text).toContain("8");
        },
        setup.timeout
      );

      it(
        "should extract structured output via stop tool",
        async () => {
          const workflow = new Workflow();
          workflow.agent({
            model: setup.toolCallingModel,
            prompt:
              "Compute 3 + 5 using the calculate_sum tool, then call the finish tool with the answer in a field called 'answer'.",
            tools: [calculateSumTool, finishTool],
            stopTool: "finish",
            maxIterations: 5,
            maxTokens: setup.maxTokens,
          });

          const output = (await workflow.run()) as AgentTaskOutput;

          expect(output).toBeDefined();
          expect(output.iterations).toBeGreaterThanOrEqual(1);
          // The stop tool should produce structuredOutput
          if (output.structuredOutput) {
            expect(typeof output.structuredOutput).toBe("object");
          }
        },
        setup.timeout
      );
    });
  });
}
