/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Server } from "@modelcontextprotocol/sdk/server";
import type {
  ElicitRequestFormParams,
  ElicitResult,
  RequestId,
} from "@modelcontextprotocol/sdk/types";
import type { IHumanConnector, IHumanRequest, IHumanResponse } from "@workglow/util";

function defaultAbortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

/**
 * Converts a workglow DataPortSchema to MCP's flat requestedSchema format.
 *
 * MCP elicitation supports only a restricted subset of JSON Schema:
 * flat object with top-level properties only, no nesting.
 */
function toMcpRequestedSchema(
  schema: Record<string, unknown>
): ElicitRequestFormParams["requestedSchema"] {
  const props = (schema.properties ??
    {}) as ElicitRequestFormParams["requestedSchema"]["properties"];
  const required = schema.required as string[] | undefined;
  return {
    type: "object" as const,
    properties: props,
    ...(required ? { required } : {}),
  };
}

export interface McpElicitationConnectorOptions {
  /**
   * The client request whose handling this elicitation belongs to — a tool
   * call, normally.
   *
   * What the spec asks for, and what makes the elicitation reliable over
   * Streamable HTTP. Unrelated, it goes out on the session's standalone SSE
   * stream, which the spec leaves optional: a client that never opens the GET
   * has the request dropped silently — `send` returns, and the promise this
   * connector is waiting on never settles. Even a client that does open one
   * (the SDK's does, best-effort, once `notifications/initialized` is accepted)
   * is racing it against its own first call. Related to a request, the
   * elicitation goes out on that request's own stream, which is open for as
   * long as the call it belongs to.
   */
  readonly relatedRequestId?: RequestId;
}

/**
 * IHumanConnector implementation that delegates to MCP Server.elicitInput().
 *
 * Handles all three interaction kinds:
 * - "notify": Sends a notification via MCP logging, resolves immediately.
 * - "display": Sends content for display, resolves immediately.
 * - "elicit": Delegates to Server.elicitInput() for structured form input.
 *
 * The two one-way kinds go out as logging notifications, which the server must
 * have declared the `logging` capability to send at all — without it the
 * notification is a silent no-op. Like the elicitation, they are related to the
 * request being handled where there is one, so they travel on that call's own
 * stream: sent unrelated they ride the session's standalone stream, which the
 * spec leaves optional, and the transport drops them without a word for a
 * client that never opened the GET. Neither kind blocks the task either way.
 *
 * Usage:
 * ```ts
 * import { Server } from "@modelcontextprotocol/sdk/server";
 * import { McpElicitationConnector } from "@workglow/mcp/tasks";
 * import { HUMAN_CONNECTOR } from "@workglow/util";
 *
 * const mcpServer: Server = ...; // your MCP server instance
 * const connector = new McpElicitationConnector(mcpServer, { relatedRequestId });
 * registry.registerInstance(HUMAN_CONNECTOR, connector);
 * ```
 */
export class McpElicitationConnector implements IHumanConnector {
  constructor(
    private readonly server: Server,
    private readonly options: McpElicitationConnectorOptions = {}
  ) {}

  /**
   * One `notifications/message`, related to the call being handled where there
   * is one.
   *
   * `Server.sendLoggingMessage` takes no notification options, so it can only
   * send unrelated — onto the standalone stream a client need never open. This
   * goes through `notification`, which carries the relation; the `logging`
   * capability is still enforced there, so a server that declared none throws
   * rather than pretending it sent something.
   */
  private async sendLog(data: unknown, logger: string | undefined): Promise<void> {
    const { relatedRequestId } = this.options;
    const params = { level: "info" as const, data, logger };
    if (relatedRequestId === undefined) {
      await this.server.sendLoggingMessage(params);
      return;
    }
    await this.server.notification(
      { method: "notifications/message", params },
      {
        relatedRequestId,
      }
    );
  }

  async send(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse> {
    switch (request.kind) {
      case "notify":
        return this.handleNotify(request, signal);

      case "display":
        return this.handleDisplay(request, signal);

      case "elicit":
        return this.handleElicit(request, signal);

      default:
        return this.handleElicit(request, signal);
    }
  }

  /**
   * Handle "notify" kind — fire-and-forget notification.
   * Uses MCP logging notification to send the message to the client.
   */
  private async handleNotify(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse> {
    if (signal.aborted) {
      throw signal.reason ?? defaultAbortError();
    }

    await this.sendLog(request.contentData ?? request.message, request.targetHumanId);

    if (signal.aborted) {
      throw signal.reason ?? defaultAbortError();
    }

    return {
      requestId: request.requestId,
      action: "accept",
      content: undefined,
      done: true,
    };
  }

  /**
   * Handle "display" kind — present content to the human.
   * Uses MCP logging notification with the content data.
   * Resolves immediately since no response is expected by default.
   */
  private async handleDisplay(
    request: IHumanRequest,
    signal: AbortSignal
  ): Promise<IHumanResponse> {
    if (signal.aborted) {
      throw signal.reason ?? defaultAbortError();
    }
    await this.sendLog(
      {
        message: request.message,
        content: request.contentData,
        schema: request.contentSchema,
      },
      request.targetHumanId
    );

    if (signal.aborted) {
      throw signal.reason ?? defaultAbortError();
    }

    return {
      requestId: request.requestId,
      action: "accept",
      content: undefined,
      done: true,
    };
  }

  /**
   * Handle "elicit" kind — request structured input via MCP elicitation.
   */
  private async handleElicit(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse> {
    const mcpResult: ElicitResult = await this.server.elicitInput(
      {
        mode: "form",
        message: request.message,
        requestedSchema: toMcpRequestedSchema(request.contentSchema as Record<string, unknown>),
      },
      { signal, relatedRequestId: this.options.relatedRequestId }
    );

    return {
      requestId: request.requestId,
      action: mcpResult.action,
      content:
        mcpResult.action === "accept" ? (mcpResult.content as Record<string, unknown>) : undefined,
      done: true,
    };
  }
}
