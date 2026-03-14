/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createGraphFromGraphJSON, type TaskGraphJson } from "@workglow/task-graph";
import type { Command } from "commander";
import { loadConfig } from "../config";
import { StatusDisplay } from "../status";
import { createAgentRepository } from "../storage";
import { formatTable, readInput, readStdin, writeOutput } from "../util";

export function registerAgentCommand(program: Command): void {
  const agent = program.command("agent").description("Manage and run agents");

  agent
    .command("list")
    .description("List all saved agents")
    .action(async () => {
      const config = await loadConfig();
      const repo = createAgentRepository(config);
      await repo.setupDatabase();

      const all = await repo.tabularRepository.getAll();
      if (!all || all.length === 0) {
        console.log("No agents found.");
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

  agent
    .command("add")
    .argument("<id>", "agent identifier")
    .description("Add an agent from stdin JSON")
    .action(async (id: string) => {
      const config = await loadConfig();
      const repo = createAgentRepository(config);
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

      const graph = createGraphFromGraphJSON(graphJson);
      await repo.saveTaskGraph(id, graph);
      console.log(`Agent "${id}" saved.`);
    });

  agent
    .command("remove")
    .argument("<id>", "agent identifier to remove")
    .description("Remove an agent by ID")
    .action(async (id: string) => {
      const config = await loadConfig();
      const repo = createAgentRepository(config);
      await repo.setupDatabase();

      await repo.tabularRepository.delete({ key: id });
      console.log(`Agent "${id}" removed.`);
    });

  agent
    .command("run")
    .argument("<id>", "agent identifier to run")
    .option("--in <path>", "Read input JSON overrides from a file instead of stdin")
    .option("--out <path>", "Write output JSON to a file instead of stdout")
    .description("Run a saved agent")
    .action(async (id: string, opts: { in?: string; out?: string }) => {
      const config = await loadConfig();
      const repo = createAgentRepository(config);
      await repo.setupDatabase();

      const graph = await repo.getTaskGraph(id);
      if (!graph) {
        console.error(`Agent "${id}" not found.`);
        process.exit(1);
      }

      // Optional input overrides
      const raw = await readInput(opts.in);
      if (raw) {
        try {
          const overrides = JSON.parse(raw) as Record<string, unknown>;
          const tasks = graph.getTasks();
          for (const task of tasks) {
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
        console.error(`Agent failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
