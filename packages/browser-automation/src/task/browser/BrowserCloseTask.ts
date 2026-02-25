/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util";
import { contextProperty, timeoutMsProperty } from "./schemas";
import { normalizeContext, getBrowserSessionManager, clearBrowserEnvelope } from "./helpers";
import { getBrowserEnvelope } from "../../core/context";
import type { WorkflowContext } from "../../core/context";

const inputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
    timeout_ms: timeoutMsProperty,
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
    closed: { type: "boolean" },
  },
  required: ["context", "closed"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserCloseTaskInput = FromSchema<typeof inputSchema>;
export type BrowserCloseTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Closes a browser session. Idempotent: closing a nonexistent session
 * returns closed: true and clears context.__browser.
 */
export class BrowserCloseTask extends Task<
  BrowserCloseTaskInput,
  BrowserCloseTaskOutput,
  TaskConfig
> {
  static readonly type = "BrowserCloseTask";
  static readonly category = "Browser";
  public static title = "Browser Close";
  public static description = "Closes the browser session and clears session state from context";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static outputSchema(): DataPortSchema {
    return outputSchema;
  }

  async execute(
    input: BrowserCloseTaskInput,
    ctx: IExecuteContext
  ): Promise<BrowserCloseTaskOutput> {
    const context = normalizeContext(input.context);
    const envelope = getBrowserEnvelope(context);

    if (!envelope) {
      // No session to close — idempotent
      return { context: clearBrowserEnvelope(context) as WorkflowContext, closed: true };
    }

    const manager = getBrowserSessionManager(ctx.registry);
    await manager.closeSession(envelope.session.id);

    return { context: clearBrowserEnvelope(context) as WorkflowContext, closed: true };
  }
}

export const browserClose = (input: BrowserCloseTaskInput, config: TaskConfig = {}) => {
  const task = new BrowserCloseTask({}, config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    browserClose: CreateWorkflow<BrowserCloseTaskInput, BrowserCloseTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.browserClose = CreateWorkflow(BrowserCloseTask);
