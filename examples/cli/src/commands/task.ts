/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import type { Command } from "commander";
import { formatTable, readStdin } from "../util";

export function registerTaskCommand(program: Command): void {
  const task = program.command("task").description("List and run tasks");

  task
    .command("list")
    .description("List all registered task types")
    .action(async () => {
      const rows: Record<string, string>[] = [];
      for (const [, ctor] of TaskRegistry.all) {
        rows.push({
          type: ctor.type,
          category: (ctor as { category?: string }).category ?? "",
          title: (ctor as { title?: string }).title ?? "",
          description: (ctor as { description?: string }).description ?? "",
        });
      }

      if (rows.length === 0) {
        console.log("No tasks registered.");
        return;
      }

      rows.sort((a, b) => (a.category + a.type).localeCompare(b.category + b.type));
      console.log(formatTable(rows, ["type", "category", "title", "description"]));
    });

  task
    .command("run")
    .description("Run a task from stdin JSON { type, input, config }")
    .action(async () => {
      const raw = await readStdin();
      if (!raw) {
        console.error("No input provided. Pipe JSON to stdin: { type, input, config }");
        process.exit(1);
      }

      let parsed: { type: string; input?: Record<string, unknown>; config?: Record<string, unknown> };
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.error("Invalid JSON input.");
        process.exit(1);
      }

      if (!parsed.type) {
        console.error('JSON must include a "type" field.');
        process.exit(1);
      }

      const Ctor = TaskRegistry.all.get(parsed.type);
      if (!Ctor) {
        console.error(`Unknown task type "${parsed.type}".`);
        process.exit(1);
      }

      const instance = new Ctor(parsed.input ?? {}, parsed.config ?? {});
      const result = await instance.run();
      console.log(JSON.stringify(result, null, 2));
    });
}
