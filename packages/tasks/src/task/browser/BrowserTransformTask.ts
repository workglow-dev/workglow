/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
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
    data: {},
    transform_code: {
      type: "string",
      minLength: 1,
      format: "code:javascript",
      description:
        "Trusted JavaScript executed in host context. Receives input/context/data and can return data or {context,data}.",
    },
  },
  required: ["transform_code"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: { type: "object", additionalProperties: true },
    data: {},
  },
  required: ["context", "data"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BrowserTransformTaskInput = FromSchema<typeof inputSchema> &
  BrowserTaskInputCommon &
  Record<string, unknown>;
export type BrowserTransformTaskOutput = FromSchema<typeof outputSchema>;

function asContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export class BrowserTransformTask extends Task<
  BrowserTransformTaskInput,
  BrowserTransformTaskOutput,
  TaskConfig
> {
  public static readonly type = "BrowserTransformTask";
  public static readonly category = "Browser";
  public static readonly title = "Browser Transform";
  public static readonly description =
    "Runs trusted host-side JavaScript with payload { input, context, data }";
  public static readonly cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  public async execute(input: BrowserTransformTaskInput): Promise<BrowserTransformTaskOutput> {
    let context = cloneContext(input.context);
    const sessionId = resolveSessionId(input, false);
    if (sessionId) {
      context = setBrowserMetadata(context, { session_id: sessionId });
    }

    const transformFn = new Function(
      "payload",
      `"use strict"; const { input, context, data } = payload; ${input.transform_code}`
    ) as (payload: unknown) => unknown;

    const timeoutMs = input.timeout_ms ?? 30000;
    const payload = { input, context, data: input.data };
    const result = await withTimeout(
      Promise.resolve(transformFn(payload)),
      timeoutMs,
      `BrowserTransformTask timed out after ${timeoutMs}ms`
    );

    let outputContext = context;
    let outputData = input.data;
    if (result !== undefined) {
      if (typeof result === "object" && result !== null && !Array.isArray(result)) {
        const value = result as Record<string, unknown>;
        const hasContextKey = Object.prototype.hasOwnProperty.call(value, "context");
        const hasDataKey = Object.prototype.hasOwnProperty.call(value, "data");
        if (hasContextKey || hasDataKey) {
          outputContext = hasContextKey ? asContext(value.context) : outputContext;
          outputData = hasDataKey ? value.data : outputData;
        } else {
          outputData = result;
        }
      } else {
        outputData = result;
      }
    }

    return {
      context: outputContext,
      data: outputData,
    };
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    browserTransform: CreateWorkflow<BrowserTransformTaskInput, BrowserTransformTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.browserTransform = CreateWorkflow(BrowserTransformTask);
