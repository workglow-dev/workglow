/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util";
import {
  contextProperty,
  extractKindProperty,
  locatorProperty,
  timeoutMsProperty,
} from "./schemas";
import { prepareBrowserSession } from "./helpers";
import type { LocatorSpec } from "../../core/locator";
import type { ExtractKind, ExtractSpec } from "../../core/types";
import type { WorkflowContext } from "../../core/context";

const inputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
    kind: extractKindProperty,
    locator: locatorProperty,
    attribute: { type: "string" },
    timeout_ms: timeoutMsProperty,
  },
  required: ["kind"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
    data: {},
  },
  required: ["context", "data"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserExtractTaskInput = FromSchema<typeof inputSchema>;
export type BrowserExtractTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserExtractTask extends Task<
  BrowserExtractTaskInput,
  BrowserExtractTaskOutput,
  TaskConfig
> {
  static readonly type = "BrowserExtractTask";
  static readonly category = "Browser";
  public static title = "Browser Extract";
  public static description = "Extracts data from the page (text, HTML, attributes, tables)";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static outputSchema(): DataPortSchema {
    return outputSchema;
  }

  async execute(
    input: BrowserExtractTaskInput,
    ctx: IExecuteContext
  ): Promise<BrowserExtractTaskOutput> {
    const { context, envelope, manager } = await prepareBrowserSession(
      input.context,
      undefined,
      undefined,
      ctx.registry
    );

    return await manager.runExclusive(envelope.session.id, async (runtime) => {
      const timeoutMs = (input.timeout_ms as number) ?? envelope.session.config.timeoutMs ?? 30000;

      const spec: ExtractSpec = {
        kind: input.kind as ExtractKind,
        locator: input.locator as unknown as LocatorSpec | undefined,
        attribute: input.attribute as string | undefined,
      };

      const data = await runtime.extract(spec, { timeoutMs });

      return { context: context as WorkflowContext, data };
    });
  }
}

export const browserExtract = (input: BrowserExtractTaskInput, config: TaskConfig = {}) => {
  const task = new BrowserExtractTask({}, config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    browserExtract: CreateWorkflow<BrowserExtractTaskInput, BrowserExtractTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.browserExtract = CreateWorkflow(BrowserExtractTask);
