/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { computeGraphInputSchema, createGraphFromGraphJSON } from "@workglow/task-graph";
import type { TaskGraphJson } from "@workglow/task-graph";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import type { Command } from "commander";
import { editStringInExternalEditor } from "../editInEditor";
import { loadConfig } from "../config";
import {
  parseDynamicFlags,
  generateSchemaHelpText,
  resolveInput,
  resolveConfig,
  validateInput,
  readJsonInput,
} from "../input";
import { createAgentRepository } from "../storage";
import { formatError, formatTable, outputResult } from "../util";

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
    .command("detail")
    .argument("[id]", "agent identifier to show")
    .description("Show full details of an agent")
    .action(async (id: string | undefined) => {
      const config = await loadConfig();
      const repo = createAgentRepository(config);
      await repo.setupDatabase();

      let targetId = id;
      if (!targetId) {
        if (!process.stdin.isTTY) {
          console.error("Error: specify an id or run interactively.");
          process.exit(1);
        }
        const all = await repo.tabularRepository.getAll();
        if (!all || all.length === 0) {
          console.log("No agents found.");
          return;
        }
        const { renderSelectPrompt } = await import("../ui/render");
        const options = all.map((e) => ({
          label: String(e.key),
          value: String(e.key),
        }));
        const selected = await renderSelectPrompt(options, "Select agent:");
        if (!selected) return;
        targetId = selected;
      }

      const entry = await repo.tabularRepository.get({ key: targetId });
      if (!entry) {
        console.error(`Agent "${targetId}" not found.`);
        process.exit(1);
      }

      try {
        const parsed = JSON.parse(entry.value as string);
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(entry.value);
      }
    });

  agent
    .command("remove")
    .argument("[id]", "agent identifier to remove")
    .description("Remove an agent by ID")
    .action(async (id: string | undefined) => {
      const config = await loadConfig();
      const repo = createAgentRepository(config);
      await repo.setupDatabase();

      let targetId = id;
      if (!targetId) {
        if (!process.stdin.isTTY) {
          console.error("Error: specify an id or run interactively.");
          process.exit(1);
        }
        const all = await repo.tabularRepository.getAll();
        if (!all || all.length === 0) {
          console.log("No agents to remove.");
          return;
        }
        const { renderSelectPrompt } = await import("../ui/render");
        const options = all.map((e) => ({
          label: String(e.key),
          value: String(e.key),
        }));
        const selected = await renderSelectPrompt(options, "Select agent to remove:");
        if (!selected) return;
        targetId = selected;
      }

      await repo.tabularRepository.delete({ key: targetId });
      console.log(`Agent "${targetId}" removed.`);
    });

  agent
    .command("add")
    .argument("<id>", "agent identifier")
    .description("Add an agent from JSON")
    .option("--input-json <json>", "Agent JSON as string")
    .option("--input-json-file <path>", "Agent JSON from file")
    .option("--dry-run", "Validate without saving")
    .action(async (id: string, opts: Record<string, string | boolean | undefined>) => {
      const json = await readJsonInput({
        inputJson: opts.inputJson as string | undefined,
        inputJsonFile: opts.inputJsonFile as string | undefined,
      });

      const graph = createGraphFromGraphJSON(json as TaskGraphJson);

      if (opts.dryRun) {
        console.log(JSON.stringify(graph.toJSON(), null, 2));
        process.exit(0);
      }

      const config = await loadConfig();
      const repo = createAgentRepository(config);
      await repo.setupDatabase();

      await repo.saveTaskGraph(id, graph);
      console.log(`Agent "${id}" added.`);
    });

  agent
    .command("edit")
    .argument("[id]", "agent identifier to edit")
    .description(
      "Edit agent JSON in $GIT_EDITOR, $VISUAL, or $EDITOR; save to apply, or quit without saving to cancel"
    )
    .action(async (id: string | undefined) => {
      const config = await loadConfig();
      const repo = createAgentRepository(config);
      await repo.setupDatabase();

      let targetId = id;
      if (!targetId) {
        if (!process.stdin.isTTY) {
          console.error("Error: specify an id or run interactively.");
          process.exit(1);
        }
        const all = await repo.tabularRepository.getAll();
        if (!all || all.length === 0) {
          console.log("No agents found.");
          return;
        }
        const { renderSelectPrompt } = await import("../ui/render");
        const options = all.map((e) => ({
          label: String(e.key),
          value: String(e.key),
        }));
        const selected = await renderSelectPrompt(options, "Select agent to edit:");
        if (!selected) return;
        targetId = selected;
      }

      const entry = await repo.tabularRepository.get({ key: targetId });
      if (!entry) {
        console.error(`Agent "${targetId}" not found.`);
        process.exit(1);
      }

      const raw = entry.value as string;
      let initial: string;
      try {
        initial = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        initial = raw;
      }

      const result = editStringInExternalEditor(
        initial,
        `${targetId.replace(/[^\w.-]+/g, "_")}.json`
      );

      if (result.status === "unchanged") {
        console.log("Aborted: file unchanged (quit the editor without saving).");
        return;
      }

      if (result.status === "editor_error") {
        console.error(`Editor failed: ${result.message}`);
        process.exit(1);
      }

      let json: TaskGraphJson;
      try {
        json = JSON.parse(result.content) as TaskGraphJson;
      } catch (e) {
        console.error(`Invalid JSON: ${formatError(e)}`);
        process.exit(1);
      }

      let graph;
      try {
        graph = createGraphFromGraphJSON(json);
      } catch (e) {
        console.error(`Invalid agent graph: ${formatError(e)}`);
        process.exit(1);
      }

      await repo.saveTaskGraph(targetId, graph);
      console.log(`Agent "${targetId}" saved.`);
    });

  const run = agent
    .command("run")
    .argument("<id>", "agent identifier to run")
    .description("Run a saved agent")
    .allowUnknownOption()
    .allowExcessArguments(true)
    .helpOption(false)
    .option("--input-json <json>", "Input as JSON string")
    .option("--input-json-file <path>", "Input from JSON file")
    .option("--config-json <json>", "Config as JSON string")
    .option("--config-json-file <path>", "Config from JSON file")
    .option("--output-json-file <path>", "Write output to file")
    .option("--dry-run", "Validate input without executing")
    .option("--help", "Show help including schema-derived flags")
    .action(async (id: string, opts: Record<string, string | boolean | undefined>) => {
      const config = await loadConfig();
      const repo = createAgentRepository(config);
      await repo.setupDatabase();

      const graph = await repo.getTaskGraph(id);
      if (!graph) {
        console.error(`Agent "${id}" not found.`);
        process.exit(1);
      }

      const schemaRaw = computeGraphInputSchema(graph);
      const schema: DataPortSchemaObject =
        typeof schemaRaw === "boolean"
          ? { type: "object" as const, properties: {} }
          : (schemaRaw as DataPortSchemaObject);

      if (opts.help) {
        run.outputHelp();
        console.log("\nInput flags (from agent schema):");
        console.log(generateSchemaHelpText(schema));
        process.exit(0);
      }

      const dynamicFlags = parseDynamicFlags(process.argv, schema);
      let input = await resolveInput({
        inputJson: opts.inputJson as string | undefined,
        inputJsonFile: opts.inputJsonFile as string | undefined,
        dynamicFlags,
        schema,
      });
      const runConfig = await resolveConfig({
        configJson: opts.configJson as string | undefined,
        configJsonFile: opts.configJsonFile as string | undefined,
      });

      if (process.stdin.isTTY) {
        const { promptMissingInput } = await import("../input/prompt");
        input = await promptMissingInput(input, schema);
      }

      const validation = validateInput(input, schema);
      if (!validation.valid) {
        console.error("Input validation failed:");
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }

      if (opts.dryRun) {
        console.log(JSON.stringify(input, null, 2));
        process.exit(0);
      }

      try {
        if (process.stdout.isTTY) {
          const { renderWorkflowRun } = await import("../ui/render");
          await renderWorkflowRun(graph, input, {
            outputJsonFile: opts.outputJsonFile as string | undefined,
            config: runConfig,
          });
        } else {
          const result = await graph.run(input, runConfig);
          await outputResult(result, opts.outputJsonFile as string | undefined);
        }
      } catch (err) {
        console.error(`Error: ${formatError(err)}`);
        process.exit(1);
      }
    });
}
