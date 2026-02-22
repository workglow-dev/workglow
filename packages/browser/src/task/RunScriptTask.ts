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
      description: "The browser context to run the script in",
    },
    script: {
      type: "string",
      title: "JavaScript Code",
      description: "JavaScript code to execute in the page context",
    },
  },
  required: ["context", "script"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: {
      $id: "BrowserContext",
      title: "Browser Context",
      description: "The browser context after running the script",
    },
    result: {
      title: "Result",
      description: "The result returned by the script",
    },
  },
  required: ["context"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type RunScriptTaskInput = FromSchema<typeof inputSchema>;
export type RunScriptTaskOutput = FromSchema<typeof outputSchema>;
export type RunScriptTaskConfig = TaskConfig;

/**
 * RunScriptTask executes arbitrary JavaScript in the page context
 */
export class RunScriptTask extends Task<
  RunScriptTaskInput,
  RunScriptTaskOutput,
  RunScriptTaskConfig
> {
  public static type = "RunScriptTask";
  public static category = "Browser";
  public static title = "Run Script";
  public static description = "Execute JavaScript code in the page context";
  public static cacheable = false; // Script execution has side effects

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async execute(
    input: RunScriptTaskInput,
    context: IExecuteContext
  ): Promise<RunScriptTaskOutput> {
    const browserContext = input.context as unknown as IBrowserContext;

    const result = await browserContext.evaluate(input.script);

    return {
      context: browserContext as any,
      result,
    };
  }
}

/**
 * Helper function to create and run a RunScriptTask
 */
export async function runScript(
  context: IBrowserContext,
  script: string
): Promise<RunScriptTaskOutput> {
  const task = new RunScriptTask();
  return await task.run({
    context: context as any,
    script,
  });
}

// Add RunScriptTask to Workflow
declare module "@workglow/task-graph" {
  interface Workflow {
    runScript: CreateWorkflow<RunScriptTaskInput, RunScriptTaskOutput, RunScriptTaskConfig>;
  }
}

Workflow.prototype.runScript = CreateWorkflow(RunScriptTask);
