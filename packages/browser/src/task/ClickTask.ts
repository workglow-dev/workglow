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
      description: "The browser context to perform the click in",
    },
    locator: {
      type: "object",
      title: "Element Locator",
      description: "Accessibility-based locator for the element to click",
      properties: {
        role: {
          type: "string",
          title: "Role",
          description: "ARIA role of the element (e.g., 'button', 'link')",
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
    button: {
      enum: ["left", "right", "middle"],
      title: "Mouse Button",
      description: "Which mouse button to use",
      default: "left",
    },
    clickCount: {
      type: "number",
      title: "Click Count",
      description: "Number of clicks (1 for single, 2 for double)",
      default: 1,
    },
    delay: {
      type: "number",
      title: "Delay",
      description: "Delay between mousedown and mouseup in milliseconds",
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
      description: "The browser context after the click",
    },
    success: {
      type: "boolean",
      title: "Success",
      description: "Whether the click was successful",
    },
  },
  required: ["context", "success"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ClickTaskInput = FromSchema<typeof inputSchema>;
export type ClickTaskOutput = FromSchema<typeof outputSchema>;
export type ClickTaskConfig = TaskConfig;

/**
 * ClickTask clicks on an element identified by accessibility locator
 */
export class ClickTask extends Task<ClickTaskInput, ClickTaskOutput, ClickTaskConfig> {
  public static type = "ClickTask";
  public static category = "Browser";
  public static title = "Click";
  public static description = "Click on an element using accessibility locator";
  public static cacheable = false; // Clicking has side effects

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async execute(input: ClickTaskInput, context: IExecuteContext): Promise<ClickTaskOutput> {
    const browserContext = input.context as unknown as IBrowserContext;
    const locator = input.locator as A11yLocator;

    // Get the accessibility tree
    const tree = await browserContext.getAccessibilityTree();

    // Find the element
    const node = tree.find(locator);
    if (!node) {
      throw new Error(
        `Element not found with locator: ${JSON.stringify(locator)}`
      );
    }

    // Click the element
    await browserContext.click(node, {
      button: input.button,
      clickCount: input.clickCount,
      delay: input.delay,
    });

    return {
      context: browserContext as any,
      success: true,
    };
  }
}

/**
 * Helper function to create and run a ClickTask
 */
export async function click(
  context: IBrowserContext,
  locator: A11yLocator,
  options?: { button?: "left" | "right" | "middle"; clickCount?: number; delay?: number }
): Promise<ClickTaskOutput> {
  const task = new ClickTask();
  return await task.run({
    context: context as any,
    locator: locator as any,
    button: options?.button,
    clickCount: options?.clickCount,
    delay: options?.delay,
  });
}

// Add ClickTask to Workflow
declare module "@workglow/task-graph" {
  interface Workflow {
    click: CreateWorkflow<ClickTaskInput, ClickTaskOutput, ClickTaskConfig>;
  }
}

Workflow.prototype.click = CreateWorkflow(ClickTask);
