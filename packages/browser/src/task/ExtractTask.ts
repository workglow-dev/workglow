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
      description: "The browser context to extract data from",
    },
    locator: {
      type: "object",
      title: "Element Locator",
      description: "Accessibility-based locator for the element to extract from",
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
    extractAll: {
      type: "boolean",
      title: "Extract All",
      description: "Whether to extract from all matching elements",
      default: false,
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
      description: "The browser context after extraction",
    },
    name: {
      type: "string",
      title: "Name",
      description: "The accessible name of the element",
    },
    value: {
      type: "string",
      title: "Value",
      description: "The value of the element (for inputs)",
    },
    role: {
      type: "string",
      title: "Role",
      description: "The ARIA role of the element",
    },
    names: {
      type: "array",
      items: { type: "string" },
      title: "Names",
      description: "Array of names when extractAll is true",
    },
    values: {
      type: "array",
      items: { type: "string" },
      title: "Values",
      description: "Array of values when extractAll is true",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ExtractTaskInput = FromSchema<typeof inputSchema>;
export type ExtractTaskOutput = FromSchema<typeof outputSchema>;
export type ExtractTaskConfig = TaskConfig;

/**
 * ExtractTask extracts text/values from elements identified by accessibility locator
 */
export class ExtractTask extends Task<ExtractTaskInput, ExtractTaskOutput, ExtractTaskConfig> {
  public static type = "ExtractTask";
  public static category = "Browser";
  public static title = "Extract";
  public static description = "Extract text or values from page elements using accessibility locator";
  public static cacheable = true; // Extraction is read-only

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async execute(input: ExtractTaskInput, context: IExecuteContext): Promise<ExtractTaskOutput> {
    const browserContext = input.context as unknown as IBrowserContext;
    const locator = input.locator as A11yLocator;

    // Get the accessibility tree
    const tree = await browserContext.getAccessibilityTree();

    if (input.extractAll) {
      // Extract from all matching elements
      const nodes = tree.findAll(locator);
      if (nodes.length === 0) {
        throw new Error(`No elements found with locator: ${JSON.stringify(locator)}`);
      }

      return {
        context: browserContext as any,
        names: nodes.map((node) => node.name),
        values: nodes.map((node) => node.value || ""),
        name: nodes[0].name,
        value: nodes[0].value,
        role: nodes[0].role,
      };
    } else {
      // Extract from single element
      const node = tree.find(locator);
      if (!node) {
        throw new Error(`Element not found with locator: ${JSON.stringify(locator)}`);
      }

      return {
        context: browserContext as any,
        name: node.name,
        value: node.value,
        role: node.role,
      };
    }
  }
}

/**
 * Helper function to create and run an ExtractTask
 */
export async function extract(
  context: IBrowserContext,
  locator: A11yLocator,
  options?: { extractAll?: boolean }
): Promise<ExtractTaskOutput> {
  const task = new ExtractTask();
  return await task.run({
    context: context as any,
    locator: locator as any,
    extractAll: options?.extractAll,
  });
}

// Add ExtractTask to Workflow
declare module "@workglow/task-graph" {
  interface Workflow {
    extract: CreateWorkflow<ExtractTaskInput, ExtractTaskOutput, ExtractTaskConfig>;
  }
}

Workflow.prototype.extract = CreateWorkflow(ExtractTask);
