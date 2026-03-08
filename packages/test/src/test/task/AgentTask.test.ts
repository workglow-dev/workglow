/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AgentTask,
  assistantMessage,
  audioBlock,
  audioBlockFromDataUri,
  imageBlock,
  imageBlockFromDataUri,
  toolMessage,
  userMessage,
} from "@workglow/ai";
import type { ChatMessage } from "@workglow/ai";
import { describe, expect, test } from "vitest";

// ========================================================================
// trimMessages — exposed via the private method, tested indirectly
// ========================================================================

// Access trimMessages via prototype to test it directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trimMessages = (AgentTask.prototype as any).trimMessages.bind(
  new AgentTask({} as any, {})
) as (msgs: ReadonlyArray<ChatMessage>, max: number | undefined) => ReadonlyArray<ChatMessage>;

describe("AgentTask.trimMessages", () => {
  const initialUser = userMessage("Start");
  const assist1 = assistantMessage("Response 1", {
    tc_1: { id: "tc_1", name: "tool", input: {} },
  });
  const tool1 = toolMessage([
    { toolCallId: "tc_1", toolName: "tool", output: { done: true }, isError: false },
  ]);
  const user2 = userMessage("Follow up");
  const assist2 = assistantMessage("Response 2");

  const allMessages: ChatMessage[] = [initialUser, assist1, tool1, user2, assist2];

  test("should return all messages when under limit", () => {
    const result = trimMessages(allMessages, 10);
    expect(result).toHaveLength(5);
    expect(result).toEqual(allMessages);
  });

  test("should return all messages when maxContextMessages is undefined", () => {
    const result = trimMessages(allMessages, undefined);
    expect(result).toEqual(allMessages);
  });

  test("should always keep the first message (initial user prompt)", () => {
    const result = trimMessages(allMessages, 3);
    expect(result[0]).toBe(initialUser);
  });

  test("should trim to maxContextMessages keeping recent messages", () => {
    const result = trimMessages(allMessages, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(initialUser);
    // Should keep the 2 most recent from the tail
    expect(result[result.length - 1]).toBe(assist2);
  });

  test("should not split assistant+tool pair when cut lands on tool", () => {
    // With 5 messages and max 4:
    // tail = [assist1, tool1, user2, assist2]
    // startIdx = 4 - (4-1) = 1 → tail[1] = tool1 → back up to include assist1
    const result = trimMessages(allMessages, 4);
    expect(result).toHaveLength(5); // includes initial + all 4 tail items
  });

  test("should handle exactly maxContextMessages", () => {
    const result = trimMessages(allMessages, 5);
    expect(result).toHaveLength(5);
    expect(result).toEqual(allMessages);
  });

  test("should handle single message", () => {
    const result = trimMessages([initialUser], 5);
    expect(result).toHaveLength(1);
  });
});

// ========================================================================
// AgentTask static properties
// ========================================================================

// ========================================================================
// Content block factory functions
// ========================================================================

describe("Content block factories", () => {
  test("imageBlock should create an ImageContentBlock", () => {
    const block = imageBlock("image/png", "base64data");
    expect(block).toEqual({ type: "image", mimeType: "image/png", data: "base64data" });
  });

  test("audioBlock should create an AudioContentBlock", () => {
    const block = audioBlock("audio/wav", "audiodata");
    expect(block).toEqual({ type: "audio", mimeType: "audio/wav", data: "audiodata" });
  });

  test("imageBlockFromDataUri should parse data URI", () => {
    const block = imageBlockFromDataUri("data:image/jpeg;base64,/9j/4AAQ");
    expect(block.type).toBe("image");
    expect(block.mimeType).toBe("image/jpeg");
    expect(block.data).toBe("/9j/4AAQ");
  });

  test("audioBlockFromDataUri should parse data URI", () => {
    const block = audioBlockFromDataUri("data:audio/mp3;base64,AAAA");
    expect(block.type).toBe("audio");
    expect(block.mimeType).toBe("audio/mp3");
    expect(block.data).toBe("AAAA");
  });

  test("userMessage should accept string content", () => {
    const msg = userMessage("Hello");
    expect(msg).toEqual({ role: "user", content: "Hello" });
  });

  test("userMessage should accept array of content blocks", () => {
    const blocks = [
      { type: "text" as const, text: "What is this?" },
      imageBlock("image/png", "data"),
    ];
    const msg = userMessage(blocks);
    expect(msg.role).toBe("user");
    expect(Array.isArray(msg.content)).toBe(true);
    expect((msg.content as any[])).toHaveLength(2);
  });
});

// ========================================================================
// AgentTask static properties
// ========================================================================

describe("AgentTask static properties", () => {
  test("should have correct type", () => {
    expect(AgentTask.type).toBe("AgentTask");
  });

  test("should have correct category", () => {
    expect(AgentTask.category).toBe("AI Agent");
  });

  test("should not be cacheable", () => {
    expect(AgentTask.cacheable).toBe(false);
  });

  test("should have input schema with required model and prompt", () => {
    const schema = AgentTask.inputSchema();
    expect(schema.required).toContain("model");
    expect(schema.required).toContain("prompt");
  });

  test("should have output schema with required fields", () => {
    const schema = AgentTask.outputSchema();
    expect(schema.required).toContain("text");
    expect(schema.required).toContain("messages");
    expect(schema.required).toContain("iterations");
    expect(schema.required).toContain("toolCallCount");
  });
});
