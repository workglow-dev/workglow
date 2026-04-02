/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  Task,
  TaskConfig,
  TaskConfigSchema,
  TaskInvalidInputError,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { Interpreter } from "../util/interpreter";

const isValidIdentifier = (key: string) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key);

const configSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    javascript_code: {
      type: "string",
      title: "Code",
      minLength: 1,
      description: "JavaScript code to execute",
      format: "code:javascript",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const inputSchema = {
  type: "object",
  properties: {
    javascript_code: {
      type: "string",
      title: "Code",
      minLength: 1,
      description: "JavaScript code to execute",
      format: "code:javascript",
    },
  },
  required: ["javascript_code"],
  additionalProperties: true,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    output: {
      title: "Output",
      description: "The output of the JavaScript code",
    },
  },
  required: ["output"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type JavaScriptTaskInput = FromSchema<typeof inputSchema>;
export type JavaScriptTaskOutput = FromSchema<typeof outputSchema>;
export type JavaScriptTaskConfig = TaskConfig & {
  javascript_code?: string;
};

export class JavaScriptTask extends Task<
  JavaScriptTaskInput,
  JavaScriptTaskOutput,
  JavaScriptTaskConfig
> {
  public static override type = "JavaScriptTask";
  public static override category = "Utility";
  public static override title = "JavaScript Interpreter";
  public static override description = "Executes JavaScript code in a sandboxed interpreter environment";
  public static override customizable = true;

  public static override configSchema() {
    return configSchema;
  }

  public static override inputSchema() {
    return inputSchema;
  }

  public static override outputSchema() {
    return outputSchema;
  }

  constructor(config: Partial<JavaScriptTaskConfig> = {}) {
    super(config);
  }

  public override inputSchema() {
    if (this.config?.javascript_code) {
      if (this.config.inputSchema) {
        return this.config.inputSchema;
      }
      return {
        type: "object",
        properties: {},
        additionalProperties: true,
      } as const satisfies DataPortSchema;
    }
    return inputSchema;
  }

  override async executeReactive(input: JavaScriptTaskInput, output: JavaScriptTaskOutput) {
    const code = input.javascript_code || this.config.javascript_code;
    if (code) {
      try {
        const inputVariables = Object.keys(input)
          .filter((key) => key !== "javascript_code")
          .filter(isValidIdentifier);
        const inputVariablesString = inputVariables
          .map((key) => `var ${key} = ${JSON.stringify(input[key])};`)
          .join("\n");
        const myInterpreter = new Interpreter(`${inputVariablesString} ${code}`);
        myInterpreter.run();
        output.output = myInterpreter.value;
      } catch (e) {
        throw new TaskInvalidInputError(
          `JavaScript execution failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    return output;
  }
}

export const javaScript = (input: JavaScriptTaskInput, config: TaskConfig = {}) => {
  return new JavaScriptTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    javaScript: CreateWorkflow<JavaScriptTaskInput, JavaScriptTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.javaScript = CreateWorkflow(JavaScriptTask);
