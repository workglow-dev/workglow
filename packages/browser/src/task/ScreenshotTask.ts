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
import { DataPortSchema, FromSchema } from "@workglow/util";
import type { IBrowserContext } from "../context/IBrowserContext";

const inputSchema = {
  type: "object",
  properties: {
    context: {
      $id: "BrowserContext",
      title: "Browser Context",
      description: "The browser context to take screenshot in",
    },
    type: {
      enum: ["png", "jpeg"],
      title: "Image Type",
      description: "Image format for the screenshot",
      default: "png",
    },
    quality: {
      type: "number",
      title: "Quality",
      description: "Quality (0-100) for JPEG images",
      minimum: 0,
      maximum: 100,
    },
    fullPage: {
      type: "boolean",
      title: "Full Page",
      description: "Whether to capture the full scrollable page",
      default: false,
    },
  },
  required: ["context"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: {
      $id: "BrowserContext",
      title: "Browser Context",
      description: "The browser context after taking screenshot",
    },
    screenshot: {
      format: "uint8array",
      title: "Screenshot",
      description: "The screenshot image data",
    },
  },
  required: ["context", "screenshot"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ScreenshotTaskInput = FromSchema<typeof inputSchema>;
export type ScreenshotTaskOutput = FromSchema<typeof outputSchema>;
export type ScreenshotTaskConfig = TaskConfig;

/**
 * ScreenshotTask captures a screenshot of the current page
 */
export class ScreenshotTask extends Task<
  ScreenshotTaskInput,
  ScreenshotTaskOutput,
  ScreenshotTaskConfig
> {
  public static type = "ScreenshotTask";
  public static category = "Browser";
  public static title = "Screenshot";
  public static description = "Capture a screenshot of the current page";
  public static cacheable = false; // Screenshots are time-dependent

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async execute(
    input: ScreenshotTaskInput,
    context: IExecuteContext
  ): Promise<ScreenshotTaskOutput> {
    const browserContext = input.context as unknown as IBrowserContext;

    const screenshot = await browserContext.screenshot({
      type: input.type,
      quality: input.quality,
      fullPage: input.fullPage,
    });

    return {
      context: browserContext as any,
      screenshot: screenshot as any,
    };
  }
}

/**
 * Helper function to create and run a ScreenshotTask
 */
export async function screenshot(
  context: IBrowserContext,
  options?: { type?: "png" | "jpeg"; quality?: number; fullPage?: boolean }
): Promise<ScreenshotTaskOutput> {
  const task = new ScreenshotTask();
  return await task.run({
    context: context as any,
    type: options?.type,
    quality: options?.quality,
    fullPage: options?.fullPage,
  });
}

// Add ScreenshotTask to Workflow
declare module "@workglow/task-graph" {
  interface Workflow {
    screenshot: CreateWorkflow<ScreenshotTaskInput, ScreenshotTaskOutput, ScreenshotTaskConfig>;
  }
}

Workflow.prototype.screenshot = CreateWorkflow(ScreenshotTask);
