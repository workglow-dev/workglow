/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util";
import { compileSchema, SchemaNode } from "@workglow/util";
import { DATAFLOW_ALL_PORTS } from "../task-graph/Dataflow";
import { TaskGraph } from "../task-graph/TaskGraph";
import { CompoundMergeStrategy, PROPERTY_ARRAY } from "../task-graph/TaskGraphRunner";
import { GraphAsTaskRunner } from "./GraphAsTaskRunner";
import type { IExecuteContext } from "./ITask";
import type { StreamEvent, StreamFinish } from "./StreamTypes";
import { Task } from "./Task";
import type { JsonTaskItem, TaskGraphItemJson } from "./TaskJSON";
import {
  TaskConfigSchema,
  type TaskConfig,
  type TaskIdType,
  type TaskInput,
  type TaskOutput,
  type TaskTypeName,
} from "./TaskTypes";

export const graphAsTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    compoundMerge: { type: "string" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type GraphAsTaskConfig = TaskConfig & {
  /** subGraph is extracted in the constructor before validation — not in the JSON schema */
  subGraph?: TaskGraph;
  compoundMerge?: CompoundMergeStrategy;
};

/**
 * A task that contains a subgraph of tasks
 */
export class GraphAsTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends GraphAsTaskConfig = GraphAsTaskConfig,
> extends Task<Input, Output, Config> {
  // ========================================================================
  // Static properties - should be overridden by subclasses
  // ========================================================================

  public static type: TaskTypeName = "GraphAsTask";
  public static title: string = "Group";
  public static description: string = "A group of tasks that are executed together";
  public static category: string = "Flow Control";
  public static compoundMerge: CompoundMergeStrategy = PROPERTY_ARRAY;

  /** This task has dynamic schemas that change based on the subgraph structure */
  public static hasDynamicSchemas: boolean = true;

  // ========================================================================
  // Constructor
  // ========================================================================

  constructor(input: Partial<Input> = {}, config: Partial<Config> = {}) {
    const { subGraph, ...rest } = config;
    super(input, rest as Config);
    if (subGraph) {
      this.subGraph = subGraph;
    }
    this.regenerateGraph();
  }

  // ========================================================================
  // TaskRunner delegation - Executes and manages the task
  // ========================================================================

  declare _runner: GraphAsTaskRunner<Input, Output, Config>;

  /**
   * Task runner for handling the task execution
   */
  override get runner(): GraphAsTaskRunner<Input, Output, Config> {
    if (!this._runner) {
      this._runner = new GraphAsTaskRunner<Input, Output, Config>(this);
    }
    return this._runner;
  }

  // ========================================================================
  // Static to Instance conversion methods
  // ========================================================================

  public static configSchema(): DataPortSchema {
    return graphAsTaskConfigSchema;
  }

  public get compoundMerge(): CompoundMergeStrategy {
    return this.config?.compoundMerge || (this.constructor as typeof GraphAsTask).compoundMerge;
  }

  public get cacheable(): boolean {
    return (
      this.runConfig?.cacheable ??
      this.config?.cacheable ??
      ((this.constructor as typeof GraphAsTask).cacheable && !this.hasChildren())
    );
  }

  // ========================================================================
  // Input/Output handling
  // ========================================================================

  /**
   * Override inputSchema to compute it dynamically from the subgraph at runtime
   * The input schema is the union of all unconnected inputs from starting nodes
   * (nodes with zero incoming connections)
   */
  public inputSchema(): DataPortSchema {
    // If there's no subgraph or it has no children, fall back to the static schema
    if (!this.hasChildren()) {
      return (this.constructor as typeof Task).inputSchema();
    }

    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Get all tasks in the graph
    const tasks = this.subGraph.getTasks();

    // Identify starting nodes: tasks with no incoming dataflows
    const startingNodes = tasks.filter(
      (task) => this.subGraph.getSourceDataflows(task.config.id).length === 0
    );

    // For starting nodes only, collect their unconnected inputs
    for (const task of startingNodes) {
      const taskInputSchema = task.inputSchema();
      if (typeof taskInputSchema === "boolean") {
        if (taskInputSchema === false) {
          continue;
        }
        if (taskInputSchema === true) {
          properties[DATAFLOW_ALL_PORTS] = {};
          continue;
        }
      }
      const taskProperties = taskInputSchema.properties || {};

      // Add all inputs from starting nodes to the graph's input schema
      for (const [inputName, inputProp] of Object.entries(taskProperties)) {
        // If the same input name exists in multiple nodes, we use the first one
        // In a more sophisticated implementation, we might want to merge or validate compatibility
        if (!properties[inputName]) {
          properties[inputName] = inputProp;

          // Check if this input is required
          if (taskInputSchema.required && taskInputSchema.required.includes(inputName)) {
            required.push(inputName);
          }
        }
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  protected _inputSchemaNode: SchemaNode | undefined;
  /**
   * Gets the compiled input schema
   */
  protected override getInputSchemaNode(type: TaskTypeName): SchemaNode {
    // every graph as task is different, so we need to compile the schema for each one
    if (!this._inputSchemaNode) {
      const dataPortSchema = this.inputSchema();
      const schemaNode = Task.generateInputSchemaNode(dataPortSchema);
      try {
        this._inputSchemaNode = schemaNode;
      } catch (error) {
        // If compilation fails, fall back to accepting any object structure
        // This is a safety net for schemas that json-schema-library can't compile
        console.warn(
          `Failed to compile input schema for ${type}, falling back to permissive validation:`,
          error
        );
        this._inputSchemaNode = compileSchema({});
      }
    }
    return this._inputSchemaNode!;
  }

  /**
   * Calculates the depth (longest path from any starting node) for each task in the graph
   * @returns A map of task IDs to their depths
   */
  private calculateNodeDepths(): Map<TaskIdType, number> {
    const depths = new Map<TaskIdType, number>();
    const tasks = this.subGraph.getTasks();

    // Initialize all depths to 0
    for (const task of tasks) {
      depths.set(task.config.id, 0);
    }

    // Use topological sort to calculate depths in order
    const sortedTasks = this.subGraph.topologicallySortedNodes();

    for (const task of sortedTasks) {
      const currentDepth = depths.get(task.config.id) || 0;
      const targetTasks = this.subGraph.getTargetTasks(task.config.id);

      // Update depths of all target tasks
      for (const targetTask of targetTasks) {
        const targetDepth = depths.get(targetTask.config.id) || 0;
        depths.set(targetTask.config.id, Math.max(targetDepth, currentDepth + 1));
      }
    }

    return depths;
  }

  /**
   * Override outputSchema to compute it dynamically from the subgraph at runtime
   * The output schema depends on the compoundMerge strategy and the nodes at the last level
   */
  public override outputSchema(): DataPortSchema {
    // If there's no subgraph or it has no children, fall back to the static schema
    if (!this.hasChildren()) {
      return (this.constructor as typeof Task).outputSchema();
    }

    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Find all ending nodes (nodes with no outgoing dataflows)
    const tasks = this.subGraph.getTasks();
    const endingNodes = tasks.filter(
      (task) => this.subGraph.getTargetDataflows(task.config.id).length === 0
    );

    // Calculate depths for all nodes
    const depths = this.calculateNodeDepths();

    // Find the maximum depth among ending nodes
    const maxDepth = Math.max(...endingNodes.map((task) => depths.get(task.config.id) || 0));

    // Filter ending nodes to only those at the maximum depth (last level)
    const lastLevelNodes = endingNodes.filter((task) => depths.get(task.config.id) === maxDepth);

    // ONLY handle PROPERTY_ARRAY strategy
    // Count how many ending nodes produce each property
    const propertyCount: Record<string, number> = {};
    const propertySchema: Record<string, any> = {};

    for (const task of lastLevelNodes) {
      const taskOutputSchema = task.outputSchema();
      if (typeof taskOutputSchema === "boolean") {
        if (taskOutputSchema === false) {
          continue;
        }
        if (taskOutputSchema === true) {
          properties[DATAFLOW_ALL_PORTS] = {};
          continue;
        }
      }
      const taskProperties = taskOutputSchema.properties || {};

      for (const [outputName, outputProp] of Object.entries(taskProperties)) {
        propertyCount[outputName] = (propertyCount[outputName] || 0) + 1;
        // Store the first schema we encounter for each property
        if (!propertySchema[outputName]) {
          propertySchema[outputName] = outputProp;
        }
      }
    }

    // Build the final schema: properties produced by multiple nodes become arrays
    for (const [outputName, count] of Object.entries(propertyCount)) {
      const outputProp = propertySchema[outputName];

      if (lastLevelNodes.length === 1) {
        // Single ending node: use property as-is
        properties[outputName] = outputProp;
      } else {
        // Multiple ending nodes: all properties become arrays due to collectPropertyValues
        properties[outputName] = {
          type: "array",
          items: outputProp as any,
        };
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    } as DataPortSchema;
  }

  /**
   * Resets input data to defaults
   */
  public resetInputData(): void {
    super.resetInputData();
    if (this.hasChildren()) {
      this.subGraph!.getTasks().forEach((node) => {
        node.resetInputData();
      });
      this.subGraph!.getDataflows().forEach((dataflow) => {
        dataflow.reset();
      });
    }
  }

  // ========================================================================
  //  Streaming pass-through
  // ========================================================================

  /**
   * Stream pass-through for compound tasks: runs the subgraph and forwards
   * streaming events from ending nodes to the outer graph. Also re-yields
   * any input streams from upstream for cases where this GraphAsTask is
   * itself downstream of another streaming task.
   */
  async *executeStream(input: Input, context: IExecuteContext): AsyncIterable<StreamEvent<Output>> {
    // Forward upstream input streams first (pass-through from outer graph)
    if (context.inputStreams) {
      for (const [, stream] of context.inputStreams) {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.type === "finish") continue;
            yield value as StreamEvent<Output>;
          }
        } finally {
          reader.releaseLock();
        }
      }
    }

    // Run the subgraph and forward streaming events from ending nodes
    if (this.hasChildren()) {
      const endingNodeIds = new Set<unknown>();
      const tasks = this.subGraph.getTasks();
      for (const task of tasks) {
        if (this.subGraph.getTargetDataflows(task.config.id).length === 0) {
          endingNodeIds.add(task.config.id);
        }
      }

      const eventQueue: StreamEvent<Output>[] = [];
      let resolveWaiting: (() => void) | undefined;
      let subgraphDone = false;

      const unsub = this.subGraph.subscribeToTaskStreaming({
        onStreamChunk: (taskId, event) => {
          if (endingNodeIds.has(taskId) && event.type !== "finish") {
            eventQueue.push(event as StreamEvent<Output>);
            resolveWaiting?.();
          }
        },
      });

      const runPromise = this.subGraph
        .run<Output>(input, { parentSignal: context.signal, accumulateLeafOutputs: false })
        .then((results) => {
          subgraphDone = true;
          resolveWaiting?.();
          return results;
        });

      // Yield events as they arrive from ending nodes
      while (!subgraphDone) {
        if (eventQueue.length === 0) {
          await new Promise<void>((resolve) => {
            resolveWaiting = resolve;
          });
        }
        while (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        }
      }
      // Drain any remaining events
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }

      unsub();

      const results = await runPromise;
      const mergedOutput = this.subGraph.mergeExecuteOutputsToRunOutput(
        results,
        this.compoundMerge
      ) as Output;
      yield { type: "finish", data: mergedOutput } as StreamFinish<Output>;
    } else {
      yield { type: "finish", data: input as unknown as Output } as StreamFinish<Output>;
    }
  }

  // ========================================================================
  //  Compound task methods
  // ========================================================================

  /**
   * Regenerates the subtask graph and emits a "regenerate" event
   *
   * Subclasses should override this method to implement the actual graph
   * regeneration logic, but all they need to do is call this method to
   * emit the "regenerate" event.
   */
  public regenerateGraph(): void {
    this._inputSchemaNode = undefined;
    this.events.emit("regenerate");
  }

  // ========================================================================
  // Serialization methods
  // ========================================================================

  /**
   * Serializes the task and its subtasks into a format that can be stored
   * @returns The serialized task and subtasks
   */
  public toJSON(): TaskGraphItemJson {
    let json = super.toJSON();
    const hasChildren = this.hasChildren();
    if (hasChildren) {
      json = {
        ...json,
        merge: this.compoundMerge,
        subgraph: this.subGraph!.toJSON(),
      };
    }
    return json;
  }

  /**
   * Converts the task to a JSON format suitable for dependency tracking
   * @returns The task and subtasks in JSON thats easier for humans to read
   */
  public toDependencyJSON(): JsonTaskItem {
    const json = this.toJSON();
    if (this.hasChildren()) {
      if ("subgraph" in json) {
        delete json.subgraph;
      }
      return { ...json, subtasks: this.subGraph!.toDependencyJSON() };
    }
    return json;
  }
}
