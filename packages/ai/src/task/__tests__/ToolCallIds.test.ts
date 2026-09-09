/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChatMessage, ToolCall } from "@workglow/ai";
import { collectToolUseIds, repairDuplicateToolCallIds, uniquifyToolCallIds } from "@workglow/ai";
import { describe, expect, it } from "vitest";

const call = (id: string, name = "search"): ToolCall => ({ id, name, input: {} });

const assistantCalls = (...ids: string[]): ChatMessage => ({
  role: "assistant",
  content: ids.map((id) => ({ type: "tool_use", id, name: "search", input: {} })),
});
const toolResults = (...ids: string[]): ChatMessage => ({
  role: "tool",
  content: ids.map((id) => ({
    type: "tool_result",
    tool_use_id: id,
    content: [{ type: "text", text: "ok" }],
    is_error: undefined,
  })),
});

describe("collectToolUseIds", () => {
  it("gathers ids from assistant turns only", () => {
    const history = [assistantCalls("call_0", "call_1"), toolResults("call_0", "call_1")];
    expect([...collectToolUseIds(history)].sort()).toEqual(["call_0", "call_1"]);
  });

  it("is empty for a history with no tool calls", () => {
    expect(
      collectToolUseIds([{ role: "user", content: [{ type: "text", text: "hi" }] }]).size
    ).toBe(0);
  });
});

describe("uniquifyToolCallIds", () => {
  it("renames a call whose id the conversation already used", () => {
    // Gemini restarts at call_0 every run, so round two collides with round one.
    const out = uniquifyToolCallIds([call("call_0")], ["call_0"]);
    expect(out[0]!.id).toBe("call_0_2");
  });

  it("keeps going past an already-taken rename", () => {
    const out = uniquifyToolCallIds([call("call_0")], ["call_0", "call_0_2"]);
    expect(out[0]!.id).toBe("call_0_3");
  });

  it("deduplicates within a single batch", () => {
    const out = uniquifyToolCallIds([call("x"), call("x")]);
    expect(out.map((c) => c.id)).toEqual(["x", "x_2"]);
  });

  it("leaves non-colliding ids alone and preserves the rest of the call", () => {
    const original = { id: "a", name: "fetch", input: { url: "u" }, providerSignature: "sig" };
    const out = uniquifyToolCallIds([original], ["b"]);
    expect(out[0]).toEqual(original);
  });

  it("does not mutate the caller's seen set", () => {
    const seen = new Set(["call_0"]);
    uniquifyToolCallIds([call("call_0")], seen);
    expect([...seen]).toEqual(["call_0"]);
  });
});

describe("repairDuplicateToolCallIds", () => {
  it("renames the k-th occurrence on both sides so pairs stay together", () => {
    const history = [
      assistantCalls("call_0"),
      toolResults("call_0"),
      assistantCalls("call_0"),
      toolResults("call_0"),
    ];
    const out = repairDuplicateToolCallIds(history);
    const uses = out.flatMap((m) =>
      m.role === "assistant"
        ? m.content.filter((b) => b.type === "tool_use").map((b: any) => b.id)
        : []
    );
    const results = out.flatMap((m) =>
      m.role === "tool"
        ? m.content.filter((b) => b.type === "tool_result").map((b: any) => b.tool_use_id)
        : []
    );
    expect(uses).toEqual(["call_0", "call_0_2"]);
    expect(results).toEqual(["call_0", "call_0_2"]);
  });

  it("keeps a result on its own call when an earlier call was never answered", () => {
    // An interrupted round leaves a `tool_use` with no `tool_result`. Counting
    // the two sides independently would rename the surviving result onto the
    // abandoned call, silently re-answering the wrong one.
    const history = [
      assistantCalls("call_0"),
      assistantCalls("call_0"),
      toolResults("call_0"),
      assistantCalls("call_0"),
      toolResults("call_0"),
    ];
    const out = repairDuplicateToolCallIds(history);
    const results = out.flatMap((m) =>
      m.role === "tool"
        ? m.content.filter((b) => b.type === "tool_result").map((b: any) => b.tool_use_id)
        : []
    );
    // The first call is the unanswered one, so the two results belong to the
    // second and third.
    expect(results).toEqual(["call_0_2", "call_0_3"]);
  });

  it("keeps a stray extra result off the first round's call", () => {
    // A second result for one call is a history nothing normal produces, but
    // falling back to the raw id would attach it to the FIRST `call_0` — the
    // one occurrence 1 left unrenamed — silently re-answering a round that was
    // already answered rounds ago.
    const history = [
      assistantCalls("call_0"),
      toolResults("call_0"),
      assistantCalls("call_0"),
      toolResults("call_0"),
      toolResults("call_0"),
    ];
    const out = repairDuplicateToolCallIds(history);
    const results = out.flatMap((m) =>
      m.role === "tool"
        ? m.content.filter((b) => b.type === "tool_result").map((b: any) => b.tool_use_id)
        : []
    );
    expect(results).toEqual(["call_0", "call_0_2", "call_0_2"]);
  });

  it("leaves an already-unique history unchanged", () => {
    const history = [assistantCalls("a", "b"), toolResults("a", "b")];
    expect(repairDuplicateToolCallIds(history)).toEqual(history);
  });

  it("does not mutate its input", () => {
    const history = [assistantCalls("call_0"), assistantCalls("call_0")];
    const before = JSON.stringify(history);
    repairDuplicateToolCallIds(history);
    expect(JSON.stringify(history)).toBe(before);
  });
});
