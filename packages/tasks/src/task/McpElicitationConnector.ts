/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Server } from "@modelcontextprotocol/sdk/server";
import type { ElicitRequestFormParams, ElicitResult } from "@modelcontextprotocol/sdk/types";
import type {
  IHumanConnector,
  IHumanRequest,
  IHumanResponse,
} from "./HumanInputTask";

/**
 * Converts a workglow DataPortSchema to MCP's flat requestedSchema format.
 *
 * MCP elicitation supports only a restricted subset of JSON Schema:
 * flat object with top-level properties only, no nesting.
 * This function extracts the properties and required fields.
 */
function toMcpRequestedSchema(
  schema: Record<string, unknown>
): ElicitRequestFormParams["requestedSchema"] {
  const props = (schema.properties ?? {}) as ElicitRequestFormParams["requestedSchema"]["properties"];
  const required = schema.required as string[] | undefined;
  return {
    type: "object" as const,
    properties: props,
    ...(required ? { required } : {}),
  };
}

/**
 * IHumanConnector implementation that delegates to MCP Server.elicitInput().
 *
 * When workglow runs inside an MCP server, this connector uses the MCP
 * elicitation protocol to request human input from the connected MCP client.
 *
 * Usage:
 * ```ts
 * import { Server } from "@modelcontextprotocol/sdk/server";
 * import { McpElicitationConnector } from "@workglow/tasks";
 *
 * const mcpServer: Server = ...; // your MCP server instance
 * const connector = new McpElicitationConnector(mcpServer);
 * registry.registerInstance(HUMAN_CONNECTOR, connector);
 * ```
 */
export class McpElicitationConnector implements IHumanConnector {
  constructor(private readonly server: Server) {}

  async request(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse> {
    const mcpResult: ElicitResult = await this.server.elicitInput(
      {
        mode: "form",
        message: request.message,
        requestedSchema: toMcpRequestedSchema(request.requestedSchema as Record<string, unknown>),
      },
      { signal }
    );

    return {
      requestId: request.requestId,
      action: mcpResult.action,
      content: mcpResult.action === "accept" ? (mcpResult.content as Record<string, unknown>) : undefined,
      done: true,
    };
  }

  /**
   * Multi-turn follow-up via MCP elicitation.
   *
   * Each follow-up is a separate elicitInput() call. The MCP client sees
   * a new form each time — the previous response is not carried over
   * automatically (the caller can merge data if needed).
   */
  async followUp(
    request: IHumanRequest,
    _previousResponse: IHumanResponse,
    signal: AbortSignal
  ): Promise<IHumanResponse> {
    // For multi-turn, we re-elicit with the same schema
    return this.request(request, signal);
  }
}
