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
      description: "The browser context to use for navigation",
    },
    url: {
      type: "string",
      title: "URL",
      description: "The URL to navigate to",
      format: "uri",
    },
    waitUntil: {
      enum: ["load", "domcontentloaded", "networkidle"],
      title: "Wait Until",
      description: "When to consider navigation succeeded",
      default: "load",
    },
    timeout: {
      type: "number",
      title: "Timeout",
      description: "Maximum time to wait for navigation in milliseconds",
    },
  },
  required: ["context", "url"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: {
      $id: "BrowserContext",
      title: "Browser Context",
      description: "The browser context after navigation",
    },
    url: {
      type: "string",
      title: "Current URL",
      description: "The URL after navigation (may differ due to redirects)",
    },
  },
  required: ["context", "url"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type NavigateTaskInput = FromSchema<typeof inputSchema>;
export type NavigateTaskOutput = FromSchema<typeof outputSchema>;
export type NavigateTaskConfig = TaskConfig;

/**
 * NavigateTask navigates a browser context to a specified URL
 */
export class NavigateTask extends Task<
  NavigateTaskInput,
  NavigateTaskOutput,
  NavigateTaskConfig
> {
  public static type = "NavigateTask";
  public static category = "Browser";
  public static title = "Navigate";
  public static description = "Navigate to a URL in the browser";
  public static cacheable = false; // Navigation has side effects

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async execute(
    input: NavigateTaskInput,
    context: IExecuteContext
  ): Promise<NavigateTaskOutput> {
    const browserContext = input.context as unknown as IBrowserContext;

    await browserContext.navigate(input.url, {
      waitUntil: input.waitUntil,
      timeout: input.timeout,
    });

    const currentUrl = await browserContext.getUrl();

    return {
      context: browserContext as any,
      url: currentUrl,
    };
  }
}

/**
 * Helper function to create and run a NavigateTask
 */
export async function navigate(
  context: IBrowserContext,
  url: string,
  options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number }
): Promise<NavigateTaskOutput> {
  const task = new NavigateTask();
  return await task.run({
    context: context as any,
    url,
    waitUntil: options?.waitUntil,
    timeout: options?.timeout,
  });
}

// Add NavigateTask to Workflow
declare module "@workglow/task-graph" {
  interface Workflow {
    navigate: CreateWorkflow<NavigateTaskInput, NavigateTaskOutput, NavigateTaskConfig>;
  }
}

Workflow.prototype.navigate = CreateWorkflow(NavigateTask);
