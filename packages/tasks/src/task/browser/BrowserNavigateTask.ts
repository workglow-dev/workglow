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
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema, uuid4 } from "@workglow/util";
import {
  BrowserTaskInputCommon,
  cloneContext,
  resolveSessionId,
  setBrowserMetadata,
} from "./types";
import { getBrowserSessionManagerFromContext } from "./BrowserSessionManager";
import { BrowserTypeName } from "./loadPlaywright";

const inputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true, default: {} },
    session_id: { type: "string" },
    timeout_ms: { type: "number", minimum: 1, default: 30000 },
    url: { type: "string", format: "uri" },
    wait_until: {
      type: "string",
      enum: ["load", "domcontentloaded", "networkidle", "commit"],
      default: "load",
    },
    browser_type: {
      type: "string",
      enum: ["chromium", "firefox", "webkit"],
      default: "chromium",
    },
    headless: { type: "boolean", default: true },
    launch_options: { type: "object", additionalProperties: true },
    context_options: { type: "object", additionalProperties: true },
  },
  required: ["url"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true },
    url: { type: "string" },
    title: { type: "string" },
    status: { type: "number" },
    ok: { type: "boolean" },
  },
  required: ["context", "url", "title"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserNavigateTaskInput = FromSchema<typeof inputSchema> &
  BrowserTaskInputCommon &
  Record<string, unknown>;
export type BrowserNavigateTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserNavigateTask extends Task<
  BrowserNavigateTaskInput,
  BrowserNavigateTaskOutput,
  TaskConfig
> {
  public static readonly type = "BrowserNavigateTask";
  public static readonly category = "Browser";
  public static readonly title = "Browser Navigate";
  public static readonly description = "Navigates to a URL in a Playwright browser session";
  public static readonly cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  public async execute(
    input: BrowserNavigateTaskInput,
    executeContext: IExecuteContext
  ): Promise<BrowserNavigateTaskOutput> {
    const manager = getBrowserSessionManagerFromContext(executeContext);
    const sessionId = resolveSessionId(input, false) ?? uuid4();

    return await manager.runExclusive(sessionId, async () => {
      const session = await manager.getOrCreateSession(sessionId, {
        browser_type: input.browser_type as BrowserTypeName | undefined,
        headless: input.headless,
        launch_options: input.launch_options as Record<string, unknown> | undefined,
        context_options: input.context_options as Record<string, unknown> | undefined,
      });

      const response = await session.page.goto(input.url, {
        waitUntil: input.wait_until ?? "load",
        timeout: input.timeout_ms ?? 30000,
      });

      const currentUrl = session.page.url?.() ?? input.url;
      let title = "";
      try {
        title = (await session.page.title?.()) ?? "";
      } catch {
        title = "";
      }

      const context = setBrowserMetadata(cloneContext(input.context), {
        session_id: sessionId,
        url: currentUrl,
        title,
      });

      return {
        context,
        url: currentUrl,
        title,
        ...(typeof response?.status === "function" ? { status: response.status() } : {}),
        ...(typeof response?.ok === "function" ? { ok: response.ok() } : {}),
      };
    });
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    browserNavigate: CreateWorkflow<BrowserNavigateTaskInput, BrowserNavigateTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.browserNavigate = CreateWorkflow(BrowserNavigateTask);
