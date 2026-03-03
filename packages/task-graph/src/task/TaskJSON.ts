/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServiceRegistry } from "@workglow/util";
import { Dataflow } from "../task-graph/Dataflow";
import { TaskGraph } from "../task-graph/TaskGraph";
import { CompoundMergeStrategy } from "../task-graph/TaskGraphRunner";
import { TaskConfigurationError, TaskJSONError } from "../task/TaskError";
import { getTaskConstructors } from "../task/TaskRegistry";
import { ConditionalTaskConfig } from "./ConditionalTask";
import { GraphAsTask, GraphAsTaskConfig } from "./GraphAsTask";
import { IteratorTaskConfig } from "./IteratorTask";
import { JobQueueTaskConfig } from "./JobQueueTask";
import { MapTaskConfig } from "./MapTask";
import { ReduceTaskConfig } from "./ReduceTask";
import { TaskConfig, TaskInput } from "./TaskTypes";
import { WhileTaskConfig } from "./WhileTask";

// ========================================================================
// JSON Serialization Types
// ========================================================================
/**
 * Represents a single task item in the JSON configuration.
 * This structure defines how tasks should be configured in JSON format.
 */

export type JsonTaskConfig = Omit<
  TaskConfig &
    GraphAsTaskConfig &
    WhileTaskConfig &
    IteratorTaskConfig &
    ReduceTaskConfig &
    MapTaskConfig &
    ConditionalTaskConfig &
    JobQueueTaskConfig,
  "id"
>;

export type JsonTaskItem = {
  /** Unique identifier for the task */
  id: unknown;

  /** Type of task to create */
  type: string;

  /** Optional configuration for the task */
  config?: JsonTaskConfig;

  /** Default input values for the task */
  defaults?: TaskInput;

  /** Defines data flow between tasks */
  dependencies?: {
    /** Input parameter name mapped to source task output */
    [x: string]:
      | {
          /** ID of the source task */
          id: unknown;

          /** Output parameter name from source task */
          output: string;
        }
      | Array<{
          id: unknown;
          output: string;
        }>;
  };

  /** Nested tasks for compound operations */
  subtasks?: JsonTaskItem[];
};

/**
 * Represents a task graph item, which can be a task or a subgraph
 */
export type TaskGraphItemJson = {
  id: unknown;
  type: string;
  defaults?: TaskInput;
  config?: JsonTaskConfig;
  subgraph?: TaskGraphJson;
  merge?: CompoundMergeStrategy;
};

export type TaskGraphJson = {
  tasks: TaskGraphItemJson[];
  dataflows: DataflowJson[];
};

export type DataflowJson = {
  sourceTaskId: unknown;
  sourceTaskPortId: string;
  targetTaskId: unknown;
  targetTaskPortId: string;
};

export interface TaskGraphJsonOptions {
  /** When true, synthetic InputTask/OutputTask boundary nodes are added at each graph level */
  readonly withBoundaryNodes?: boolean;
}

const createSingleTaskFromJSON = (
  item: JsonTaskItem | TaskGraphItemJson,
  registry?: ServiceRegistry
) => {
  if (!item.id) throw new TaskJSONError("Task id required");
  if (!item.type) throw new TaskJSONError("Task type required");
  if (item.defaults && Array.isArray(item.defaults))
    throw new TaskJSONError("Task defaults must be an object");

  const constructors = getTaskConstructors(registry);
  const taskClass = constructors.get(item.type);
  if (!taskClass)
    throw new TaskJSONError(`Task type ${item.type} not found, perhaps not registered?`);

  const taskConfig: TaskConfig = {
    ...item.config,
    id: item.id,
  };
  const task = new taskClass(item.defaults ?? {}, taskConfig, registry ? { registry } : {});
  return task;
};

/**
 * Creates a task instance from a JSON task item configuration
 * Validates required fields and resolves task type from registry
 */
export const createTaskFromDependencyJSON = (item: JsonTaskItem, registry?: ServiceRegistry) => {
  const task = createSingleTaskFromJSON(item, registry);
  if (item.subtasks && item.subtasks.length > 0) {
    if (!(task instanceof GraphAsTask)) {
      throw new TaskConfigurationError("Subgraph is only supported for CompoundTasks");
    }
    task.subGraph = createGraphFromDependencyJSON(item.subtasks, registry);
  }
  return task;
};

/**
 * Creates a task graph from an array of JSON task items
 * Recursively processes subtasks for compound tasks
 */
export const createGraphFromDependencyJSON = (
  jsonItems: JsonTaskItem[],
  registry?: ServiceRegistry
) => {
  const subGraph = new TaskGraph();
  for (const subitem of jsonItems) {
    subGraph.addTask(createTaskFromDependencyJSON(subitem, registry));
  }
  return subGraph;
};

/**
 * Creates a task instance from a task graph item JSON representation
 * @param item The JSON representation of the task
 * @returns A new task instance
 * @throws Error if required fields are missing or invalid
 */
export const createTaskFromGraphJSON = (item: TaskGraphItemJson, registry?: ServiceRegistry) => {
  const task = createSingleTaskFromJSON(item, registry);
  if (item.subgraph) {
    if (!(task instanceof GraphAsTask)) {
      throw new TaskConfigurationError("Subgraph is only supported for GraphAsTask");
    }
    task.subGraph = createGraphFromGraphJSON(item.subgraph, registry);
  }
  return task;
};

/**
 * Creates a TaskGraph instance from its JSON representation
 * @param graphJsonObj The JSON representation of the task graph
 * @returns A new TaskGraph instance with all tasks and data flows
 */
export const createGraphFromGraphJSON = (
  graphJsonObj: TaskGraphJson,
  registry?: ServiceRegistry
) => {
  const subGraph = new TaskGraph();
  for (const subitem of graphJsonObj.tasks) {
    subGraph.addTask(createTaskFromGraphJSON(subitem, registry));
  }
  for (const subitem of graphJsonObj.dataflows) {
    subGraph.addDataflow(
      new Dataflow(
        subitem.sourceTaskId,
        subitem.sourceTaskPortId,
        subitem.targetTaskId,
        subitem.targetTaskPortId
      )
    );
  }
  return subGraph;
};
