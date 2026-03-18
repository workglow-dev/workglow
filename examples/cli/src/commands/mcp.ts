/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util";
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
import type { SearchPage, SearchSelectItem } from "../ui/render";

const mcpSchema = McpServerRecordSchema as unknown as DataPortSchemaObject;

interface McpRegistryServer {
  name: string;
  title?: string;
  description: string;
  version: string;
  packages?: Array<{
    registryType: string;
    identifier: string;
    transport: { type: string };
    environmentVariables?: Array<{
      name: string;
      description?: string;
      isRequired?: boolean;
    }>;
    runtimeArguments?: Array<{
      type: string;
      name: string;
      value?: string;
      isRequired?: boolean;
      description?: string;
    }>;
    packageArguments?: Array<{
      type: string;
      name: string;
      value?: string;
      isRequired?: boolean;
      description?: string;
    }>;
  }>;
  remotes?: Array<{
    type: string;
    url: string;
  }>;
}

interface McpSearchResult extends SearchSelectItem {
  readonly server: McpRegistryServer;
}

const MCP_REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0.1";

async function searchMcpRegistry(
  query: string,
  cursor: string | undefined
): Promise<SearchPage<McpSearchResult>> {
  const params = new URLSearchParams({
    search: query,
    limit: "20",
    version: "latest",
  });
  if (cursor) params.set("cursor", cursor);

  const res = await fetch(`${MCP_REGISTRY_BASE}/servers?${params}`);
  if (!res.ok) throw new Error(`Registry returned ${res.status}`);

  const data = await res.json();
  const items: McpSearchResult[] = (data.servers ?? []).map(
    (entry: { server: McpRegistryServer }) => {
      const s = entry.server;
      const pkg = s.packages?.[0];
      const remote = s.remotes?.[0];
      const badges = [pkg?.registryType, pkg?.transport?.type ?? remote?.type]
        .filter(Boolean)
        .join(" | ");

      return {
        id: `${s.name}:${s.version}`,
        label: `${s.title ?? s.name}${badges ? `  ${badges}` : ""}`,
        description: s.description,
        server: s,
      };
    }
  );

  return {
    items,
    nextCursor: data.metadata?.nextCursor ?? undefined,
  };
}

function mapMcpRegistryResult(server: McpRegistryServer): Record<string, unknown> {
  const name = server.name.split("/").pop() ?? server.name;

  if (server.remotes && server.remotes.length > 0) {
    const remote = server.remotes[0];
    return {
      name,
      transport: remote.type,
      server_url: remote.url,
    };
  }

  const pkg = server.packages?.[0];
  if (!pkg) return { name };

  let command: string;
  let args: string[];

  switch (pkg.registryType) {
    case "npm":
      command = "npx";
      args = ["-y", pkg.identifier];
      break;
    case "pypi":
      command = "uvx";
      args = [pkg.identifier];
      break;
    case "oci":
      command = "docker";
      args = ["run", "-i", "--rm", pkg.identifier];
      break;
    default:
      command = pkg.identifier;
      args = [];
  }

  if (pkg.runtimeArguments) {
    for (const arg of pkg.runtimeArguments) {
      if (arg.name) args.push(arg.name);
      if (arg.value) args.push(arg.value);
    }
  }

  const result: Record<string, unknown> = {
    name,
    transport: "stdio",
    command,
    args,
  };

  if (pkg.environmentVariables && pkg.environmentVariables.length > 0) {
    const env: Record<string, string> = {};
    for (const envVar of pkg.environmentVariables) {
      env[envVar.name] = "";
    }
    result.env = env;
  }

  return result;
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
      const selected = await renderSearchSelect<McpSearchResult>({
        initialQuery: query,
        placeholder: "Search MCP servers",
        onSearch: searchMcpRegistry,
      });

      if (!selected) {
        return;
      }

      let input = mapMcpRegistryResult(selected.server);

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
