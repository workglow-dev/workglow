/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util";
import { searchMcpRegistry, type McpSearchResultItem } from "@workglow/tasks";
import type { Command } from "commander";
import { loadConfig } from "../config";
import {
  parseDynamicFlags,
  generateSchemaHelpText,
  resolveInput,
  validateInput,
} from "../input";
import { createMcpStorage, McpServerRecordSchema } from "../storage";
import { formatTable } from "../util";
import type { SearchSelectItem } from "../ui/render";

const mcpSchema = McpServerRecordSchema as unknown as DataPortSchemaObject;

interface McpSearchSelectItem extends SearchSelectItem {
  readonly result: McpSearchResultItem;
}

export function registerMcpCommand(program: Command): void {
  const mcp = program.command("mcp").description("Manage MCP servers");

  mcp
    .command("list")
    .description("List all configured MCP servers")
    .action(async () => {
      const config = await loadConfig();
      const storage = createMcpStorage(config);
      await storage.setupDirectory();

      const all = await storage.getAll();
      if (!all || all.length === 0) {
        console.log("No MCP servers found.");
        return;
      }

      const rows = all.map((entry) => ({
        name: String(entry.name ?? ""),
        transport: String(entry.transport ?? ""),
        server_url: String(entry.server_url ?? ""),
        command: String(entry.command ?? ""),
      }));
      console.log(formatTable(rows, ["name", "transport", "server_url", "command"]));
    });

  mcp
    .command("detail")
    .argument("[id]", "MCP server name to show")
    .description("Show full details of an MCP server")
    .action(async (id: string | undefined) => {
      const config = await loadConfig();
      const storage = createMcpStorage(config);
      await storage.setupDirectory();

      let targetId = id;
      if (!targetId) {
        if (!process.stdin.isTTY) {
          console.error("Error: specify an id or run interactively.");
          process.exit(1);
        }
        const all = await storage.getAll();
        if (!all || all.length === 0) {
          console.log("No MCP servers found.");
          return;
        }
        const { renderSelectPrompt } = await import("../ui/render");
        const options = all.map((e) => ({
          label: `${e.name}  ${e.transport ?? ""}  ${e.server_url ?? e.command ?? ""}`,
          value: String(e.name),
        }));
        const selected = await renderSelectPrompt(options, "Select MCP server:");
        if (!selected) return;
        targetId = selected;
      }

      const entry = await storage.get({ name: targetId });
      if (!entry) {
        console.error(`MCP server "${targetId}" not found.`);
        process.exit(1);
      }

      console.log(JSON.stringify(entry, null, 2));
    });

  mcp
    .command("remove")
    .argument("[id]", "MCP server name to remove")
    .description("Remove an MCP server by name")
    .action(async (id: string | undefined) => {
      const config = await loadConfig();
      const storage = createMcpStorage(config);
      await storage.setupDirectory();

      let targetId = id;
      if (!targetId) {
        if (!process.stdin.isTTY) {
          console.error("Error: specify an id or run interactively.");
          process.exit(1);
        }
        const all = await storage.getAll();
        if (!all || all.length === 0) {
          console.log("No MCP servers to remove.");
          return;
        }
        const { renderSelectPrompt } = await import("../ui/render");
        const options = all.map((e) => ({
          label: `${e.name}  ${e.transport ?? ""}  ${e.server_url ?? e.command ?? ""}`,
          value: String(e.name),
        }));
        const selected = await renderSelectPrompt(options, "Select MCP server to remove:");
        if (!selected) return;
        targetId = selected;
      }

      await storage.delete({ name: targetId });
      console.log(`MCP server "${targetId}" removed.`);
    });

  const add = mcp
    .command("add")
    .description("Add a new MCP server")
    .allowUnknownOption()
    .allowExcessArguments(true)
    .helpOption(false)
    .option("--input-json <json>", "Input as JSON string")
    .option("--input-json-file <path>", "Input from JSON file")
    .option("--dry-run", "Validate input without saving")
    .option("--help", "Show help")
    .action(async (opts: Record<string, string | boolean | undefined>) => {
      if (opts.help) {
        add.outputHelp();
        console.log("\nInput flags (from MCP server schema):");
        console.log(generateSchemaHelpText(mcpSchema));
        process.exit(0);
      }

      const dynamicFlags = parseDynamicFlags(process.argv, mcpSchema);
      let input = await resolveInput({
        inputJson: opts.inputJson as string | undefined,
        inputJsonFile: opts.inputJsonFile as string | undefined,
        dynamicFlags,
        schema: mcpSchema,
      });

      if (process.stdin.isTTY) {
        const { promptMissingInput } = await import("../input/prompt");
        input = await promptMissingInput(input, mcpSchema);
      }

      const validation = validateInput(input, mcpSchema);
      if (!validation.valid) {
        console.error("Input validation failed:");
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }

      // Transport-specific validation
      const transport = input.transport as string;
      if (transport === "stdio" && !input.command) {
        console.error('Transport "stdio" requires -command.');
        process.exit(1);
      }
      if ((transport === "sse" || transport === "streamable-http") && !input.server_url) {
        console.error(`Transport "${transport}" requires -server_url.`);
        process.exit(1);
      }

      if (opts.dryRun) {
        console.log(JSON.stringify(input, null, 2));
        process.exit(0);
      }

      const config = await loadConfig();
      const storage = createMcpStorage(config);
      await storage.setupDirectory();

      await storage.put(input as Record<string, unknown>);
      console.log(`MCP server "${input.name}" added.`);
    });

  mcp
    .command("find")
    .argument("[query]", "Initial search term")
    .option("--dry-run", "Validate and print result without saving")
    .description("Search the MCP registry and add a server")
    .action(async (query: string | undefined, opts: { dryRun?: boolean }) => {
      if (!process.stdin.isTTY) {
        console.error("Error: mcp find requires an interactive terminal.");
        process.exit(1);
      }

      const { renderSearchSelect } = await import("../ui/render");
      const selected = await renderSearchSelect<McpSearchSelectItem>({
        initialQuery: query,
        placeholder: "Search MCP servers",
        onSearch: async (q, cursor) => {
          const results = await searchMcpRegistry(q);
          const items: McpSearchSelectItem[] = results.map((r) => ({
            id: r.id,
            label: r.label,
            description: r.description,
            result: r,
          }));
          return { items, nextCursor: undefined };
        },
      });

      if (!selected) {
        return;
      }

      let input = selected.result.config;

      const { promptMissingInput } = await import("../input/prompt");
      input = await promptMissingInput(input, mcpSchema);

      const validation = validateInput(input, mcpSchema);
      if (!validation.valid) {
        console.error("Input validation failed:");
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }

      const transport = input.transport as string;
      if (transport === "stdio" && !input.command) {
        console.error('Transport "stdio" requires -command.');
        process.exit(1);
      }
      if ((transport === "sse" || transport === "streamable-http") && !input.server_url) {
        console.error(`Transport "${transport}" requires -server_url.`);
        process.exit(1);
      }

      if (opts.dryRun) {
        console.log(JSON.stringify(input, null, 2));
        process.exit(0);
      }

      const config = await loadConfig();
      const storage = createMcpStorage(config);
      await storage.setupDirectory();

      await storage.put(input as Record<string, unknown>);
      console.log(`MCP server "${input.name}" added.`);
    });
}
