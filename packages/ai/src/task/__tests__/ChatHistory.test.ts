/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChatMessage } from "@workglow/ai";
import {
  DEFAULT_MAX_HISTORY_CHARS,
  normalizeHistoryForModel,
  trimHistoryForModel,
} from "@workglow/ai";
import { describe, expect, it } from "vitest";

const user = (text: string): ChatMessage => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (text: string): ChatMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
});
const toolResult = (id: string): ChatMessage => ({
  role: "tool",
  content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: "ok" }] }],
});

describe("normalizeHistoryForModel", () => {
  it("merges consecutive user messages, keeping both texts", () => {
    // A turn stopped while the model was thinking leaves a trailing `user`;
    // the next thing typed makes `user, user`, which strict templates reject.
    const out = normalizeHistoryForModel([user("first"), user("second")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ role: "user", content: [{ type: "text", text: "first\n\nsecond" }] });
  });

  it("does not introduce a blank line when one side is empty", () => {
    const out = normalizeHistoryForModel([user(""), user("only")]);
    expect(out[0]!.content).toEqual([{ type: "text", text: "only" }]);
  });

  it("bridges a tool result followed by a user message", () => {
    const out = normalizeHistoryForModel([user("q"), toolResult("t1"), user("next")]);
    expect(out.map((m) => m.role)).toEqual(["user", "tool", "assistant", "user"]);
  });

  it("leaves an already-alternating history untouched", () => {
    const history = [user("a"), assistant("b"), user("c")];
    expect(normalizeHistoryForModel(history)).toEqual(history);
  });

  it("returns a copy rather than mutating its input", () => {
    const history = [user("a"), user("b")];
    const before = JSON.stringify(history);
    normalizeHistoryForModel(history);
    expect(JSON.stringify(history)).toBe(before);
  });
});

describe("trimHistoryForModel", () => {
  it("returns everything when the history fits", () => {
    const history = [user("a"), assistant("b")];
    expect(trimHistoryForModel(history)).toEqual(history);
  });

  it("cuts only at a user message, so no tool_result outlives its tool_use", () => {
    const history = [
      user("turn one"),
      assistant("thinking"),
      toolResult("t1"),
      assistant("answer one"),
      user("turn two"),
      assistant("answer two"),
    ];
    const trimmed = trimHistoryForModel(history, 120);
    expect(trimmed[0]!.role).toBe("user");
    // Whatever survived, a tool message never leads the result.
    expect(trimmed.some((m, i) => m.role === "tool" && i === 0)).toBe(false);
  });

  it("keeps the newest turn even when it alone exceeds the budget", () => {
    // Discarding here is how a conversation gets erased for being too long.
    const history = [user("old"), assistant("old reply"), user("x".repeat(5000))];
    const trimmed = trimHistoryForModel(history, 10);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]!.role).toBe("user");
  });

  it("drops whole leading turns until the budget is met", () => {
    const history = [
      user("a".repeat(400)),
      assistant("x"),
      user("b".repeat(400)),
      assistant("y"),
      user("c"),
    ];
    const trimmed = trimHistoryForModel(history, 500);
    expect(trimmed.length).toBeLessThan(history.length);
    expect(trimmed[0]!.role).toBe("user");
  });

  it("exposes a default budget callers can reason about", () => {
    expect(DEFAULT_MAX_HISTORY_CHARS).toBeGreaterThan(0);
  });
});
