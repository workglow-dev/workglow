/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createGraphFromGraphJSON, type TaskGraphJson } from "@workglow/task-graph";
import type { Command } from "commander";
import { loadConfig } from "../config";
import { StatusDisplay } from "../status";
import { createWorkflowRepository } from "../storage";
import { formatTable, readInput, readStdin, writeOutput } from "../util";

export function registerWorkflowCommand(program: Command): void {
  const workflow = program.command("workflow").description("Manage and run workflows");

  workflow
    .command("list")
    .description("List all saved workflows")
    .action(async () => {
      const config = await loadConfig();
      const repo = createWorkflowRepository(config);
      await repo.setupDatabase();

      const all = await repo.tabularRepository.getAll();
      if (!all || all.length === 0) {
        console.log("No workflows found.");
        return;
      }

      const rows = all.map((entry) => {
        let taskCount = "";
        try {
          const parsed = JSON.parse(entry.value as string) as TaskGraphJson;
          taskCount = String(parsed.tasks?.length ?? 0);
        } catch {
          taskCount = "?";
        }
        return {
          key: entry.key as string,
          tasks: taskCount,
        };
      });

      console.log(formatTable(rows, ["key", "tasks"]));
    });

  workflow
    .command("add")
    .argument("<id>", "workflow identifier")
    .description("Add a workflow from stdin JSON")
    .action(async (id: string) => {
      const config = await loadConfig();
      const repo = createWorkflowRepository(config);
      await repo.setupDatabase();

      const raw = await readStdin();
      if (!raw) {
        console.error("No input provided. Pipe a TaskGraphJson to stdin.");
        process.exit(1);
      }

      let graphJson: TaskGraphJson;
      try {
        graphJson = JSON.parse(raw);
      } catch {
        console.error("Invalid JSON input.");
        process.exit(1);
      }

      // Validate by attempting deserialization
      const graph = createGraphFromGraphJSON(graphJson);
      await repo.saveTaskGraph(id, graph);
      console.log(`Workflow "${id}" saved.`);
    });

  workflow
    .command("remove")
    .argument("<id>", "workflow identifier to remove")
    .description("Remove a workflow by ID")
    .action(async (id: string) => {
      const config = await loadConfig();
      const repo = createWorkflowRepository(config);
      await repo.setupDatabase();

      await repo.tabularRepository.delete({ key: id });
      console.log(`Workflow "${id}" removed.`);
    });

  workflow
    .command("run")
    .argument("<id>", "workflow identifier to run")
    .option("--in <path>", "Read input JSON overrides from a file instead of stdin")
    .option("--out <path>", "Write output JSON to a file instead of stdout")
    .description("Run a saved workflow")
    .action(async (id: string, opts: { in?: string; out?: string }) => {
      const config = await loadConfig();
      const repo = createWorkflowRepository(config);
      await repo.setupDatabase();

      const graph = await repo.getTaskGraph(id);
      if (!graph) {
        console.error(`Workflow "${id}" not found.`);
        process.exit(1);
      }

      // Optional input overrides
      const raw = await readInput(opts.in);
      if (raw) {
        try {
          const overrides = JSON.parse(raw) as Record<string, unknown>;
          const tasks = graph.getTasks();
          for (const task of tasks) {
            // Apply overrides to input tasks (tasks with no incoming dataflows)
            const sources = graph.getSourceDataflows(task.id as any);
            if (sources.length === 0 && overrides) {
              Object.assign(task.defaults, overrides);
            }
          }
        } catch {
          console.error("Invalid JSON input for overrides.");
          process.exit(1);
        }
      }

      // Set up status display
      const display = new StatusDisplay();
      const tasks = graph.getTasks();
      for (const task of tasks) {
        display.addTask(task.id, task.title || task.type);
      }

      graph.subscribeToTaskStatus((taskId, status) => {
        display.updateStatus(taskId, status);
      });
      graph.subscribeToTaskProgress((taskId, progress, message, ...args) => {
        display.updateProgress(taskId, progress, message, ...args);
      });

      try {
        const result = await graph.run();
        display.finish();
        await writeOutput(JSON.stringify(result, null, 2), opts.out);
      } catch (err) {
        display.finish();
        console.error(`Workflow failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
