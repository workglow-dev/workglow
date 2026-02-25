/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util";
import { contextProperty, locatorProperty, timeoutMsProperty, waitModeProperty } from "./schemas";
import { prepareBrowserSession } from "./helpers";
import type { LocatorSpec } from "../../core/locator";
import type { WaitMode, WaitSpec } from "../../core/types";
import type { WorkflowContext } from "../../core/context";

const inputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
    mode: waitModeProperty,
    locator: locatorProperty,
    state: {
      type: "string",
      enum: ["visible", "hidden", "attached", "detached"],
      default: "visible",
    },
    url_pattern: { type: "string" },
    load_state: {
      type: "string",
      enum: ["load", "domcontentloaded", "networkidle"],
      default: "load",
    },
    timeout_ms: timeoutMsProperty,
  },
  required: ["mode"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
  },
  required: ["context"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserWaitTaskInput = FromSchema<typeof inputSchema>;
export type BrowserWaitTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserWaitTask extends Task<BrowserWaitTaskInput, BrowserWaitTaskOutput, TaskConfig> {
  static readonly type = "BrowserWaitTask";
  static readonly category = "Browser";
  public static title = "Browser Wait";
  public static description = "Waits for a condition (timeout, locator, URL, load state)";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static outputSchema(): DataPortSchema {
    return outputSchema;
  }

  async execute(input: BrowserWaitTaskInput, ctx: IExecuteContext): Promise<BrowserWaitTaskOutput> {
    const { context, envelope, manager } = await prepareBrowserSession(
      input.context,
      undefined,
      undefined,
      ctx.registry
    );

    return await manager.runExclusive(envelope.session.id, async (runtime) => {
      const timeoutMs = (input.timeout_ms as number) ?? envelope.session.config.timeoutMs ?? 30000;

      const spec: WaitSpec = {
        mode: input.mode as WaitMode,
        locator: input.locator as unknown as LocatorSpec | undefined,
        state: input.state as WaitSpec["state"],
        urlPattern: input.url_pattern as string | undefined,
        loadState: input.load_state as WaitSpec["loadState"],
      };

      await runtime.wait(spec, { timeoutMs });

      return { context: context as WorkflowContext };
    });
  }
}

export const browserWait = (input: BrowserWaitTaskInput, config: TaskConfig = {}) => {
  const task = new BrowserWaitTask({}, config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    browserWait: CreateWorkflow<BrowserWaitTaskInput, BrowserWaitTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.browserWait = CreateWorkflow(BrowserWaitTask);
