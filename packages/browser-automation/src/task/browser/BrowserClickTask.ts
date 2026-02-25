/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util";
import { contextProperty, locatorProperty, timeoutMsProperty } from "./schemas";
import { prepareBrowserSession, setBrowserLast } from "./helpers";
import type { LocatorSpec } from "../../core/locator";
import type { WorkflowContext } from "../../core/context";

const inputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
    locator: locatorProperty,
    button: {
      type: "string",
      enum: ["left", "right", "middle"],
      default: "left",
    },
    click_count: { type: "number", default: 1 },
    timeout_ms: timeoutMsProperty,
  },
  required: ["locator"],
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

export type BrowserClickTaskInput = FromSchema<typeof inputSchema>;
export type BrowserClickTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserClickTask extends Task<
  BrowserClickTaskInput,
  BrowserClickTaskOutput,
  TaskConfig
> {
  static readonly type = "BrowserClickTask";
  static readonly category = "Browser";
  public static title = "Browser Click";
  public static description = "Clicks an element identified by a locator";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static outputSchema(): DataPortSchema {
    return outputSchema;
  }

  async execute(
    input: BrowserClickTaskInput,
    ctx: IExecuteContext
  ): Promise<BrowserClickTaskOutput> {
    const { context, envelope, manager } = await prepareBrowserSession(
      input.context,
      undefined,
      undefined,
      ctx.registry
    );

    return await manager.runExclusive(envelope.session.id, async (runtime) => {
      const timeoutMs = (input.timeout_ms as number) ?? envelope.session.config.timeoutMs ?? 30000;

      await runtime.click(input.locator as unknown as LocatorSpec, {
        timeoutMs,
        button: input.button as "left" | "right" | "middle" | undefined,
        clickCount: input.click_count as number | undefined,
      });

      return { context: context as WorkflowContext };
    });
  }
}

export const browserClick = (input: BrowserClickTaskInput, config: TaskConfig = {}) => {
  const task = new BrowserClickTask({}, config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    browserClick: CreateWorkflow<BrowserClickTaskInput, BrowserClickTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.browserClick = CreateWorkflow(BrowserClickTask);
