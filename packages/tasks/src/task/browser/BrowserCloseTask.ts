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
  TaskConfigurationError,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { getBrowserSessionManagerFromContext } from "./BrowserSessionManager";
import {
  BrowserTaskInputCommon,
  clearBrowserMetadata,
  cloneContext,
  resolveSessionId,
} from "./types";

const clearModes = ["all", "session_id"] as const;

const inputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true, default: {} },
    session_id: { type: "string" },
    clear_mode: { type: "string", enum: clearModes, default: "all" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true },
    closed: { type: "boolean" },
  },
  required: ["context", "closed"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserCloseTaskInput = FromSchema<typeof inputSchema> &
  BrowserTaskInputCommon &
  Record<string, unknown>;
export type BrowserCloseTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserCloseTask extends Task<BrowserCloseTaskInput, BrowserCloseTaskOutput, TaskConfig> {
  public static readonly type = "BrowserCloseTask";
  public static readonly category = "Browser";
  public static readonly title = "Browser Close";
  public static readonly description = "Closes an existing browser session and clears browser metadata";
  public static readonly cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  public async execute(input: BrowserCloseTaskInput, executeContext: IExecuteContext) {
    const sessionId = resolveSessionId(input, true);
    if (!sessionId) {
      throw new TaskConfigurationError("No browser session id found for close operation");
    }

    const manager = getBrowserSessionManagerFromContext(executeContext);
    await manager.runExclusive(sessionId, async () => {
      await manager.closeSession(sessionId);
    });

    const context = clearBrowserMetadata(cloneContext(input.context), input.clear_mode ?? "all");
    return {
      context,
      closed: true,
    };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    browserClose: CreateWorkflow<BrowserCloseTaskInput, BrowserCloseTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.browserClose = CreateWorkflow(BrowserCloseTask);
