/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask, StreamEvent } from "@workglow/task-graph";
import { useEffect, useState } from "react";

/**
 * Subscribes to `stream_chunk` text-delta events on a task and returns the
 * accumulated text. Clears on `stream_end` or when the task status transitions
 * to COMPLETED.
 */
export function useTaskStreamText(task: ITask): string {
  const [text, setText] = useState("");

  useEffect(() => {
    const onChunk = (event: StreamEvent): void => {
      if (event.type !== "text-delta") return;
      const delta = event.textDelta ?? "";
      if (!delta) return;
      setText((prev) => prev + delta);
    };
    const onEnd = (): void => {
      setText("");
    };
    const onStatus = (status: string): void => {
      if (status === "COMPLETED") setText("");
    };

    task.events.on("stream_chunk", onChunk);
    task.events.on("stream_end", onEnd);
    task.events.on("status", onStatus);

    return () => {
      task.events.off("stream_chunk", onChunk);
      task.events.off("stream_end", onEnd);
      task.events.off("status", onStatus);
    };
  }, [task]);

  return text;
}
