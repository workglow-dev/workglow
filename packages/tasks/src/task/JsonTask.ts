/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createGraphFromDependencyJSON,
  CreateWorkflow,
  Dataflow,
  GraphAsTask,
  JsonTaskItem,
  TaskConfig,
  TaskConfigurationError,
  TaskRegistry,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    json: {
      type: "string",
      title: "JSON",
      description: "The JSON to parse",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type JsonTaskInput = FromSchema<typeof inputSchema>;

const outputSchema = {
  type: "object",
  properties: {
    output: {
      title: "Output",
      description: "Output depends on the generated task graph",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type JsonTaskOutput = FromSchema<typeof outputSchema>;

/**
 * JsonTask is a specialized task that creates and manages task graphs from JSON configurations.
 * It allows dynamic creation of task networks by parsing JSON definitions of tasks and their relationships.
 */
export class JsonTask<
  Input extends JsonTaskInput = JsonTaskInput,
  Output extends JsonTaskOutput = JsonTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends GraphAsTask<Input, Output, Config> {
  public static type = "JsonTask";
  public static category = "Hidden";

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  /**
   * Regenerates the entire task graph based on the current JSON input
   * Creates task nodes and establishes data flow connections between them
   */
  public regenerateGraph() {
    if (!this.runInputData.json) return;
    let data = JSON.parse(this.runInputData.json) as JsonTaskItem[] | JsonTaskItem;
    if (!Array.isArray(data)) data = [data];
    const jsonItems: JsonTaskItem[] = data as JsonTaskItem[];

    // Create task nodes
    this.subGraph = createGraphFromDependencyJSON(jsonItems);

    // Establish data flow connections
    for (const item of jsonItems) {
      if (!item.dependencies) continue;
      for (const [input, dependency] of Object.entries(item.dependencies)) {
        const dependencies = Array.isArray(dependency) ? dependency : [dependency];
        for (const dep of dependencies) {
          const sourceTask = this.subGraph.getTask(dep.id);
          if (!sourceTask) {
            throw new TaskConfigurationError(`Dependency id ${dep.id} not found`);
          }
          const df = new Dataflow(sourceTask.config.id, dep.output, item.id, input);
          this.subGraph.addDataflow(df);
        }
      }
    }
    super.regenerateGraph();
  }
}

// Register JsonTask with the task registry
TaskRegistry.registerTask(JsonTask);

/**
 * Convenience function to create and run a JsonTask
 */
export const json = (input: JsonTaskInput, config: TaskConfig = {}) => {
  return new JsonTask({} as JsonTaskInput, config).run(input);
};

// Add Json task workflow to Workflow interface
declare module "@workglow/task-graph" {
  interface Workflow {
    json: CreateWorkflow<JsonTaskInput, JsonTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.json = CreateWorkflow(JsonTask);
