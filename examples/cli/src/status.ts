/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskStatus } from "@workglow/task-graph";

/**
 * Tracked state for a single task in the status display.
 */
interface TaskEntry {
  readonly id: unknown;
  readonly label: string;
  status: TaskStatus;
  progress: number;
  message: string | undefined;
  /** Extra detail lines (e.g. per-file download progress) */
  details: Map<string, { progress: number }>;
}

const STATUS_ICON: Record<string, string> = {
  PENDING: " ",
  PROCESSING: "⠋",
  STREAMING: "⠋",
  COMPLETED: "✓",
  FAILED: "✗",
  ABORTING: "⠋",
  DISABLED: "-",
};

function progressBar(pct: number, width: number = 20): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

/**
 * Renders hierarchical status updates to stderr.
 *
 * Layout (single task):
 *   ✓ TextGenerationTask  100%  ██████████████████████████  Done
 *
 * Layout (graph with HFT download):
 *   ✓ EmbeddingTask        100%  ████████████████████████  Downloading model
 *     ├ model.onnx          100%  ████████████████████████
 *     └ tokenizer.json      100%  ████████████████████████
 *   ⠋ SummaryTask            0%  ░░░░░░░░░░░░░░░░░░░░░░░░
 */
export class StatusDisplay {
  private readonly tasks = new Map<string, TaskEntry>();
  private readonly taskOrder: string[] = [];
  private renderedLineCount = 0;
  private enabled: boolean;

  constructor(options?: { enabled?: boolean }) {
    this.enabled = options?.enabled ?? process.stderr.isTTY === true;
  }

  /**
   * Register a task to be tracked. Call before run() so the display knows about it.
   */
  addTask(id: unknown, label: string): void {
    const key = String(id);
    if (!this.tasks.has(key)) {
      this.tasks.set(key, {
        id,
        label,
        status: "PENDING",
        progress: 0,
        message: undefined,
        details: new Map(),
      });
      this.taskOrder.push(key);
    }
  }

  /**
   * Update the status for a tracked task.
   */
  updateStatus(id: unknown, status: TaskStatus): void {
    const entry = this.tasks.get(String(id));
    if (entry) {
      entry.status = status;
      this.render();
    }
  }

  /**
   * Update progress for a tracked task.
   * @param args - Extra arguments from the progress event. If the first arg has
   *   a `file` property, it is treated as a per-file download detail line.
   */
  updateProgress(
    id: unknown,
    progress: number,
    message: string | undefined,
    ...args: any[]
  ): void {
    const entry = this.tasks.get(String(id));
    if (!entry) return;

    entry.progress = progress;
    entry.message = message;

    // Handle per-file detail (e.g. HFT model downloads)
    const detail = args[0];
    if (detail && typeof detail === "object" && typeof detail.file === "string") {
      entry.details.set(detail.file, { progress: detail.progress ?? 0 });
    }

    this.render();
  }

  /**
   * Clear tracked state and the rendered block.
   */
  finish(): void {
    // One final render to show completed state
    this.render();

    if (!this.enabled) return;
    // Move to end — leave output visible
    if (this.renderedLineCount > 0) {
      process.stderr.write("\n");
    }
  }

  // ---------------------------------------------------------------- private

  private render(): void {
    if (!this.enabled) {
      this.renderPlain();
      return;
    }

    const lines = this.buildLines();
    const output = lines.join("\n");

    // Clear previously rendered lines
    if (this.renderedLineCount > 0) {
      // Move cursor up and clear each line
      process.stderr.write(`\x1b[${this.renderedLineCount}A\x1b[J`);
    }

    process.stderr.write(output);
    this.renderedLineCount = lines.length;
  }

  private buildLines(): string[] {
    const lines: string[] = [];

    for (const key of this.taskOrder) {
      const entry = this.tasks.get(key)!;
      const icon = STATUS_ICON[entry.status] ?? " ";
      const pct = String(Math.round(entry.progress)).padStart(3) + "%";
      const bar = progressBar(entry.progress);
      const label = truncate(entry.label, 28).padEnd(28);
      const msg = entry.message ? `  ${truncate(entry.message, 40)}` : "";

      lines.push(`  ${icon} ${label} ${pct}  ${bar}${msg}`);

      // Detail lines for multi-file progress
      if (entry.details.size > 0) {
        const detailEntries = [...entry.details.entries()];
        for (let i = 0; i < detailEntries.length; i++) {
          const [file, info] = detailEntries[i];
          const isLast = i === detailEntries.length - 1;
          const connector = isLast ? "└" : "├";
          const filePct = String(Math.round(info.progress)).padStart(3) + "%";
          const fileBar = progressBar(info.progress, 16);
          const fileName = truncate(file, 24).padEnd(24);
          lines.push(`    ${connector} ${fileName} ${filePct}  ${fileBar}`);
        }
      }
    }

    return lines;
  }

  /**
   * Non-TTY fallback: print one line per meaningful state change.
   */
  private lastPlainState = new Map<string, string>();

  private renderPlain(): void {
    for (const key of this.taskOrder) {
      const entry = this.tasks.get(key)!;
      const stateKey = `${entry.status}:${Math.round(entry.progress)}`;
      const prev = this.lastPlainState.get(key);

      // Only print on status transitions or significant progress milestones
      if (prev === stateKey) continue;

      const shouldPrint =
        prev === undefined ||
        entry.status === "COMPLETED" ||
        entry.status === "FAILED" ||
        !prev.startsWith(entry.status);

      if (shouldPrint) {
        const icon = STATUS_ICON[entry.status] ?? " ";
        const pct = String(Math.round(entry.progress)).padStart(3) + "%";
        const msg = entry.message ? `  ${entry.message}` : "";
        process.stderr.write(`${icon} ${entry.label}  ${pct}${msg}\n`);
      }

      this.lastPlainState.set(key, stateKey);
    }
  }
}
