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
      description: "The browser context to perform the typing in",
    },
    locator: {
      type: "object",
      title: "Element Locator",
      description: "Accessibility-based locator for the input element",
      properties: {
        role: {
          type: "string",
          title: "Role",
          description: "ARIA role of the element (e.g., 'textbox', 'searchbox')",
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
    text: {
      type: "string",
      title: "Text",
      description: "The text to type into the element",
    },
    clear: {
      type: "boolean",
      title: "Clear First",
      description: "Whether to clear existing text before typing",
      default: false,
    },
    delay: {
      type: "number",
      title: "Delay",
      description: "Delay between key presses in milliseconds",
    },
  },
  required: ["context", "locator", "text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: {
      $id: "BrowserContext",
      title: "Browser Context",
      description: "The browser context after typing",
    },
    success: {
      type: "boolean",
      title: "Success",
      description: "Whether the typing was successful",
    },
  },
  required: ["context", "success"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TypeTaskInput = FromSchema<typeof inputSchema>;
export type TypeTaskOutput = FromSchema<typeof outputSchema>;
export type TypeTaskConfig = TaskConfig;

/**
 * TypeTask types text into an input element identified by accessibility locator
 */
export class TypeTask extends Task<TypeTaskInput, TypeTaskOutput, TypeTaskConfig> {
  public static type = "TypeTask";
  public static category = "Browser";
  public static title = "Type";
  public static description = "Type text into an input element using accessibility locator";
  public static cacheable = false; // Typing has side effects

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async execute(input: TypeTaskInput, context: IExecuteContext): Promise<TypeTaskOutput> {
    const browserContext = input.context as unknown as IBrowserContext;
    const locator = input.locator as A11yLocator;

    // Get the accessibility tree
    const tree = await browserContext.getAccessibilityTree();

    // Find the element
    const node = tree.find(locator);
    if (!node) {
      throw new Error(`Element not found with locator: ${JSON.stringify(locator)}`);
    }

    // Type into the element
    await browserContext.type(node, input.text, {
      clear: input.clear,
      delay: input.delay,
    });

    return {
      context: browserContext as any,
      success: true,
    };
  }
}

/**
 * Helper function to create and run a TypeTask
 */
export async function type(
  context: IBrowserContext,
  locator: A11yLocator,
  text: string,
  options?: { clear?: boolean; delay?: number }
): Promise<TypeTaskOutput> {
  const task = new TypeTask();
  return await task.run({
    context: context as any,
    locator: locator as any,
    text,
    clear: options?.clear,
    delay: options?.delay,
  });
}

// Add TypeTask to Workflow
declare module "@workglow/task-graph" {
  interface Workflow {
    type: CreateWorkflow<TypeTaskInput, TypeTaskOutput, TypeTaskConfig>;
  }
}

Workflow.prototype.type = CreateWorkflow(TypeTask);
