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
import { DataPortSchema, FromSchema } from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    value: {
      type: "string",
      title: "Value",
      description: "Input string to match against",
    },
    pattern: {
      type: "string",
      title: "Pattern",
      description: "Regular expression pattern",
    },
    flags: {
      type: "string",
      title: "Flags",
      description: "Regex flags (e.g. 'g', 'i', 'gi')",
      default: "",
    },
  },
  required: ["value", "pattern"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    match: {
      type: "boolean",
      title: "Match",
      description: "Whether the pattern matched",
    },
    matches: {
      type: "array",
      items: { type: "string" },
      title: "Matches",
      description: "Array of matched strings (full matches when global, groups when not)",
    },
  },
  required: ["match", "matches"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type RegexTaskInput = FromSchema<typeof inputSchema>;
export type RegexTaskOutput = FromSchema<typeof outputSchema>;

export class RegexTask<
  Input extends RegexTaskInput = RegexTaskInput,
  Output extends RegexTaskOutput = RegexTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "RegexTask";
  static readonly category = "String";
  public static title = "Regex";
  public static description = "Matches a string against a regular expression pattern";

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
    const flags = input.flags ?? "";
    const regex = new RegExp(input.pattern, flags);

    if (flags.includes("g")) {
      const allMatches = Array.from(input.value.matchAll(new RegExp(input.pattern, flags)));
      return {
        match: allMatches.length > 0,
        matches: allMatches.map((m) => m[0]),
      } as Output;
    }

    const result = regex.exec(input.value);
    if (!result) {
      return { match: false, matches: [] as string[] } as Output;
    }

    // Return full match + captured groups
    return {
      match: true,
      matches: result.slice(0),
    } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    regex: CreateWorkflow<RegexTaskInput, RegexTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.regex = CreateWorkflow(RegexTask);
