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
import { getBrowserSessionManagerFromContext } from "./BrowserSessionManager";
import {
  BrowserTaskInputCommon,
  cloneContext,
  resolveSessionId,
  setBrowserMetadata,
  withTimeout,
} from "./types";

const inputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true, default: {} },
    session_id: { type: "string" },
    timeout_ms: { type: "number", minimum: 1, default: 30000 },
    evaluate_code: {
      type: "string",
      minLength: 1,
      format: "code:javascript",
      description:
        "Trusted JavaScript executed in page context. Receives args/context via payload.",
    },
    args: {},
  },
  required: ["evaluate_code"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true },
    result: {},
  },
  required: ["context", "result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserEvaluateTaskInput = FromSchema<typeof inputSchema> &
  BrowserTaskInputCommon &
  Record<string, unknown>;
export type BrowserEvaluateTaskOutput = FromSchema<typeof outputSchema>;

export class BrowserEvaluateTask extends Task<
  BrowserEvaluateTaskInput,
  BrowserEvaluateTaskOutput,
  TaskConfig
> {
  public static readonly type = "BrowserEvaluateTask";
  public static readonly category = "Browser";
  public static readonly title = "Browser Evaluate";
  public static readonly description =
    "Runs trusted JavaScript in page context using payload { args, context }";
  public static readonly cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  public async execute(input: BrowserEvaluateTaskInput, executeContext: IExecuteContext) {
    const manager = getBrowserSessionManagerFromContext(executeContext);
    const sessionId = resolveSessionId(input, true)!;

    return await manager.runExclusive(sessionId, async () => {
      const session = manager.getSessionOrThrow(sessionId);
      const timeoutMs = input.timeout_ms ?? 30000;
      const context = cloneContext(input.context);
      const payload = { args: input.args, context };

      const evaluateFn = new Function(
        "payload",
        `"use strict"; const { args, context } = payload; ${input.evaluate_code}`
      ) as (payload: unknown) => unknown;

      const result = await withTimeout(
        session.page.evaluate(evaluateFn, payload),
        timeoutMs,
        `BrowserEvaluateTask timed out after ${timeoutMs}ms`
      );

      const currentUrl = session.page.url?.() ?? "";
      let title = "";
      try {
        title = (await session.page.title?.()) ?? "";
      } catch {
        title = "";
      }

      return {
        context: setBrowserMetadata(context, {
          session_id: sessionId,
          url: currentUrl,
          title,
        }),
        result,
      };
    });
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    browserEvaluate: CreateWorkflow<BrowserEvaluateTaskInput, BrowserEvaluateTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.browserEvaluate = CreateWorkflow(BrowserEvaluateTask);
