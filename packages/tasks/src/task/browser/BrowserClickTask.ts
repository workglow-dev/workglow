/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { getBrowserSessionManagerFromContext } from "./BrowserSessionManager";
import {
  BrowserTaskInputCommon,
  cloneContext,
  resolveSessionId,
  setBrowserMetadata,
} from "./types";

const inputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true, default: {} },
    session_id: { type: "string" },
    timeout_ms: { type: "number", minimum: 1, default: 30000 },
    selector: { type: "string", minLength: 1 },
    button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
    click_count: { type: "number", minimum: 1, default: 1 },
    delay_ms: { type: "number", minimum: 0 },
    wait_for_navigation: { type: "boolean", default: false },
    wait_until: {
      type: "string",
      enum: ["load", "domcontentloaded", "networkidle", "commit"],
      default: "load",
    },
  },
  required: ["selector"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true },
    clicked: { type: "boolean" },
    url: { type: "string" },
  },
  required: ["context", "clicked", "url"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserClickTaskInput = FromSchema<typeof inputSchema> &
  BrowserTaskInputCommon &
  Record<string, unknown>;
export type BrowserClickTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserClickTask extends Task<BrowserClickTaskInput, BrowserClickTaskOutput, TaskConfig> {
  public static readonly type = "BrowserClickTask";
  public static readonly category = "Browser";
  public static readonly title = "Browser Click";
  public static readonly description = "Clicks an element in an existing browser session";
  public static readonly cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  public async execute(input: BrowserClickTaskInput, executeContext: IExecuteContext) {
    const manager = getBrowserSessionManagerFromContext(executeContext);
    const sessionId = resolveSessionId(input, true)!;

    return await manager.runExclusive(sessionId, async () => {
      const session = manager.getSessionOrThrow(sessionId);
      const timeout = input.timeout_ms ?? 30000;
      const waitForNavigation = input.wait_for_navigation === true;

      if (waitForNavigation) {
        await Promise.all([
          session.page.waitForNavigation({
            waitUntil: input.wait_until ?? "load",
            timeout,
          }),
          session.page.click(input.selector, {
            button: input.button ?? "left",
            clickCount: input.click_count ?? 1,
            delay: input.delay_ms,
            timeout,
          }),
        ]);
      } else {
        await session.page.click(input.selector, {
          button: input.button ?? "left",
          clickCount: input.click_count ?? 1,
          delay: input.delay_ms,
          timeout,
        });
      }

      const currentUrl = session.page.url?.() ?? "";
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
        clicked: true,
        url: currentUrl,
      };
    });
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    browserClick: CreateWorkflow<BrowserClickTaskInput, BrowserClickTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.browserClick = CreateWorkflow(BrowserClickTask);
