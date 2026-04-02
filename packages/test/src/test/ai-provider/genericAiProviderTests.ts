/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  agent,
  structuredGeneration,
  textGeneration,
  toolCalling,
  type AgentTaskOutput,
  type StructuredGenerationTaskOutput,
  type ToolCalls,
  type ToolDefinition,
} from "@workglow/ai";
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

/** Fixture tallies: numeric strings are district IDs, not operands—votes are looked up independently. */
const DISTRICT_POPULAR_VOTES: Readonly<Record<number, number>> = {
  3: 70,
  5: 90,
};

const getDistrictPopularVotesTool: ToolDefinition = {
  name: "get_district_popular_votes",
  description:
    "Returns the combined popular vote count for two electoral districts. Pass each district's numeric identifier; these IDs are labels only—do not add or otherwise combine the ID digits to guess the result.",
  inputSchema: {
    type: "object",
    properties: {
      district_a: {
        type: "number",
        description:
          "Numeric identifier of the first electoral district (e.g. 3 means district three, not the quantity three).",
      },
      district_b: {
        type: "number",
        description:
          "Numeric identifier of the second electoral district (e.g. 5 means district five, not the quantity five).",
      },
    },
    required: ["district_a", "district_b"],
    additionalProperties: false,
  } as const satisfies JsonSchema,
  execute: async (input: Record<string, unknown>) => {
    const districtA = Number(input.district_a);
    const districtB = Number(input.district_b);
    const votesA = DISTRICT_POPULAR_VOTES[districtA] ?? 0;
    const votesB = DISTRICT_POPULAR_VOTES[districtB] ?? 0;
    return { result: votesA + votesB };
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

    // ====================================================================
    // AgentTask — full agent loop with function tool
    // ====================================================================

    describe("AgentTask", () => {
      it.skipIf(!setup.toolCallingModel)(
        "should complete an single toolcall agent loop with a function tool",
        async () => {
          const output = await agent({
            model: setup.toolCallingModel!,
            prompt:
              "What is the combined popular vote count for electoral districts 3 and 5? Use the get_district_popular_votes tool to look it up.",
            tools: [getDistrictPopularVotesTool],
            maxIterations: 3,
            maxTokens: setup.maxTokens,
          });

          getLogger().debug("AgentTask result", output);

          expect(output).toBeDefined();
          expect(output.iterations).toBeGreaterThanOrEqual(1);
          expect(output.toolCallCount).toEqual(1);
          const toolCall = output.messages
            .find((m) => m.role === "assistant")
            ?.content.filter((c) => c.type === "tool_use")?.[0];

          expect(toolCall).toBeDefined();
          expect(toolCall?.id).toBeDefined();
          expect(toolCall?.name).toBe("get_district_popular_votes");
          expect(toolCall?.input).toBeDefined();
          expect(toolCall?.input.district_a).toBe(3);
          expect(toolCall?.input.district_b).toBe(5);
        },
        setup.timeout
      );

      it.skipIf(!setup.agentModel)(
        "should extract structured output via stop tool",
        async () => {
          const output = await agent({
            model: setup.agentModel!,
            prompt:
              "First look up the combined popular votes for electoral districts 3 and 5 using the get_district_popular_votes tool. Wait for the tool call result in another turn, then call the finish tool with that combined vote total in a field called 'answer'.",
            tools: [getDistrictPopularVotesTool, finishTool],
            stopTool: "finish",
            maxIterations: 5,
            maxTokens: setup.maxTokens,
          });

          getLogger().debug("AgentTask result", output);

          expect(output).toBeDefined();
          const toolCalls = output.messages
            .filter((m) => m.role === "assistant")
            .flatMap((m) => m.content)
            .filter((c) => c.type === "tool_use");

          expect(toolCalls).toBeDefined();
          expect(toolCalls?.[0].id).toBeDefined();
          expect(toolCalls?.[0].name).toBe("get_district_popular_votes");
          expect(toolCalls?.[0].input).toBeDefined();
          expect(toolCalls?.[0].input.district_a).toBe(3);
          expect(toolCalls?.[0].input.district_b).toBe(5);
          expect(toolCalls?.[1].id).toBeDefined();
          expect(toolCalls?.[1].name).toBe("finish");
          expect(toolCalls?.[1].input).toBeDefined();
          expect(toolCalls?.[1].input.answer).toBe(160);

          expect(output.iterations).toEqual(2);
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
