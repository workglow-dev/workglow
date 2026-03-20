/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskGraph } from "@workglow/task-graph";
import type { Dispatch, SetStateAction } from "react";
import type { CliTaskLine } from "./taskGraphCliSubscriptions";

/** Single-character status column: done → active (spinner in UI) → waiting → error. */
export function cliTaskStatusGlyph(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "\u2713"; // ✓
    case "PROCESSING":
    case "STREAMING":
    case "ABORTING":
      return "\u00A0"; // non-breaking space — TaskStatusLine uses CliSpinner instead
    case "PENDING":
      return "\u25CB"; // ○
    case "FAILED":
    case "ABORTED":
      return "\u2717"; // ✗
    case "DISABLED":
      return "\u2298"; // ⊘
    default:
      return "\u2022"; // •
  }
}

export function cliTaskStatusGlyphColor(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "green";
    case "PROCESSING":
    case "STREAMING":
    case "ABORTING":
      return "yellow";
    case "PENDING":
      return "gray";
    case "FAILED":
    case "ABORTED":
      return "red";
    case "DISABLED":
      return "gray";
    default:
      return "white";
  }
}

/**
 * Sort key: completed (0), then processing-like (1), then pending (2), then failures, etc.
 * Secondary: graph order index.
 */
export function cliTaskStatusSortOrder(status: string): number {
  if (status === "COMPLETED") return 0;
  if (status === "PROCESSING" || status === "STREAMING" || status === "ABORTING") return 1;
  if (status === "PENDING") return 2;
  if (status === "FAILED" || status === "ABORTED") return 3;
  if (status === "DISABLED") return 4;
  return 5;
}

export function sortCliTaskLinesForDisplay(
  tasks: readonly CliTaskLine[],
  graphOrder: ReadonlyMap<string, number>
): CliTaskLine[] {
  return [...tasks].sort((a, b) => {
    const ta = cliTaskStatusSortOrder(a.status);
    const tb = cliTaskStatusSortOrder(b.status);
    if (ta !== tb) return ta - tb;
    return (graphOrder.get(a.id) ?? 999) - (graphOrder.get(b.id) ?? 999);
  });
}

/** When to draw a numeric progress bar (not just status text). */
export function cliTaskShowsProgressBar(status: string): boolean {
  return status === "PROCESSING" || status === "STREAMING" || status === "ABORTING";
}

/**
 * Polls `task.status` / `task.progress` on the runner-owned instance — `emit("progress")` can lag
 * behind mutations, and STREAMING tasks need frequent UI updates.
 */
export function startTaskInstancePoll(
  getTask: () => { status?: string; progress?: number } | undefined,
  setStatus: Dispatch<SetStateAction<string>>,
  setProgress: Dispatch<SetStateAction<number | undefined>>
): () => void {
  const id = setInterval(() => {
    const t = getTask();
    if (!t) return;
    if (t.status !== undefined) setStatus(t.status);
    if (typeof t.progress === "number") setProgress(t.progress);
  }, 100);
  return () => clearInterval(id);
}

/**
 * Same idea as {@link startTaskInstancePoll} but for every node in a {@link TaskGraph}.
 */
export function startGraphTaskPoll(
  graph: TaskGraph,
  setTaskInfos: Dispatch<SetStateAction<Map<string, CliTaskLine>>>
): () => void {
  const id = setInterval(() => {
    setTaskInfos((prev) => {
      let next: Map<string, CliTaskLine> | undefined;
      for (const task of graph.getTasks()) {
        const taskId = String(task.id);
        const info = prev.get(taskId);
        if (!info) continue;
        const st = task.status;
        const prog = task.progress;
        if (info.status !== st || info.progress !== prog) {
          if (!next) next = new Map(prev);
          next.set(taskId, { ...info, status: st, progress: prog });
        }
      }
      return next ?? prev;
    });
  }, 100);
  return () => clearInterval(id);
}
