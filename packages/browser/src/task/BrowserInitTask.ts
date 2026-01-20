/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  IExecuteContext,
  Task,
  TaskConfig,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import type { BrowserWorkflowConfig } from "../workflow/BrowserWorkflow";
import { initializeBrowserContext } from "../workflow/BrowserWorkflow";

const inputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: {
      $id: "BrowserContext",
      title: "Browser Context",
      description: "The initialized browser context",
    },
  },
  required: ["context"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserInitTaskInput = FromSchema<typeof inputSchema>;
export type BrowserInitTaskOutput = FromSchema<typeof outputSchema>;

export interface BrowserInitTaskConfig extends TaskConfig {
  browserConfig: BrowserWorkflowConfig;
}

/**
 * BrowserInitTask initializes a browser context with configuration
 */
export class BrowserInitTask extends Task<
  BrowserInitTaskInput,
  BrowserInitTaskOutput,
  BrowserInitTaskConfig
> {
  public static type = "BrowserInitTask";
  public static category = "Browser";
  public static title = "Initialize Browser";
  public static description = "Initialize a browser context with cookies and configuration";
  public static cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async execute(
    input: BrowserInitTaskInput,
    ctx: IExecuteContext
  ): Promise<BrowserInitTaskOutput> {
    const context = await initializeBrowserContext(this.config.browserConfig);
    return { context: context as any };
  }
}
