/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCalls, ToolDefinition } from "@workglow/ai";
import { structuredGeneration, textGeneration, toolCalling } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
import type { JsonSchema } from "@workglow/util/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ========================================================================
// Setup interface
// ========================================================================

export interface AiProviderTestSetup {
  /** Human-readable name for describe blocks */
  readonly name: string;
  /** Whether to skip (e.g., missing env var) */
  readonly skip?: boolean;
  /** Register the provider + add model records. Called in beforeAll. */
  readonly setup: () => Promise<void>;
  /** Cleanup. Called in afterAll. */
  readonly teardown: () => Promise<void>;
  /** Model ID to use for text generation */
  readonly textGenerationModel?: string;
  /** Model ID to use for tool calling (may be same as above) */
  readonly toolCallingModel?: string;
  /** Model ID for structured generation (may be same). Omit to skip structured generation tests. */
  readonly structuredGenerationModel?: string;
  /** Model ID for agent (may be same). Omit to skip agent tests. */
  readonly agentModel?: string;
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

    describe.skipIf(!setup.textGenerationModel)("TextGeneration", () => {
      it(
        "should generate non-empty text from a prompt",
        async () => {
          const result = await textGeneration({
            model: setup.textGenerationModel!,
            prompt: "Say hello in one sentence.",
            maxTokens: setup.maxTokens,
          });

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

    describe.skipIf(!setup.toolCallingModel)("ToolCalling", () => {
      it(
        "should produce a tool call with toolChoice required",
        async () => {
          const result = await toolCalling({
            model: setup.toolCallingModel!,
            prompt: "What is the weather in San Francisco?",
            tools: [weatherTool],
            toolChoice: "required",
            maxTokens: setup.maxTokens,
            messages: undefined,
          });

          getLogger().debug("ToolCalling result", result);

          expect(result).toBeDefined();
          expect(result.toolCalls).toBeDefined();

          const calls = result.toolCalls;
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
          const result = await toolCalling({
            model: setup.toolCallingModel!,
            prompt: "What is the weather in San Francisco?",
            tools: [weatherTool],
            toolChoice: "none",
            maxTokens: setup.maxTokens,
            messages: undefined,
          });

          getLogger().debug("ToolCalling result", result);

          expect(result).toBeDefined();
          expect(typeof result.text).toBe("string");
          expect(result.text.length).toBeGreaterThan(0);
          expect(result.toolCalls).toHaveLength(0);
        },
        setup.timeout
      );
    });

    // ====================================================================
    // ToolCalling — multi-turn via messages
    // ====================================================================

    describe.skipIf(!setup.toolCallingModel)("ToolCalling multi-turn", () => {
      it(
        "should handle tool result fed back via messages",
        async () => {
          // First call: get tool call
          const workflow1 = new Workflow();
          workflow1.toolCalling({
            model: setup.toolCallingModel!,
            prompt: "What is the weather in Tokyo?",
            tools: [weatherTool],
            toolChoice: "auto",
            maxTokens: setup.maxTokens,
          });

          const result1 = (await workflow1.run()) as {
            text: string;
            toolCalls: ToolCalls;
          };

          getLogger().debug("ToolCalling result", result1);

          const calls = result1.toolCalls;
          if (calls.length === 0) {
            // Model didn't call the tool — can happen with small models; skip gracefully
            return;
          }

          const call = calls[0];

          // Second call: feed tool result back
          const workflow2 = new Workflow();
          workflow2.toolCalling({
            model: setup.toolCallingModel!,
            prompt: "What is the weather in Tokyo?",
            tools: [weatherTool],
            toolChoice: "auto",
            maxTokens: setup.maxTokens,
            messages: [
              { role: "user", content: [{ type: "text", text: "What is the weather in Tokyo?" }] },
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
                    content: [
                      {
                        type: "text" as const,
                        text: JSON.stringify({ temperature: 22, conditions: "sunny" }),
                      },
                    ],
                    is_error: undefined,
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

    describe.skipIf(!setup.structuredGenerationModel)("StructuredGeneration", () => {
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

          const result = await structuredGeneration({
            model: setup.structuredGenerationModel!,
            prompt:
              "Generate a JSON object with a person's name and age. Use name 'Alice' and age 30.",
            outputSchema,
            maxTokens: setup.maxTokens,
          });

          getLogger().debug("StructuredGeneration result", result);

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
  });
}
