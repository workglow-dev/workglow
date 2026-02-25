/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import { TaskConfigurationError } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util";
import { contextProperty, timeoutMsProperty } from "./schemas";
import { prepareBrowserSession } from "./helpers";
import { UNSAFE_EXEC_POLICY } from "../../core/tokens";
import type { WorkflowContext } from "../../core/context";

const inputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
    script: { type: "string" },
    script_id: { type: "string" },
    timeout_ms: timeoutMsProperty,
  },
  required: ["script"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: contextProperty,
    result: {},
  },
  required: ["context"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserEvaluateTaskInput = FromSchema<typeof inputSchema>;
export type BrowserEvaluateTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Evaluates a JavaScript expression in the browser page context.
 *
 * **Security**: This task is gated by the UnsafeExecutionPolicy service token.
 * It requires `allowPageEvaluateStrings === true` in the policy, and optionally
 * checks against an allowlist of script IDs.
 *
 * Never use this task with untrusted user-provided code.
 */
export class BrowserEvaluateTask extends Task<
  BrowserEvaluateTaskInput,
  BrowserEvaluateTaskOutput,
  TaskConfig
> {
  static readonly type = "BrowserEvaluateTask";
  static readonly category = "Browser";
  public static title = "Browser Evaluate (Unsafe)";
  public static description =
    "Evaluates JavaScript in the browser page context (requires unsafe execution policy)";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static outputSchema(): DataPortSchema {
    return outputSchema;
  }

  async execute(
    input: BrowserEvaluateTaskInput,
    ctx: IExecuteContext
  ): Promise<BrowserEvaluateTaskOutput> {
    // Security gate: check unsafe execution policy
    if (!ctx.registry.has(UNSAFE_EXEC_POLICY)) {
      throw new TaskConfigurationError(
        "BrowserEvaluateTask requires an UnsafeExecutionPolicy to be registered. " +
          "Register UNSAFE_EXEC_POLICY with allowPageEvaluateStrings: true."
      );
    }

    const policy = ctx.registry.get(UNSAFE_EXEC_POLICY);
    if (!policy.allowPageEvaluateStrings) {
      throw new TaskConfigurationError(
        "BrowserEvaluateTask is disabled by policy. " +
          "Set allowPageEvaluateStrings: true in the UnsafeExecutionPolicy."
      );
    }

    // Check script ID allowlist if configured
    const scriptId = input.script_id as string | undefined;
    if (policy.allowedScriptIds && policy.allowedScriptIds.length > 0) {
      if (!scriptId || !policy.allowedScriptIds.includes(scriptId)) {
        throw new TaskConfigurationError(
          `Script ID "${scriptId ?? "(none)"}" is not in the allowed script IDs list.`
        );
      }
    }

    const { context, envelope, manager } = await prepareBrowserSession(
      input.context,
      undefined,
      undefined,
      ctx.registry
    );

    return await manager.runExclusive(envelope.session.id, async (runtime) => {
      const timeoutMs = (input.timeout_ms as number) ?? envelope.session.config.timeoutMs ?? 30000;
      const result = await runtime.evaluate(input.script as string, { timeoutMs });

      return { context: context as WorkflowContext, result };
    });
  }
}

export const browserEvaluate = (input: BrowserEvaluateTaskInput, config: TaskConfig = {}) => {
  const task = new BrowserEvaluateTask({}, config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    browserEvaluate: CreateWorkflow<
      BrowserEvaluateTaskInput,
      BrowserEvaluateTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.browserEvaluate = CreateWorkflow(BrowserEvaluateTask);
