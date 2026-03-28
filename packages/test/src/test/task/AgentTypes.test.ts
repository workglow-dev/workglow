/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  assistantMessage,
  findToolSource,
  toolMessage,
  toolSourceDefinitions,
  userMessage,
} from "@workglow/ai";
import type { ToolResult, ToolSource } from "@workglow/ai";
import { describe, expect, test } from "vitest";

// ========================================================================
// Message helpers
// ========================================================================

describe("userMessage", () => {
  test("should create a user message", () => {
    const msg = userMessage("Hello");
    expect(msg).toEqual({ role: "user", content: "Hello" });
  });
});

describe("assistantMessage", () => {
  test("should create assistant message with text only", () => {
    const msg = assistantMessage("Sure, I can help.");
    expect(msg.role).toBe("assistant");
    expect(msg.content).toEqual([{ type: "text", text: "Sure, I can help." }]);
  });

  test("should create assistant message with text and tool calls", () => {
    const msg = assistantMessage("Calling tool", [
      { id: "tc_1", name: "search", input: { q: "test" } },
    ]);
    expect(msg.role).toBe("assistant");
    expect(msg.content).toHaveLength(2);
    expect(msg.content[0]).toEqual({ type: "text", text: "Calling tool" });
    expect(msg.content[1]).toEqual({
      type: "tool_use",
      id: "tc_1",
      name: "search",
      input: { q: "test" },
    });
  });

  test("should omit text block when text is empty", () => {
    const msg = assistantMessage("", [{ id: "tc_1", name: "search", input: {} }]);
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]).toEqual({
      type: "tool_use",
      id: "tc_1",
      name: "search",
      input: {},
    });
  });

  test("should include multiple tool calls", () => {
    const msg = assistantMessage("", [
      { id: "tc_1", name: "a", input: {} },
      { id: "tc_2", name: "b", input: { x: 1 } },
    ]);
    expect(msg.content).toHaveLength(2);
  });
});

describe("toolMessage", () => {
  test("should create tool message from results", () => {
    const results: ToolResult[] = [
      { toolCallId: "tc_1", toolName: "search", output: { found: true }, isError: false },
    ];
    const msg = toolMessage(results);

    expect(msg.role).toBe("tool");
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "tc_1",
      content: JSON.stringify({ found: true }),
      is_error: undefined,
    });
  });

  test("should set is_error for error results", () => {
    const results: ToolResult[] = [
      { toolCallId: "tc_1", toolName: "broken", output: { error: "oops" }, isError: true },
    ];
    const msg = toolMessage(results);

    expect(msg.role).toBe("tool");
    if (msg.role === "tool") {
      expect(msg.content[0].is_error).toBe(true);
    }
  });

  test("should handle multiple results", () => {
    const results: ToolResult[] = [
      { toolCallId: "tc_1", toolName: "a", output: {}, isError: false },
      { toolCallId: "tc_2", toolName: "b", output: {}, isError: false },
    ];
    const msg = toolMessage(results);

    expect(msg.role).toBe("tool");
    if (msg.role === "tool") {
      expect(msg.content).toHaveLength(2);
      expect(msg.content[0].tool_use_id).toBe("tc_1");
      expect(msg.content[1].tool_use_id).toBe("tc_2");
    }
  });
});

// ========================================================================
// Tool source helpers
// ========================================================================

const testSources: ToolSource[] = [
  {
    type: "function",
    definition: { name: "alpha", description: "Alpha", inputSchema: { type: "object" } },
    run: async () => ({}),
  },
  {
    type: "function",
    definition: { name: "beta", description: "Beta", inputSchema: { type: "object" } },
    run: async () => ({}),
  },
];

describe("toolSourceDefinitions", () => {
  test("should extract definitions from sources", () => {
    const defs = toolSourceDefinitions(testSources);
    expect(defs).toHaveLength(2);
    expect(defs[0].name).toBe("alpha");
    expect(defs[1].name).toBe("beta");
  });

  test("should return empty for empty sources", () => {
    expect(toolSourceDefinitions([])).toHaveLength(0);
  });
});

describe("findToolSource", () => {
  test("should find matching source by name", () => {
    const source = findToolSource(testSources, "beta");
    expect(source).toBeDefined();
    expect(source!.definition.name).toBe("beta");
  });

  test("should return undefined for unknown name", () => {
    expect(findToolSource(testSources, "gamma")).toBeUndefined();
  });
});
