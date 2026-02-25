/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util";
import { contextProperty, locatorProperty, timeoutMsProperty } from "./schemas";
import { prepareBrowserSession } from "./helpers";
import type { LocatorSpec } from "../../core/locator";
import type { WorkflowContext } from "../../core/context";

const inputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
    locator: locatorProperty,
    text: { type: "string" },
    clear: { type: "boolean", default: false },
    delay_ms: { type: "number" },
    timeout_ms: timeoutMsProperty,
  },
  required: ["locator", "text"],
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

export type BrowserTypeTaskInput = FromSchema<typeof inputSchema>;
export type BrowserTypeTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserTypeTask extends Task<BrowserTypeTaskInput, BrowserTypeTaskOutput, TaskConfig> {
  static readonly type = "BrowserTypeTask";
  static readonly category = "Browser";
  public static title = "Browser Type";
  public static description = "Types text into an input element identified by a locator";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static outputSchema(): DataPortSchema {
    return outputSchema;
  }

  async execute(input: BrowserTypeTaskInput, ctx: IExecuteContext): Promise<BrowserTypeTaskOutput> {
    const { context, envelope, manager } = await prepareBrowserSession(
      input.context,
      undefined,
      undefined,
      ctx.registry
    );

    return await manager.runExclusive(envelope.session.id, async (runtime) => {
      const timeoutMs = (input.timeout_ms as number) ?? envelope.session.config.timeoutMs ?? 30000;

      await runtime.type(input.locator as unknown as LocatorSpec, input.text as string, {
        timeoutMs,
        clear: input.clear as boolean | undefined,
        delayMs: input.delay_ms as number | undefined,
      });

      return { context: context as WorkflowContext };
    });
  }
}

export const browserType = (input: BrowserTypeTaskInput, config: TaskConfig = {}) => {
  const task = new BrowserTypeTask({}, config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    browserType: CreateWorkflow<BrowserTypeTaskInput, BrowserTypeTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.browserType = CreateWorkflow(BrowserTypeTask);
