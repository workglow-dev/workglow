/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChatMessage, ContentBlock } from "@workglow/ai";
import type { ITask, StreamEvent } from "@workglow/task-graph";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import { TaskStatusProgressRow } from "../components/TaskStatusProgressRow";
import type { TaskRowProps } from "./pickRenderer";

const HISTORY_TAIL = 6;

function roleColor(role: ChatMessage["role"]): string | undefined {
  switch (role) {
    case "system":
      return undefined; // dim
    case "user":
      return "cyan";
    case "assistant":
      return "magenta";
    default:
      return "yellow";
  }
}

function blockToText(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "image":
      return "[image]";
    case "tool_use":
      return `[tool_use: ${block.name}]`;
    case "tool_result":
      return "[tool_result]";
  }
}

function messageText(message: ChatMessage): string {
  return (message.content as ReadonlyArray<ContentBlock>).map(blockToText).join("");
}

function messagesFromTask(task: ITask): ReadonlyArray<ChatMessage> {
  return (task.runOutputData.messages as ReadonlyArray<ChatMessage> | undefined) ?? [];
}

export function ChatTaskRow({ task, line }: TaskRowProps): React.ReactElement {
  // Seed from runOutputData so we don't miss deltas that fired before
  // the effect below attached. TaskRunner updates runOutputData after
  // every object-delta so the current history is always recoverable.
  const [messages, setMessages] = useState<ReadonlyArray<ChatMessage>>(() =>
    messagesFromTask(task)
  );
  // `streamText` is the in-progress assistant text for the *current* turn.
  // Appends on every text-delta; resets whenever history grows (meaning the
  // previous turn's assistant message just landed, or a new user turn has
  // started), and on stream_end.
  const [streamText, setStreamText] = useState("");

  useEffect(() => {
    const onChunk = (event: StreamEvent): void => {
      if (event.type === "text-delta") {
        const delta = (event as { textDelta?: string; text?: string }).textDelta ?? "";
        if (delta) setStreamText((prev) => prev + delta);
      } else if (event.type === "object-delta" && event.port === "messages") {
        // `event.objectDelta` is only the *new* messages, not the full
        // history. Pull the authoritative accumulated state from the task
        // instead — TaskRunner updates runOutputData before emitting.
        setMessages(messagesFromTask(task));
        // Each object-delta marks a turn boundary — clear the per-turn
        // streaming buffer so the next turn's text-deltas start fresh.
        setStreamText("");
      }
    };
    const onEnd = (): void => setStreamText("");
    task.events.on("stream_chunk", onChunk);
    task.events.on("stream_end", onEnd);
    // Re-sync from runOutputData once the listener is attached — in case an
    // object-delta fired between `useState` evaluation and listener attach.
    const latest = messagesFromTask(task);
    if (latest.length > 0) setMessages(latest);
    return () => {
      task.events.off("stream_chunk", onChunk);
      task.events.off("stream_end", onEnd);
    };
  }, [task]);

  const status = line.status;

  if (status === "PENDING") {
    return (
      <TaskStatusProgressRow
        type={line.type}
        status={status}
        message={line.message}
        barProgress={0}
      />
    );
  }

  if (status === "COMPLETED") {
    return (
      <TaskStatusProgressRow
        type={line.type}
        status={status}
        message={`${messages.length} messages`}
        barProgress={100}
      />
    );
  }

  if (status === "FAILED") {
    return (
      <TaskStatusProgressRow
        type={line.type}
        status={status}
        message={line.message ?? "failed"}
        barProgress={line.progress ?? 0}
      />
    );
  }

  // PROCESSING
  const tail = messages.slice(Math.max(0, messages.length - HISTORY_TAIL));
  const showStreamingBubble = streamText.length > 0;

  return (
    <Box flexDirection="column">
      <TaskStatusProgressRow
        type={line.type}
        status={status}
        message={line.message}
        barProgress={line.progress ?? 0}
      />
      <Box
        flexDirection="column"
        marginLeft={2}
        borderStyle="round"
        borderColor="magenta"
        paddingX={1}
      >
        {tail.map((m, i) => (
          <Box key={i} flexDirection="row">
            <Text color={roleColor(m.role)} bold>
              {m.role}:{" "}
            </Text>
            <Text color={roleColor(m.role)}>{messageText(m)}</Text>
          </Box>
        ))}
        {showStreamingBubble && (
          <Box flexDirection="row">
            <Text color="magenta" bold>
              assistant:{" "}
            </Text>
            <Text dimColor>{streamText}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
