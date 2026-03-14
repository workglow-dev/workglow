/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createGraphFromGraphJSON, type TaskGraphJson } from "@workglow/task-graph";
import type { Command } from "commander";
import { loadConfig } from "../config";
import { createAgentRepository } from "../storage";
import { formatTable, readStdin } from "../util";

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
    .description("Run a saved agent")
    .action(async (id: string) => {
      const config = await loadConfig();
      const repo = createAgentRepository(config);
      await repo.setupDatabase();

      const graph = await repo.getTaskGraph(id);
      if (!graph) {
        console.error(`Agent "${id}" not found.`);
        process.exit(1);
      }

      const result = await graph.run();
      console.log(JSON.stringify(result, null, 2));
    });
}
