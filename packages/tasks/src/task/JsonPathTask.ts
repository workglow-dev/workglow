/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteReactiveContext,
  Task,
  TaskConfig,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {
    value: {
      title: "Value",
      description: "Input object or array to query",
    },
    path: {
      type: "string",
      title: "Path",
      description: "Dot-notation path to extract (e.g. 'a.b.c', 'items.0.name', 'items.*.name')",
    },
  },
  required: ["value", "path"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      title: "Result",
      description: "Extracted value(s) from the path",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type JsonPathTaskInput = FromSchema<typeof inputSchema>;
export type JsonPathTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Resolves a dot-notation path against an object. Supports wildcard '*' for
 * iterating over array elements or object keys at a given level.
 */
function resolvePath(obj: unknown, segments: readonly string[]): unknown {
  if (segments.length === 0) return obj;

  const [head, ...tail] = segments;

  if (head === "*") {
    if (Array.isArray(obj)) {
      return obj.map((item) => resolvePath(item, tail));
    }
    if (obj !== null && typeof obj === "object") {
      return Object.values(obj).map((v) => resolvePath(v, tail));
    }
    return undefined;
  }

  if (obj === null || obj === undefined || typeof obj !== "object") {
    return undefined;
  }

  const next = (obj as Record<string, unknown>)[head];
  return resolvePath(next, tail);
}

export class JsonPathTask<
  Input extends JsonPathTaskInput = JsonPathTaskInput,
  Output extends JsonPathTaskOutput = JsonPathTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "JsonPathTask";
  static readonly category = "Utility";
  public static title = "JSON Path";
  public static description = "Extracts a value from an object using a dot-notation path";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async executeReactive(
    input: Input,
    _output: Output,
    _context: IExecuteReactiveContext
  ): Promise<Output> {
    const segments = input.path.split(".");
    const result = resolvePath(input.value, segments);
    return { result } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    jsonPath: CreateWorkflow<JsonPathTaskInput, JsonPathTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.jsonPath = CreateWorkflow(JsonPathTask);
