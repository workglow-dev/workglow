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
    full_page: { type: "boolean", default: false },
    format: {
      type: "string",
      enum: ["png", "jpeg"],
      default: "png",
    },
    quality: { type: "number", minimum: 0, maximum: 100 },
    locator: locatorProperty,
    timeout_ms: timeoutMsProperty,
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
    mime: { type: "string", enum: ["image/png", "image/jpeg"] },
    base64: { type: "string" },
    width: { type: "number" },
    height: { type: "number" },
  },
  required: ["context", "mime", "base64"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserScreenshotTaskInput = FromSchema<typeof inputSchema>;
export type BrowserScreenshotTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserScreenshotTask extends Task<
  BrowserScreenshotTaskInput,
  BrowserScreenshotTaskOutput,
  TaskConfig
> {
  static readonly type = "BrowserScreenshotTask";
  static readonly category = "Browser";
  public static title = "Browser Screenshot";
  public static description = "Takes a screenshot of the page or an element, returning base64";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static outputSchema(): DataPortSchema {
    return outputSchema;
  }

  async execute(
    input: BrowserScreenshotTaskInput,
    ctx: IExecuteContext
  ): Promise<BrowserScreenshotTaskOutput> {
    const { context, envelope, manager } = await prepareBrowserSession(
      input.context,
      undefined,
      undefined,
      ctx.registry
    );

    return await manager.runExclusive(envelope.session.id, async (runtime) => {
      const timeoutMs = (input.timeout_ms as number) ?? envelope.session.config.timeoutMs ?? 30000;
      const format = (input.format as "png" | "jpeg") ?? "png";

      const result = await runtime.screenshot({
        fullPage: input.full_page as boolean | undefined,
        format,
        quality: input.quality as number | undefined,
        locator: input.locator as unknown as LocatorSpec | undefined,
        timeoutMs,
      });

      // Convert Uint8Array to base64 string
      const base64 = Buffer.from(result.bytes).toString("base64");

      return {
        context: context as WorkflowContext,
        mime: result.mime,
        base64,
      };
    });
  }
}

export const browserScreenshot = (input: BrowserScreenshotTaskInput, config: TaskConfig = {}) => {
  const task = new BrowserScreenshotTask({}, config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    browserScreenshot: CreateWorkflow<
      BrowserScreenshotTaskInput,
      BrowserScreenshotTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.browserScreenshot = CreateWorkflow(BrowserScreenshotTask);
