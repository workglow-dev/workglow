/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { compileSchema, SchemaNode } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util";
import { computeGraphInputSchema, computeGraphOutputSchema } from "../task-graph/GraphSchemaUtils";
import { TaskGraph } from "../task-graph/TaskGraph";
import { CompoundMergeStrategy, PROPERTY_ARRAY } from "../task-graph/TaskGraphRunner";
import type { CreateLoopWorkflow, Workflow } from "../task-graph/Workflow";
import { GraphAsTaskRunner } from "./GraphAsTaskRunner";
import type { IExecuteContext } from "./ITask";
import type { StreamEvent, StreamFinish } from "./StreamTypes";
import { Task } from "./Task";
import type { JsonTaskItem, TaskGraphItemJson, TaskGraphJsonOptions } from "./TaskJSON";
import {
  TaskConfigSchema,
  type TaskConfig,
  type TaskInput,
  type TaskOutput,
  type TaskTypeName,
} from "./TaskTypes";

export const graphAsTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    compoundMerge: { type: "string", "x-ui-hidden": true },
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
   * Override inputSchema to compute it dynamically from the subgraph at runtime.
   * For root tasks (no incoming edges) all input properties are collected.
   * For non-root tasks, only REQUIRED properties that are not satisfied by
   * any internal dataflow are added — this ensures that required inputs are
   * included in the graph's input schema without pulling in every optional
   * downstream property.
   */
  public inputSchema(): DataPortSchema {
    // If there's no subgraph or it has no children, fall back to the static schema
    if (!this.hasChildren()) {
      return (this.constructor as typeof Task).inputSchema();
    }

    return computeGraphInputSchema(this.subGraph);
  }

  protected _inputSchemaNode: SchemaNode | undefined;
  /**
   * Gets the compiled input schema
   */
  protected override getInputSchemaNode(): SchemaNode {
    // every graph as task is different, so we need to compile the schema for each one
    if (!this._inputSchemaNode) {
      try {
        const dataPortSchema = this.inputSchema();
        const schemaNode = Task.generateInputSchemaNode(dataPortSchema);
        this._inputSchemaNode = schemaNode;
      } catch (error) {
        // If compilation fails, fall back to accepting any object structure
        // This is a safety net for schemas that json-schema-library can't compile
        console.warn(
          `Failed to compile input schema for ${this.type}, falling back to permissive validation:`,
          error
        );
        this._inputSchemaNode = compileSchema({});
      }
    }
    return this._inputSchemaNode!;
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

    return computeGraphOutputSchema(this.subGraph);
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
        if (this.subGraph.getTargetDataflows(task.id).length === 0) {
          endingNodeIds.add(task.id);
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
  public override toJSON(options?: TaskGraphJsonOptions): TaskGraphItemJson {
    let json = super.toJSON(options);
    const hasChildren = this.hasChildren();
    if (hasChildren) {
      json = {
        ...json,
        merge: this.compoundMerge,
        subgraph: this.subGraph!.toJSON(options),
      };
    }
    return json;
  }

  /**
   * Converts the task to a JSON format suitable for dependency tracking
   * @returns The task and subtasks in JSON thats easier for humans to read
   */
  public override toDependencyJSON(options?: TaskGraphJsonOptions): JsonTaskItem {
    const json = this.toJSON(options);
    if (this.hasChildren()) {
      if ("subgraph" in json) {
        delete json.subgraph;
      }
      return { ...json, subtasks: this.subGraph!.toDependencyJSON(options) };
    }
    return json;
  }
}

declare module "../task-graph/Workflow" {
  interface Workflow {
    /**
     * Starts a group that wraps inner tasks in a GraphAsTask subgraph.
     * Use .endGroup() to close the group and return to the parent workflow.
     */
    group: CreateLoopWorkflow<TaskInput, TaskOutput, GraphAsTaskConfig>;

    /**
     * Ends the group and returns to the parent workflow.
     */
    endGroup(): Workflow;
  }
}

queueMicrotask(async () => {
  const { CreateLoopWorkflow, CreateEndLoopWorkflow, Workflow } =
    await import("../task-graph/Workflow");
  Workflow.prototype.group = CreateLoopWorkflow(GraphAsTask);
  Workflow.prototype.endGroup = CreateEndLoopWorkflow("endGroup");
});
