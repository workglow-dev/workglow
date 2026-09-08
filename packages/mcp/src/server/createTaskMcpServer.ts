/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Server } from "@modelcontextprotocol/sdk/server";
import type { CallToolResult, ListToolsResult, RequestId } from "@modelcontextprotocol/sdk/types";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types";
import type { IRunConfig, ITask, TaskInput } from "@workglow/task-graph";
import { globalServiceRegistry, HUMAN_CONNECTOR, ServiceRegistry } from "@workglow/util";
import { McpElicitationConnector } from "../tasks/McpElicitationConnector";
import type { TaskToolSelection } from "./taskTools";
import {
  buildTaskToolIndex,
  listTaskTools,
  toolResultForError,
  toolResultForOutput,
} from "./taskTools";

export interface TaskMcpServerOptions extends TaskToolSelection {
  /** Server name reported to clients. Name it after the host, not this package. */
  readonly name: string;
  readonly version: string;
  readonly instructions?: string;
  /**
   * Run options every tool call inherits — a runner id, a cache override.
   * `signal` is supplied per call from the client's cancellation and cannot be
   * overridden here, and `registry` is the parent of the per-call one described
   * on {@link TaskMcpServerOptions.elicitation}.
   */
  readonly runConfig?: Omit<Partial<IRunConfig>, "signal">;
  /**
   * Route human-in-the-loop tasks to the calling client through MCP
   * elicitation (default `true`).
   *
   * Each call runs against a child of the host's registry carrying an
   * {@link McpElicitationConnector} under `HUMAN_CONNECTOR`, so a task that
   * asks a person asks the one driving this session — rather than throwing
   * because the host's own connector wants a terminal nobody is sitting at.
   *
   * Pass `false` when the host has a better way to reach its human than the
   * MCP client does: the per-call child is then not created at all, and
   * whatever `runConfig.registry` binds is what a task resolves.
   */
  readonly elicitation?: boolean;
}

/**
 * A task's progress, forwarded to a client that asked to watch it.
 *
 * MCP requires the progress value to increase on every notification, so an
 * update that does not move forward is dropped rather than reshaped: a task
 * reporting indeterminate progress (`undefined`) has measured nothing, and
 * inventing a number for it would put a moving bar in front of a client with
 * no measurement behind it.
 */
function forwardProgress(
  task: ITask,
  progressToken: string | number,
  send: (params: {
    progressToken: string | number;
    progress: number;
    total?: number;
    message?: string;
  }) => Promise<void>
): () => void {
  let last = Number.NEGATIVE_INFINITY;
  return task.subscribe("progress", (progress, message) => {
    if (typeof progress !== "number" || !(progress > last)) return;
    last = progress;
    void send({
      progressToken,
      progress,
      total: 100,
      ...(message ? { message } : {}),
    }).catch(() => {
      // The client went away mid-run. The run itself is unaffected, and its
      // result still has somewhere to go if the request stream reopens.
    });
  });
}

/**
 * The registry one tool call runs against: a child of the host's, carrying the
 * connector that turns a task's human request into an MCP elicitation.
 *
 * A child rather than the host's own registry because the connector is bound to
 * ONE tool call — it answers on that call's stream — and binding it globally
 * would point every concurrent call's prompts at whichever client asked last.
 * This is the same child-per-run the graph runner already makes when a caller
 * supplies no registry, so nothing about resolution changes; the container
 * copies its parent's registrations rather than delegating to it, which is why
 * the parent has to be a booted one.
 */
function registryForCall(
  parent: ServiceRegistry,
  server: Server,
  relatedRequestId: RequestId
): ServiceRegistry {
  const registry = new ServiceRegistry(parent.container.createChildContainer());
  registry.registerInstance(
    HUMAN_CONNECTOR,
    new McpElicitationConnector(server, {
      relatedRequestId,
    })
  );
  return registry;
}

/**
 * An MCP server offering registered Workglow tasks as tools.
 *
 * Transport-agnostic on purpose: this is the half every host shares, and what
 * differs between the CLI, a Hono API and a desktop shell is only how bytes
 * reach it. Pair it with {@link McpSessionRouter} for HTTP, or connect it to a
 * stdio transport directly.
 *
 * Built on the low-level `Server` rather than `McpServer` because tasks
 * describe themselves in JSON Schema and `registerTool` accepts only Zod —
 * going through `McpServer` would mean converting a schema to Zod and back to
 * publish it, which is a lossy round trip and a dependency, to arrive at the
 * schema the task already had.
 */
export function createTaskMcpServer(options: TaskMcpServerOptions): Server {
  const elicitation = options.elicitation !== false;
  const server = new Server(
    { name: options.name, version: options.version },
    {
      // `logging` is what makes a task's one-way human requests — notify and
      // display — reach the client at all: without it `sendLoggingMessage` is
      // a silent no-op inside the SDK.
      capabilities: elicitation ? { tools: {}, logging: {} } : { tools: {} },
      ...(options.instructions ? { instructions: options.instructions } : {}),
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, (): ListToolsResult => {
    // Read the registry per request rather than at construction: a host that
    // registers tasks lazily (a provider loaded on first use) would otherwise
    // serve the list from whenever this server happened to be built.
    return { tools: listTaskTools(options) };
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request, extra): Promise<CallToolResult> => {
      const ctor = buildTaskToolIndex(options).get(request.params.name);
      // An unknown tool never reached one, so it is a protocol error rather than
      // a tool result — a caller that mistyped a name needs to hear it as one.
      if (!ctor) {
        throw new McpError(ErrorCode.InvalidParams, `unknown tool "${request.params.name}"`);
      }

      const task = new ctor({}) as ITask;
      const progressToken = extra._meta?.progressToken;
      const stopProgress =
        progressToken === undefined
          ? undefined
          : forwardProgress(task, progressToken, (params) =>
              extra.sendNotification({ method: "notifications/progress", params })
            );

      const parentRegistry = options.runConfig?.registry ?? globalServiceRegistry;
      try {
        const output = await task.run((request.params.arguments ?? {}) as Partial<TaskInput>, {
          ...options.runConfig,
          ...(elicitation
            ? { registry: registryForCall(parentRegistry, server, extra.requestId) }
            : {}),
          signal: extra.signal,
        });
        return toolResultForOutput(output);
      } catch (error) {
        return toolResultForError(error);
      } finally {
        stopProgress?.();
      }
    }
  );

  return server;
}
