/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createGraphFromDependencyJSON,
  createGraphFromGraphJSON,
  CreateWorkflow,
  Dataflow,
  GraphAsTask,
  JsonTaskItem,
  TaskConfig,
  TaskConfigurationError,
  type TaskGraphJson,
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
  public static title = "JSON Task";
  public static description =
    "A task that creates and manages task graphs from JSON configurations";

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
    const data = JSON.parse(this.runInputData.json) as
      | TaskGraphJson
      | JsonTaskItem[]
      | JsonTaskItem;

    // Graph format: { tasks, dataflows } (e.g. from builder export)
    if (
      data &&
      typeof data === "object" &&
      "tasks" in data &&
      Array.isArray((data as TaskGraphJson).tasks) &&
      "dataflows" in data &&
      Array.isArray((data as TaskGraphJson).dataflows)
    ) {
      this.subGraph = createGraphFromGraphJSON(data as TaskGraphJson);
      super.regenerateGraph();
      return;
    }

    // Dependency format: array of JsonTaskItem (or single item)
    let jsonItems: JsonTaskItem[] = Array.isArray(data) ? data : [data as JsonTaskItem];
    this.subGraph = createGraphFromDependencyJSON(jsonItems);

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

/**
 * Convenience function to create and run a JsonTask
 */
export const json = (input: JsonTaskInput, config: TaskConfig = {}) => {
  return new JsonTask({}, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    json: CreateWorkflow<JsonTaskInput, JsonTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.json = CreateWorkflow(JsonTask);
