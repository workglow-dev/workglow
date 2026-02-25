/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteContext,
  Task,
  TaskConfig,
  TaskConfigSchema,
  Workflow,
} from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util";
import { contextProperty, sessionConfigProperty, timeoutMsProperty } from "./schemas";
import { prepareBrowserSession, setBrowserLast } from "./helpers";
import type { WorkflowContext } from "../../core/context";

const inputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
    session: sessionConfigProperty,
    url: { type: "string" },
    wait_until: {
      type: "string",
      enum: ["load", "domcontentloaded", "networkidle", "commit"],
      default: "load",
    },
    timeout_ms: timeoutMsProperty,
  },
  required: ["url"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
    url: { type: "string" },
    title: { type: "string" },
    status: { type: "number" },
    ok: { type: "boolean" },
  },
  required: ["context", "url", "title"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserNavigateTaskInput = FromSchema<typeof inputSchema>;
export type BrowserNavigateTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserNavigateTask extends Task<
  BrowserNavigateTaskInput,
  BrowserNavigateTaskOutput,
  TaskConfig
> {
  static readonly type = "BrowserNavigateTask";
  static readonly category = "Browser";
  public static title = "Browser Navigate";
  public static description = "Navigates to a URL, creating a browser session if needed";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static outputSchema(): DataPortSchema {
    return outputSchema;
  }

  async execute(
    input: BrowserNavigateTaskInput,
    ctx: IExecuteContext
  ): Promise<BrowserNavigateTaskOutput> {
    const { context, envelope, manager } = await prepareBrowserSession(
      input.context,
      input.session as Record<string, unknown> | undefined,
      undefined,
      ctx.registry
    );

    return await manager.runExclusive(envelope.session.id, async (runtime) => {
      const timeoutMs = (input.timeout_ms as number) ?? envelope.session.config.timeoutMs ?? 30000;
      const waitUntil = (input.wait_until as string) ?? "load";

      const nav = await runtime.navigate(input.url as string, { timeoutMs, waitUntil });

      const outContext = setBrowserLast(
        context,
        { url: nav.url, title: nav.title },
        envelope.session
      );

      return {
        context: outContext as WorkflowContext,
        url: nav.url,
        title: nav.title,
        status: nav.status,
        ok: nav.ok,
      };
    });
  }
}

export const browserNavigate = (input: BrowserNavigateTaskInput, config: TaskConfig = {}) => {
  const task = new BrowserNavigateTask({}, config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    browserNavigate: CreateWorkflow<
      BrowserNavigateTaskInput,
      BrowserNavigateTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.browserNavigate = CreateWorkflow(BrowserNavigateTask);
