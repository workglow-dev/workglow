/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, Task, TaskConfig, TaskRegistry, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { Interpreter } from "../util/interpreter";

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

export class JavaScriptTask extends Task<JavaScriptTaskInput, JavaScriptTaskOutput> {
  public static type = "JavaScriptTask";
  public static category = "Utility";
  public static title = "JavaScript Interpreter";
  public static description = "Executes JavaScript code in a sandboxed interpreter environment";

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async executeReactive(input: JavaScriptTaskInput, output: JavaScriptTaskOutput) {
    if (input.javascript_code) {
      try {
        const inputVariables = Object.keys(input).filter((key) => key !== "javascript_code");
        const inputVariablesString = inputVariables
          .map((key) => `var ${key} = ${JSON.stringify(input[key])};`)
          .join("\n");
        const myInterpreter = new Interpreter(`${inputVariablesString} ${input.javascript_code}`);
        myInterpreter.run();
        output.output = myInterpreter.value;
        console.log("output", output.output);
      } catch (e) {
        console.error("error", e);
      }
    }
    return output;
  }
}

TaskRegistry.registerTask(JavaScriptTask);

export const javaScript = (input: JavaScriptTaskInput, config: TaskConfig = {}) => {
  return new JavaScriptTask({}, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    javaScript: CreateWorkflow<JavaScriptTaskInput, JavaScriptTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.javaScript = CreateWorkflow(JavaScriptTask);
