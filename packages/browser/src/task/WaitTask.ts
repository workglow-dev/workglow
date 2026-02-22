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
import type { A11yLocator } from "../a11y/A11yLocator";
import type { IBrowserContext } from "../context/IBrowserContext";

const inputSchema = {
  type: "object",
  properties: {
    context: {
      $id: "BrowserContext",
      title: "Browser Context",
      description: "The browser context to wait in",
    },
    locator: {
      type: "object",
      title: "Element Locator",
      description: "Accessibility-based locator for the element to wait for",
      properties: {
        role: {
          type: "string",
          title: "Role",
          description: "ARIA role of the element",
        },
        name: {
          type: "string",
          title: "Name",
          description: "Accessible name of the element (partial match)",
        },
        nameExact: {
          type: "string",
          title: "Exact Name",
          description: "Exact accessible name of the element",
        },
        nth: {
          type: "number",
          title: "Index",
          description: "Index when multiple elements match (0-based)",
        },
      },
    },
    timeout: {
      type: "number",
      title: "Timeout",
      description: "Maximum time to wait in milliseconds",
      default: 30000,
    },
    pollingInterval: {
      type: "number",
      title: "Polling Interval",
      description: "How often to check for the element in milliseconds",
      default: 100,
    },
  },
  required: ["context", "locator"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: {
      $id: "BrowserContext",
      title: "Browser Context",
      description: "The browser context after waiting",
    },
    found: {
      type: "boolean",
      title: "Found",
      description: "Whether the element was found",
    },
  },
  required: ["context", "found"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type WaitTaskInput = FromSchema<typeof inputSchema>;
export type WaitTaskOutput = FromSchema<typeof outputSchema>;
export type WaitTaskConfig = TaskConfig;

/**
 * WaitTask waits for an element to appear or a condition to be met
 */
export class WaitTask extends Task<WaitTaskInput, WaitTaskOutput, WaitTaskConfig> {
  public static type = "WaitTask";
  public static category = "Browser";
  public static title = "Wait";
  public static description = "Wait for an element to appear using accessibility locator";
  public static cacheable = false; // Waiting is time-dependent

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async execute(input: WaitTaskInput, context: IExecuteContext): Promise<WaitTaskOutput> {
    const browserContext = input.context as unknown as IBrowserContext;
    const locator = input.locator as A11yLocator;

    // Wait for the element to appear
    await browserContext.waitFor(
      async () => {
        const tree = await browserContext.getAccessibilityTree();
        const node = tree.find(locator);
        return node !== undefined;
      },
      {
        timeout: input.timeout,
        pollingInterval: input.pollingInterval,
      }
    );

    return {
      context: browserContext as any,
      found: true,
    };
  }
}

/**
 * Helper function to create and run a WaitTask
 */
export async function wait(
  context: IBrowserContext,
  locator: A11yLocator,
  options?: { timeout?: number; pollingInterval?: number }
): Promise<WaitTaskOutput> {
  const task = new WaitTask();
  return await task.run({
    context: context as any,
    locator: locator as any,
    timeout: options?.timeout,
    pollingInterval: options?.pollingInterval,
  });
}

// Add WaitTask to Workflow
declare module "@workglow/task-graph" {
  interface Workflow {
    wait: CreateWorkflow<WaitTaskInput, WaitTaskOutput, WaitTaskConfig>;
  }
}

Workflow.prototype.wait = CreateWorkflow(WaitTask);
