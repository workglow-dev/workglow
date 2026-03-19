/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

const MCP_REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0.1";

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

export interface McpSearchResultItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly config: Record<string, unknown>;
}

const McpSearchInputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      title: "Query",
      description: "Search query for the MCP registry",
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const McpSearchOutputSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          config: { type: "object", additionalProperties: true },
        },
        required: ["id", "label", "description", "config"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type McpSearchTaskInput = FromSchema<typeof McpSearchInputSchema>;
export type McpSearchTaskOutput = { results: McpSearchResultItem[] };

/**
 * Map an MCP registry server entry to a config object usable for MCP server configuration.
 */
export function mapMcpRegistryResult(server: McpRegistryServer): Record<string, unknown> {
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

/**
 * Search the MCP registry for servers matching a query.
 */
export async function searchMcpRegistry(
  query: string,
  signal?: AbortSignal
): Promise<McpSearchResultItem[]> {
  const params = new URLSearchParams({
    search: query,
    limit: "500",
    version: "latest",
  });

  const res = await fetch(`${MCP_REGISTRY_BASE}/servers?${params}`, { signal });
  if (!res.ok) throw new Error(`Registry returned ${res.status}`);

  const data = await res.json();
  return (data.servers ?? []).map((entry: { server: McpRegistryServer }) => {
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
      config: mapMcpRegistryResult(s),
    };
  });
}

/**
 * Search the MCP server registry for servers matching a query.
 */
export class McpSearchTask extends Task<McpSearchTaskInput, McpSearchTaskOutput, TaskConfig> {
  public static type = "McpSearchTask";
  public static category = "MCP";
  public static title = "MCP Search";
  public static description = "Search the MCP server registry for servers matching a query";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return McpSearchInputSchema satisfies DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return McpSearchOutputSchema satisfies DataPortSchema;
  }

  async execute(
    input: McpSearchTaskInput,
    context: IExecuteContext
  ): Promise<McpSearchTaskOutput> {
    const results = await searchMcpRegistry(input.query, context.signal);
    return { results };
  }
}

/**
 * Search the MCP server registry.
 */
export const mcpSearch = (input: McpSearchTaskInput, config?: TaskConfig) => {
  return new McpSearchTask({} as McpSearchTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    mcpSearch: CreateWorkflow<McpSearchTaskInput, McpSearchTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.mcpSearch = CreateWorkflow(McpSearchTask);
