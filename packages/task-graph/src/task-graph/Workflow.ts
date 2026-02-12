/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter, JsonSchema, uuid4, type EventParameters } from "@workglow/util";
import { TaskOutputRepository } from "../storage/TaskOutputRepository";
import { GraphAsTask } from "../task/GraphAsTask";
import type { ITask, ITaskConstructor } from "../task/ITask";
import { Task } from "../task/Task";
import { WorkflowError } from "../task/TaskError";
import type { JsonTaskItem, TaskGraphJson } from "../task/TaskJSON";
import { DataPorts, TaskConfig } from "../task/TaskTypes";
import { getLastTask, parallel, pipe, PipeFunction, Taskish } from "./Conversions";
import { Dataflow, DATAFLOW_ALL_PORTS } from "./Dataflow";
import { IWorkflow } from "./IWorkflow";
import { TaskGraph } from "./TaskGraph";
import {
  CompoundMergeStrategy,
  PROPERTY_ARRAY,
  type PropertyArrayGraphResult,
} from "./TaskGraphRunner";

// Type definitions for the workflow
export type CreateWorkflow<I extends DataPorts, O extends DataPorts, C extends TaskConfig> = (
  input?: Partial<I>,
  config?: Partial<C>
) => Workflow<I, O>;

export function CreateWorkflow<
  I extends DataPorts,
  O extends DataPorts,
  C extends TaskConfig = TaskConfig,
>(taskClass: ITaskConstructor<I, O, C>): CreateWorkflow<I, O, C> {
  return Workflow.createWorkflow<I, O, C>(taskClass);
}

/**
 * Type for loop workflow methods (map, while, reduce).
 * Represents the method signature with proper `this` context.
 * Loop methods take only a config parameter - input is not used for loop tasks.
 */
export type CreateLoopWorkflow<
  I extends DataPorts,
  O extends DataPorts,
  C extends TaskConfig = TaskConfig,
> = (this: Workflow<I, O>, config?: Partial<C>) => Workflow<I, O>;

/**
 * Factory function that creates a loop workflow method for a given task class.
 * Returns a method that can be assigned to Workflow.prototype.
 *
 * @param taskClass - The iterator task class (MapTask, ReduceTask, etc.)
 * @returns A method that creates the task and returns a loop builder workflow
 */
export function CreateLoopWorkflow<
  I extends DataPorts,
  O extends DataPorts,
  C extends TaskConfig = TaskConfig,
>(taskClass: ITaskConstructor<I, O, C>): CreateLoopWorkflow<I, O, C> {
  return function (this: Workflow<I, O>, config: Partial<C> = {}): Workflow<I, O> {
    return this.addLoopTask(taskClass, config);
  };
}

/**
 * Type for end loop workflow methods (endMap, endBatch, etc.).
 */
export type EndLoopWorkflow = (this: Workflow) => Workflow;

/**
 * Factory function that creates an end loop workflow method.
 *
 * @param methodName - The name of the method (for error messages)
 * @returns A method that finalizes the loop and returns to the parent workflow
 */
export function CreateEndLoopWorkflow(methodName: string): EndLoopWorkflow {
  return function (this: Workflow): Workflow {
    if (!this.isLoopBuilder) {
      throw new Error(`${methodName}() can only be called on loop workflows`);
    }
    return this.finalizeAndReturn();
  };
}

const TYPED_ARRAY_FORMAT_PREFIX = "TypedArray";

/**
 * Returns true if the given JSON schema (or any nested schema) has a format
 * string starting with "TypedArray" (e.g. "TypedArray" or "TypedArray:Float32Array").
 * Walks oneOf/anyOf wrappers and array items.
 */
function schemaHasTypedArrayFormat(schema: JsonSchema): boolean {
  if (typeof schema === "boolean") return false;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;

  const s = schema as Record<string, unknown>;
  if (typeof s.format === "string" && s.format.startsWith(TYPED_ARRAY_FORMAT_PREFIX)) {
    return true;
  }

  const checkUnion = (schemas: unknown): boolean => {
    if (!Array.isArray(schemas)) return false;
    return schemas.some((sub) => schemaHasTypedArrayFormat(sub as JsonSchema));
  };
  if (checkUnion(s.oneOf) || checkUnion(s.anyOf)) return true;

  const items = s.items;
  if (items && typeof items === "object" && !Array.isArray(items)) {
    if (schemaHasTypedArrayFormat(items as JsonSchema)) return true;
  }

  return false;
}

/**
 * Returns true if the task's output schema has any port with TypedArray format.
 * Used by adaptive workflow methods to choose scalar vs vector task variant.
 */
export function hasVectorOutput(task: ITask): boolean {
  const outputSchema = task.outputSchema();
  if (typeof outputSchema === "boolean" || !outputSchema?.properties) return false;
  return Object.values(outputSchema.properties).some((prop) =>
    schemaHasTypedArrayFormat(prop as JsonSchema)
  );
}

/**
 * Returns true if the input object looks like vector task input: has a "vectors"
 * property that is an array with at least one TypedArray element. Used by
 * adaptive workflow methods so that e.g. sum({ vectors: [new Float32Array(...)] })
 * chooses the vector variant even with no previous task.
 */
export function hasVectorLikeInput(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const v = (input as Record<string, unknown>).vectors;
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof v[0] === "object" &&
    v[0] !== null &&
    ArrayBuffer.isView(v[0])
  );
}

/**
 * Type for adaptive workflow methods that dispatch to scalar or vector variant
 * based on the previous task's output schema.
 */
export type CreateAdaptiveWorkflow<
  IS extends DataPorts,
  OS extends DataPorts,
  IV extends DataPorts,
  OV extends DataPorts,
  CS extends TaskConfig = TaskConfig,
  CV extends TaskConfig = TaskConfig,
> = (
  this: Workflow,
  input?: Partial<IS> & Partial<IV>,
  config?: Partial<CS> & Partial<CV>
) => Workflow;

/**
 * Factory that creates an adaptive workflow method: when called, inspects the
 * output schema of the last task in the chain and delegates to the vector
 * variant if it has TypedArray output, otherwise to the scalar variant.
 * If there is no previous task, defaults to the scalar variant.
 *
 * @param scalarClass - Task class for scalar path (e.g. ScalarAddTask)
 * @param vectorClass - Task class for vector path (e.g. VectorSumTask)
 * @returns A method suitable for Workflow.prototype
 */
export function CreateAdaptiveWorkflow<
  IS extends DataPorts,
  OS extends DataPorts,
  IV extends DataPorts,
  OV extends DataPorts,
  CS extends TaskConfig = TaskConfig,
  CV extends TaskConfig = TaskConfig,
>(
  scalarClass: ITaskConstructor<IS, OS, CS>,
  vectorClass: ITaskConstructor<IV, OV, CV>
): CreateAdaptiveWorkflow<IS, OS, IV, OV, CS, CV> {
  const scalarHelper = Workflow.createWorkflow<IS, OS, CS>(scalarClass);
  const vectorHelper = Workflow.createWorkflow<IV, OV, CV>(vectorClass);

  return function (
    this: Workflow<any, any>,
    input: (Partial<IS> & Partial<IV>) | undefined = {},
    config: (Partial<CS> & Partial<CV>) | undefined = {}
  ): Workflow {
    const parent = getLastTask(this);
    const useVector =
      (parent !== undefined && hasVectorOutput(parent)) || hasVectorLikeInput(input);
    if (useVector) {
      return vectorHelper.call(this, input, config) as Workflow;
    }
    return scalarHelper.call(this, input, config) as Workflow;
  };
}

// Event types
export type WorkflowEventListeners = {
  changed: (id: unknown) => void;
  reset: () => void;
  error: (error: string) => void;
  start: () => void;
  complete: () => void;
  abort: (error: string) => void;
};

export type WorkflowEvents = keyof WorkflowEventListeners;
export type WorkflowEventListener<Event extends WorkflowEvents> = WorkflowEventListeners[Event];
export type WorkflowEventParameters<Event extends WorkflowEvents> = EventParameters<
  WorkflowEventListeners,
  Event
>;

class WorkflowTask<I extends DataPorts, O extends DataPorts> extends GraphAsTask<I, O> {
  public static readonly type = "Workflow";
  public static readonly compoundMerge = PROPERTY_ARRAY as CompoundMergeStrategy;
}

/**
 * Class for building and managing a task graph
 * Provides methods for adding tasks, connecting outputs to inputs, and running the task graph
 *
 * When used with a parent workflow (loop builder mode), this class redirects task additions
 * to the iterator task's template graph until an end method (endMap, endBatch, etc.) is called.
 */
export class Workflow<
  Input extends DataPorts = DataPorts,
  Output extends DataPorts = DataPorts,
> implements IWorkflow<Input, Output> {
  /**
   * Creates a new Workflow
   *
   * @param cache - Optional repository for task outputs
   * @param parent - Optional parent workflow (for loop builder mode)
   * @param iteratorTask - Optional iterator task being configured (for loop builder mode)
   */
  constructor(cache?: TaskOutputRepository, parent?: Workflow, iteratorTask?: GraphAsTask) {
    this._outputCache = cache;
    this._parentWorkflow = parent;
    this._iteratorTask = iteratorTask;
    this._graph = new TaskGraph({ outputCache: this._outputCache });

    if (!parent) {
      this._onChanged = this._onChanged.bind(this);
      this.setupEvents();
    }
  }

  // Private properties
  private _graph: TaskGraph;
  private _dataFlows: Dataflow[] = [];
  private _error: string = "";
  private _outputCache?: TaskOutputRepository;

  // Abort controller for cancelling task execution
  private _abortController?: AbortController;

  // Loop builder properties
  private readonly _parentWorkflow?: Workflow;
  private readonly _iteratorTask?: GraphAsTask;
  private _pendingLoopConnect?: {
    parent: ITask;
    iteratorTask: ITask;
  };

  public outputCache(): TaskOutputRepository | undefined {
    return this._outputCache;
  }

  /**
   * Whether this workflow is in loop builder mode.
   * When true, tasks are added to the template graph for an iterator task.
   */
  public get isLoopBuilder(): boolean {
    return this._parentWorkflow !== undefined;
  }

  /**
   * Event emitter for task graph events
   */
  public readonly events = new EventEmitter<WorkflowEventListeners>();

  /**
   * Creates a helper function for adding specific task types to a Workflow
   *
   * @param taskClass - The task class to create a helper for
   * @returns A function that adds the specified task type to a Workflow
   */
  public static createWorkflow<
    I extends DataPorts,
    O extends DataPorts,
    C extends TaskConfig = TaskConfig,
  >(taskClass: ITaskConstructor<I, O, C>): CreateWorkflow<I, O, C> {
    const helper = function (
      this: Workflow<any, any>,
      input: Partial<I> = {},
      config: Partial<C> = {}
    ) {
      this._error = "";

      const parent = getLastTask(this);

      const task = this.addTaskToGraph<I, O, C>(
        taskClass,
        input as I,
        { id: uuid4(), ...config } as C
      );

      // Process any pending data flows
      if (this._dataFlows.length > 0) {
        this._dataFlows.forEach((dataflow) => {
          const taskSchema = task.inputSchema();
          if (
            (typeof taskSchema !== "boolean" &&
              taskSchema.properties?.[dataflow.targetTaskPortId] === undefined &&
              taskSchema.additionalProperties !== true) ||
            (taskSchema === true && dataflow.targetTaskPortId !== DATAFLOW_ALL_PORTS)
          ) {
            this._error = `Input ${dataflow.targetTaskPortId} not found on task ${task.config.id}`;
            console.error(this._error);
            return;
          }

          dataflow.targetTaskId = task.config.id;
          this.graph.addDataflow(dataflow);
        });

        this._dataFlows = [];
      }

      // Auto-connect to parent if needed
      if (parent && this.graph.getTargetDataflows(parent.config.id).length === 0) {
        // Build the list of earlier tasks (in reverse chronological order)
        const nodes = this._graph.getTasks();
        const parentIndex = nodes.findIndex((n) => n.config.id === parent.config.id);
        const earlierTasks: ITask[] = [];
        for (let i = parentIndex - 1; i >= 0; i--) {
          earlierTasks.push(nodes[i]);
        }

        const providedInputKeys = new Set(Object.keys(input || {}));

        const result = Workflow.autoConnect(this.graph, parent, task, {
          providedInputKeys,
          earlierTasks,
        });

        if (result.error) {
          // In loop builder mode, don't remove the task - allow manual connection
          // In normal mode, remove the task since auto-connect is required
          if (this.isLoopBuilder) {
            this._error = result.error;
            console.warn(this._error);
          } else {
            this._error = result.error + " Task not added.";
            console.error(this._error);
            this.graph.removeTask(task.config.id);
          }
        }
      }

      // Preserve input type from the start of the chain
      // If this is the first task, set both input and output types
      // Otherwise, only update the output type (input type is preserved from 'this')
      return this as any;
    };

    // Copy metadata from the task class
    // @ts-expect-error - using internals
    helper.type = taskClass.runtype ?? taskClass.type;
    helper.category = taskClass.category;
    helper.inputSchema = taskClass.inputSchema;
    helper.outputSchema = taskClass.outputSchema;
    helper.cacheable = taskClass.cacheable;
    helper.workflowCreate = true;

    return helper as CreateWorkflow<I, O, C>;
  }

  /**
   * Gets the current task graph
   */
  public get graph(): TaskGraph {
    return this._graph;
  }

  /**
   * Sets a new task graph
   */
  public set graph(value: TaskGraph) {
    this._dataFlows = [];
    this._error = "";
    this.clearEvents();
    this._graph = value;
    this.setupEvents();
    this.events.emit("reset");
  }

  /**
   * Gets the current error message
   */
  public get error(): string {
    return this._error;
  }

  /**
   * Event subscription methods
   */
  public on<Event extends WorkflowEvents>(name: Event, fn: WorkflowEventListener<Event>): void {
    this.events.on(name, fn);
  }

  public off<Event extends WorkflowEvents>(name: Event, fn: WorkflowEventListener<Event>): void {
    this.events.off(name, fn);
  }

  public once<Event extends WorkflowEvents>(name: Event, fn: WorkflowEventListener<Event>): void {
    this.events.once(name, fn);
  }

  public waitOn<Event extends WorkflowEvents>(
    name: Event
  ): Promise<WorkflowEventParameters<Event>> {
    return this.events.waitOn(name) as Promise<WorkflowEventParameters<Event>>;
  }

  /**
   * Runs the task graph
   *
   * @param input - The input to the task graph
   * @returns The output of the task graph
   */
  public async run(input: Input = {} as Input): Promise<PropertyArrayGraphResult<Output>> {
    // In loop builder mode, finalize template and delegate to parent
    if (this.isLoopBuilder) {
      this.finalizeTemplate();
      // Run deferred auto-connect now that template graph is populated
      if (this._pendingLoopConnect) {
        this._parentWorkflow!.autoConnectLoopTask(this._pendingLoopConnect);
        this._pendingLoopConnect = undefined;
      }
      return this._parentWorkflow!.run(input as any) as Promise<PropertyArrayGraphResult<Output>>;
    }

    this.events.emit("start");
    this._abortController = new AbortController();

    try {
      const output = await this.graph.run<Output>(input, {
        parentSignal: this._abortController.signal,
        outputCache: this._outputCache,
      });
      const results = this.graph.mergeExecuteOutputsToRunOutput<Output, typeof PROPERTY_ARRAY>(
        output,
        PROPERTY_ARRAY
      );
      this.events.emit("complete");
      return results;
    } catch (error) {
      this.events.emit("error", String(error));
      throw error;
    } finally {
      this._abortController = undefined;
    }
  }

  /**
   * Aborts the running task graph
   */
  public async abort(): Promise<void> {
    // In loop builder mode, delegate to parent
    if (this._parentWorkflow) {
      return this._parentWorkflow.abort();
    }
    this._abortController?.abort();
  }

  /**
   * Removes the last task from the task graph
   *
   * @returns The current task graph workflow
   */
  public pop(): Workflow {
    this._error = "";
    const nodes = this._graph.getTasks();

    if (nodes.length === 0) {
      this._error = "No tasks to remove";
      console.error(this._error);
      return this;
    }

    const lastNode = nodes[nodes.length - 1];
    this._graph.removeTask(lastNode.config.id);
    return this;
  }

  /**
   * Converts the task graph to JSON
   *
   * @returns The task graph as JSON
   */
  public toJSON(): TaskGraphJson {
    return this._graph.toJSON();
  }

  /**
   * Converts the task graph to dependency JSON
   *
   * @returns The task graph as dependency JSON
   */
  public toDependencyJSON(): JsonTaskItem[] {
    return this._graph.toDependencyJSON();
  }

  // Replace both the instance and static pipe methods with properly typed versions
  // Pipe method overloads
  public pipe<A extends DataPorts, B extends DataPorts>(fn1: Taskish<A, B>): IWorkflow<A, B>;
  public pipe<A extends DataPorts, B extends DataPorts, C extends DataPorts>(
    fn1: Taskish<A, B>,
    fn2: Taskish<B, C>
  ): IWorkflow<A, C>;
  public pipe<A extends DataPorts, B extends DataPorts, C extends DataPorts, D extends DataPorts>(
    fn1: Taskish<A, B>,
    fn2: Taskish<B, C>,
    fn3: Taskish<C, D>
  ): IWorkflow<A, D>;
  public pipe<
    A extends DataPorts,
    B extends DataPorts,
    C extends DataPorts,
    D extends DataPorts,
    E extends DataPorts,
  >(
    fn1: Taskish<A, B>,
    fn2: Taskish<B, C>,
    fn3: Taskish<C, D>,
    fn4: Taskish<D, E>
  ): IWorkflow<A, E>;
  public pipe<
    A extends DataPorts,
    B extends DataPorts,
    C extends DataPorts,
    D extends DataPorts,
    E extends DataPorts,
    F extends DataPorts,
  >(
    fn1: Taskish<A, B>,
    fn2: Taskish<B, C>,
    fn3: Taskish<C, D>,
    fn4: Taskish<D, E>,
    fn5: Taskish<E, F>
  ): IWorkflow<A, F>;
  public pipe(...args: Taskish<DataPorts, DataPorts>[]): IWorkflow {
    return pipe(args as any, this);
  }

  // Static pipe method overloads
  public static pipe<A extends DataPorts, B extends DataPorts>(
    fn1: PipeFunction<A, B> | ITask<A, B>
  ): IWorkflow;
  public static pipe<A extends DataPorts, B extends DataPorts, C extends DataPorts>(
    fn1: PipeFunction<A, B> | ITask<A, B>,
    fn2: PipeFunction<B, C> | ITask<B, C>
  ): IWorkflow;
  public static pipe<
    A extends DataPorts,
    B extends DataPorts,
    C extends DataPorts,
    D extends DataPorts,
  >(
    fn1: PipeFunction<A, B> | ITask<A, B>,
    fn2: PipeFunction<B, C> | ITask<B, C>,
    fn3: PipeFunction<C, D> | ITask<C, D>
  ): IWorkflow;
  public static pipe<
    A extends DataPorts,
    B extends DataPorts,
    C extends DataPorts,
    D extends DataPorts,
    E extends DataPorts,
  >(
    fn1: PipeFunction<A, B> | ITask<A, B>,
    fn2: PipeFunction<B, C> | ITask<B, C>,
    fn3: PipeFunction<C, D> | ITask<C, D>,
    fn4: PipeFunction<D, E> | ITask<D, E>
  ): IWorkflow;
  public static pipe<
    A extends DataPorts,
    B extends DataPorts,
    C extends DataPorts,
    D extends DataPorts,
    E extends DataPorts,
    F extends DataPorts,
  >(
    fn1: PipeFunction<A, B> | ITask<A, B>,
    fn2: PipeFunction<B, C> | ITask<B, C>,
    fn3: PipeFunction<C, D> | ITask<C, D>,
    fn4: PipeFunction<D, E> | ITask<D, E>,
    fn5: PipeFunction<E, F> | ITask<E, F>
  ): IWorkflow;
  public static pipe(...args: (PipeFunction | ITask)[]): IWorkflow {
    return pipe(args as any, new Workflow());
  }

  public parallel(
    args: (PipeFunction<any, any> | Task)[],
    mergeFn?: CompoundMergeStrategy
  ): IWorkflow {
    return parallel(args, mergeFn ?? PROPERTY_ARRAY, this);
  }

  public static parallel(
    args: (PipeFunction<any, any> | ITask)[],
    mergeFn?: CompoundMergeStrategy
  ): IWorkflow {
    return parallel(args, mergeFn ?? PROPERTY_ARRAY, new Workflow());
  }

  /**
   * Renames an output of a task to a new target input
   *
   * @param source - The id of the output to rename
   * @param target - The id of the input to rename to
   * @param index - The index of the task to rename the output of, defaults to the last task
   * @returns The current task graph workflow
   */
  public rename(source: string, target: string, index: number = -1): Workflow {
    this._error = "";

    const nodes = this._graph.getTasks();
    if (-index > nodes.length) {
      const errorMsg = `Back index greater than number of tasks`;
      this._error = errorMsg;
      console.error(this._error);
      throw new WorkflowError(errorMsg);
    }

    const lastNode = nodes[nodes.length + index];
    const outputSchema = lastNode.outputSchema();

    // Handle boolean schemas
    if (typeof outputSchema === "boolean") {
      if (outputSchema === false && source !== DATAFLOW_ALL_PORTS) {
        const errorMsg = `Task ${lastNode.config.id} has schema 'false' and outputs nothing`;
        this._error = errorMsg;
        console.error(this._error);
        throw new WorkflowError(errorMsg);
      }
      // If outputSchema is true, we skip validation as it outputs everything
    } else if (!(outputSchema.properties as any)?.[source] && source !== DATAFLOW_ALL_PORTS) {
      const errorMsg = `Output ${source} not found on task ${lastNode.config.id}`;
      this._error = errorMsg;
      console.error(this._error);
      throw new WorkflowError(errorMsg);
    }

    this._dataFlows.push(new Dataflow(lastNode.config.id, source, undefined, target));
    return this;
  }

  toTaskGraph(): TaskGraph {
    return this._graph;
  }

  toTask(): GraphAsTask {
    const task = new WorkflowTask();
    task.subGraph = this.toTaskGraph();
    return task;
  }

  /**
   * Resets the task graph workflow to its initial state
   *
   * @returns The current task graph workflow
   */
  public reset(): Workflow {
    // In loop builder mode, reset is not supported
    if (this._parentWorkflow) {
      throw new WorkflowError("Cannot reset a loop workflow. Call reset() on the parent workflow.");
    }

    this.clearEvents();
    this._graph = new TaskGraph({
      outputCache: this._outputCache,
    });
    this._dataFlows = [];
    this._error = "";
    this.setupEvents();
    this.events.emit("changed", undefined);
    this.events.emit("reset");
    return this;
  }

  /**
   * Sets up event listeners for the task graph
   */
  private setupEvents(): void {
    this._graph.on("task_added", this._onChanged);
    this._graph.on("task_replaced", this._onChanged);
    this._graph.on("task_removed", this._onChanged);
    this._graph.on("dataflow_added", this._onChanged);
    this._graph.on("dataflow_replaced", this._onChanged);
    this._graph.on("dataflow_removed", this._onChanged);
  }

  /**
   * Clears event listeners for the task graph
   */
  private clearEvents(): void {
    this._graph.off("task_added", this._onChanged);
    this._graph.off("task_replaced", this._onChanged);
    this._graph.off("task_removed", this._onChanged);
    this._graph.off("dataflow_added", this._onChanged);
    this._graph.off("dataflow_replaced", this._onChanged);
    this._graph.off("dataflow_removed", this._onChanged);
  }

  /**
   * Handles changes to the task graph
   */
  private _onChanged(id: unknown): void {
    this.events.emit("changed", id);
  }

  /**
   * Connects outputs to inputs between tasks
   */
  public connect(
    sourceTaskId: unknown,
    sourceTaskPortId: string,
    targetTaskId: unknown,
    targetTaskPortId: string
  ): Workflow {
    const sourceTask = this.graph.getTask(sourceTaskId);
    const targetTask = this.graph.getTask(targetTaskId);

    if (!sourceTask || !targetTask) {
      throw new WorkflowError("Source or target task not found");
    }

    const sourceSchema = sourceTask.outputSchema();
    const targetSchema = targetTask.inputSchema();

    // Handle boolean schemas
    if (typeof sourceSchema === "boolean") {
      if (sourceSchema === false) {
        throw new WorkflowError(`Source task has schema 'false' and outputs nothing`);
      }
      // If sourceSchema is true, we skip validation as it accepts everything
    } else if (!sourceSchema.properties?.[sourceTaskPortId]) {
      throw new WorkflowError(`Output ${sourceTaskPortId} not found on source task`);
    }

    if (typeof targetSchema === "boolean") {
      if (targetSchema === false) {
        throw new WorkflowError(`Target task has schema 'false' and accepts no inputs`);
      }
      if (targetSchema === true) {
        // do nothing, we allow additional properties
      }
    } else if (targetSchema.additionalProperties === true) {
      // do nothing, we allow additional properties
    } else if (!targetSchema.properties?.[targetTaskPortId]) {
      throw new WorkflowError(`Input ${targetTaskPortId} not found on target task`);
    }

    const dataflow = new Dataflow(sourceTaskId, sourceTaskPortId, targetTaskId, targetTaskPortId);
    this.graph.addDataflow(dataflow);
    return this;
  }

  public addTaskToGraph<
    I extends DataPorts,
    O extends DataPorts,
    C extends TaskConfig = TaskConfig,
  >(taskClass: ITaskConstructor<I, O, C>, input: I, config: C): ITask<I, O, C> {
    const task = new taskClass(input, config);
    const id = this.graph.addTask(task);
    this.events.emit("changed", id);
    return task;
  }

  /**
   * Adds a task to the workflow using the same logic as createWorkflow() helpers.
   * Auto-generates an ID, processes pending dataflows, and auto-connects to previous tasks.
   *
   * @param taskClass - The task class to instantiate and add
   * @param input - Optional input values for the task
   * @param config - Optional configuration (id will be auto-generated if not provided)
   * @returns The workflow for chaining
   */
  public addTask<I extends DataPorts, O extends DataPorts, C extends TaskConfig = TaskConfig>(
    taskClass: ITaskConstructor<I, O, C>,
    input?: Partial<I>,
    config?: Partial<C>
  ): Workflow<Input, Output> {
    const helper = Workflow.createWorkflow<I, O, C>(taskClass);
    return helper.call(this, input, config) as Workflow<Input, Output>;
  }

  // ========================================================================
  // Loop Builder Methods
  // ========================================================================

  /**
   * Adds an iterator/loop task to the workflow using the same auto-connect logic
   * as regular task addition (createWorkflow), then returns a new loop builder Workflow.
   *
   * @param taskClass - The iterator task class (MapTask, ReduceTask, etc.)
   * @param config - Optional configuration for the iterator task
   * @returns A new loop builder Workflow for adding tasks inside the loop
   */
  public addLoopTask<I extends DataPorts, O extends DataPorts, C extends TaskConfig = TaskConfig>(
    taskClass: ITaskConstructor<I, O, C>,
    config: Partial<C> = {}
  ): Workflow<I, O> {
    this._error = "";

    const parent = getLastTask(this);

    const task = this.addTaskToGraph<I, O, C>(taskClass, {} as I, { id: uuid4(), ...config } as C);

    // Process any pending data flows (same as createWorkflow)
    if (this._dataFlows.length > 0) {
      this._dataFlows.forEach((dataflow) => {
        const taskSchema = task.inputSchema();
        if (
          (typeof taskSchema !== "boolean" &&
            taskSchema.properties?.[dataflow.targetTaskPortId] === undefined &&
            taskSchema.additionalProperties !== true) ||
          (taskSchema === true && dataflow.targetTaskPortId !== DATAFLOW_ALL_PORTS)
        ) {
          this._error = `Input ${dataflow.targetTaskPortId} not found on task ${task.config.id}`;
          console.error(this._error);
          return;
        }

        dataflow.targetTaskId = task.config.id;
        this.graph.addDataflow(dataflow);
      });

      this._dataFlows = [];
    }

    // Defer auto-connect until endMap/endReduce/endWhile, when the iterator task
    // has its template graph populated and its dynamic inputSchema is available.
    // Store the pending context on the loop builder workflow.
    const loopBuilder = new Workflow(
      this.outputCache(),
      this,
      task as unknown as GraphAsTask
    ) as unknown as Workflow<I, O>;
    if (parent) {
      loopBuilder._pendingLoopConnect = { parent, iteratorTask: task };
    }
    return loopBuilder;
  }

  /**
   * Runs deferred auto-connect for a loop task on this (parent) workflow's graph.
   * Called after finalizeTemplate() populates the iterator task's template graph,
   * so that the iterator task's dynamic inputSchema() is available for matching.
   */
  public autoConnectLoopTask(pending?: { parent: ITask; iteratorTask: ITask }): void {
    if (!pending) return;
    const { parent, iteratorTask } = pending;

    if (this.graph.getTargetDataflows(parent.config.id).length === 0) {
      const nodes = this._graph.getTasks();
      const parentIndex = nodes.findIndex((n) => n.config.id === parent.config.id);
      const earlierTasks: ITask[] = [];
      for (let i = parentIndex - 1; i >= 0; i--) {
        earlierTasks.push(nodes[i]);
      }

      const result = Workflow.autoConnect(this.graph, parent, iteratorTask, {
        earlierTasks,
      });

      if (result.error) {
        this._error = result.error + " Task not added.";
        console.error(this._error);
        this.graph.removeTask(iteratorTask.config.id);
      }
    }
  }

  /**
   * Options for auto-connect operation.
   */
  public static readonly AutoConnectOptions: unique symbol = Symbol("AutoConnectOptions");

  /**
   * Auto-connects two tasks based on their schemas.
   * Uses multiple matching strategies:
   * 1. Match by type AND port name (highest priority)
   * 2. Match by specific type only (format, $id) for unmatched ports
   * 3. Look back through earlier tasks for unmatched required inputs
   *
   * @param graph - The task graph to add dataflows to
   * @param sourceTask - The source task to connect from
   * @param targetTask - The target task to connect to
   * @param options - Optional configuration for the auto-connect operation
   * @returns Result containing matches made, any errors, and unmatched required inputs
   */
  public static autoConnect(
    graph: TaskGraph,
    sourceTask: ITask,
    targetTask: ITask,
    options?: {
      /** Keys of inputs that are already provided and don't need connection */
      readonly providedInputKeys?: Set<string>;
      /** Earlier tasks to search for unmatched required inputs (in reverse chronological order) */
      readonly earlierTasks?: readonly ITask[];
    }
  ): {
    readonly matches: Map<string, string>;
    readonly error?: string;
    readonly unmatchedRequired: readonly string[];
  } {
    const matches = new Map<string, string>();
    const sourceSchema = sourceTask.outputSchema();
    const targetSchema = targetTask.inputSchema();
    const providedInputKeys = options?.providedInputKeys ?? new Set<string>();
    const earlierTasks = options?.earlierTasks ?? [];

    /**
     * Extracts specific type identifiers (format, $id) from a schema,
     * looking inside oneOf/anyOf wrappers if needed.
     */
    const getSpecificTypeIdentifiers = (
      schema: JsonSchema
    ): { formats: Set<string>; ids: Set<string> } => {
      const formats = new Set<string>();
      const ids = new Set<string>();

      if (typeof schema === "boolean") {
        return { formats, ids };
      }

      // Helper to extract from a single schema object
      const extractFromSchema = (s: any): void => {
        if (!s || typeof s !== "object" || Array.isArray(s)) return;
        if (s.format) formats.add(s.format);
        if (s.$id) ids.add(s.$id);
      };

      // Check top-level format/$id
      extractFromSchema(schema);

      // Check inside oneOf/anyOf
      const checkUnion = (schemas: JsonSchema[] | undefined): void => {
        if (!schemas) return;
        for (const s of schemas) {
          if (typeof s === "boolean") continue;
          extractFromSchema(s);
          // Also check nested items for array types
          if (s.items && typeof s.items === "object" && !Array.isArray(s.items)) {
            extractFromSchema(s.items);
          }
        }
      };

      checkUnion(schema.oneOf as JsonSchema[] | undefined);
      checkUnion(schema.anyOf as JsonSchema[] | undefined);

      // Check items for array types (single schema, not tuple)
      if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
        extractFromSchema(schema.items);
      }

      return { formats, ids };
    };

    /**
     * Checks if output schema type is compatible with input schema type.
     * Handles $id matching, format matching, and oneOf/anyOf unions.
     */
    const isTypeCompatible = (
      fromPortOutputSchema: JsonSchema,
      toPortInputSchema: JsonSchema,
      requireSpecificType: boolean = false
    ): boolean => {
      if (typeof fromPortOutputSchema === "boolean" || typeof toPortInputSchema === "boolean") {
        return fromPortOutputSchema === true && toPortInputSchema === true;
      }

      // Extract specific type identifiers from both schemas
      const outputIds = getSpecificTypeIdentifiers(fromPortOutputSchema);
      const inputIds = getSpecificTypeIdentifiers(toPortInputSchema);

      // Check if any format matches
      for (const format of outputIds.formats) {
        if (inputIds.formats.has(format)) {
          return true;
        }
      }

      // Check if any $id matches
      for (const id of outputIds.ids) {
        if (inputIds.ids.has(id)) {
          return true;
        }
      }

      // For type-only fallback, we require specific types (not primitives)
      // to avoid over-matching strings, numbers, etc.
      if (requireSpecificType) {
        return false;
      }

      // $id both blank at top level - check type directly (only for name-matched ports)
      const idTypeBlank =
        fromPortOutputSchema.$id === undefined && toPortInputSchema.$id === undefined;
      if (!idTypeBlank) return false;

      // Direct type match (for primitives, only when names also match)
      if (fromPortOutputSchema.type === toPortInputSchema.type) return true;

      // Check if output type matches any option in oneOf/anyOf
      const matchesOneOf =
        toPortInputSchema.oneOf?.some((schema: any) => {
          if (typeof schema === "boolean") return schema;
          return schema.type === fromPortOutputSchema.type;
        }) ?? false;

      const matchesAnyOf =
        toPortInputSchema.anyOf?.some((schema: any) => {
          if (typeof schema === "boolean") return schema;
          return schema.type === fromPortOutputSchema.type;
        }) ?? false;

      return matchesOneOf || matchesAnyOf;
    };

    const makeMatch = (
      fromSchema: JsonSchema,
      toSchema: JsonSchema,
      fromTaskId: unknown,
      toTaskId: unknown,
      comparator: (
        [fromOutputPortId, fromPortOutputSchema]: [string, JsonSchema],
        [toInputPortId, toPortInputSchema]: [string, JsonSchema]
      ) => boolean
    ): void => {
      if (typeof fromSchema === "object") {
        if (
          toSchema === true ||
          (typeof toSchema === "object" && toSchema.additionalProperties === true)
        ) {
          for (const fromOutputPortId of Object.keys(fromSchema.properties || {})) {
            matches.set(fromOutputPortId, fromOutputPortId);
            graph.addDataflow(
              new Dataflow(fromTaskId, fromOutputPortId, toTaskId, fromOutputPortId)
            );
          }
          return;
        }
      }
      // If either schema is true or false, skip auto-matching
      // as we cannot determine the appropriate connections
      if (typeof fromSchema === "boolean" || typeof toSchema === "boolean") {
        return;
      }

      for (const [fromOutputPortId, fromPortOutputSchema] of Object.entries(
        fromSchema.properties || {}
      )) {
        for (const [toInputPortId, toPortInputSchema] of Object.entries(
          toSchema.properties || {}
        )) {
          if (
            !matches.has(toInputPortId) &&
            comparator([fromOutputPortId, fromPortOutputSchema], [toInputPortId, toPortInputSchema])
          ) {
            matches.set(toInputPortId, fromOutputPortId);
            graph.addDataflow(new Dataflow(fromTaskId, fromOutputPortId, toTaskId, toInputPortId));
          }
        }
      }
    };

    // Strategy 1: Match by type AND port name (highest priority)
    makeMatch(
      sourceSchema,
      targetSchema,
      sourceTask.config.id,
      targetTask.config.id,
      ([fromOutputPortId, fromPortOutputSchema], [toInputPortId, toPortInputSchema]) => {
        const outputPortIdMatch = fromOutputPortId === toInputPortId;
        const outputPortIdOutputInput = fromOutputPortId === "output" && toInputPortId === "input";
        const portIdsCompatible = outputPortIdMatch || outputPortIdOutputInput;

        return (
          portIdsCompatible && isTypeCompatible(fromPortOutputSchema, toPortInputSchema, false)
        );
      }
    );

    // Strategy 2: Match by specific type only (fallback for unmatched ports)
    // Only matches specific types like TypedArray (with format), not primitives
    // This allows connecting ports with different names but compatible specific types
    makeMatch(
      sourceSchema,
      targetSchema,
      sourceTask.config.id,
      targetTask.config.id,
      ([_fromOutputPortId, fromPortOutputSchema], [_toInputPortId, toPortInputSchema]) => {
        return isTypeCompatible(fromPortOutputSchema, toPortInputSchema, true);
      }
    );

    // Strategy 3: Look back through earlier tasks for unmatched required inputs
    // Extract required inputs from target schema
    const requiredInputs = new Set<string>(
      typeof targetSchema === "object" ? (targetSchema.required as string[]) || [] : []
    );

    // Filter out required inputs that are already provided in the input parameter
    // These don't need to be connected from previous tasks
    const requiredInputsNeedingConnection = [...requiredInputs].filter(
      (r) => !providedInputKeys.has(r)
    );

    // Compute unmatched required inputs (that aren't already provided)
    let unmatchedRequired = requiredInputsNeedingConnection.filter((r) => !matches.has(r));

    // If there are unmatched required inputs, iterate through earlier tasks
    if (unmatchedRequired.length > 0 && earlierTasks.length > 0) {
      for (let i = 0; i < earlierTasks.length && unmatchedRequired.length > 0; i++) {
        const earlierTask = earlierTasks[i];
        const earlierOutputSchema = earlierTask.outputSchema();

        // Helper function to match from an earlier task (only for unmatched required inputs)
        const makeMatchFromEarlier = (
          comparator: (
            [fromOutputPortId, fromPortOutputSchema]: [string, JsonSchema],
            [toInputPortId, toPortInputSchema]: [string, JsonSchema]
          ) => boolean
        ): void => {
          if (typeof earlierOutputSchema === "boolean" || typeof targetSchema === "boolean") {
            return;
          }

          for (const [fromOutputPortId, fromPortOutputSchema] of Object.entries(
            earlierOutputSchema.properties || {}
          )) {
            for (const requiredInputId of unmatchedRequired) {
              const toPortInputSchema = (targetSchema.properties as any)?.[requiredInputId];
              if (
                !matches.has(requiredInputId) &&
                toPortInputSchema &&
                comparator(
                  [fromOutputPortId, fromPortOutputSchema],
                  [requiredInputId, toPortInputSchema]
                )
              ) {
                matches.set(requiredInputId, fromOutputPortId);
                graph.addDataflow(
                  new Dataflow(
                    earlierTask.config.id,
                    fromOutputPortId,
                    targetTask.config.id,
                    requiredInputId
                  )
                );
              }
            }
          }
        };

        // Try both matching strategies for earlier tasks
        // Strategy 1: Match by type AND port name
        makeMatchFromEarlier(
          ([fromOutputPortId, fromPortOutputSchema], [toInputPortId, toPortInputSchema]) => {
            const outputPortIdMatch = fromOutputPortId === toInputPortId;
            const outputPortIdOutputInput =
              fromOutputPortId === "output" && toInputPortId === "input";
            const portIdsCompatible = outputPortIdMatch || outputPortIdOutputInput;

            return (
              portIdsCompatible && isTypeCompatible(fromPortOutputSchema, toPortInputSchema, false)
            );
          }
        );

        // Strategy 2: Match by specific type only
        makeMatchFromEarlier(
          ([_fromOutputPortId, fromPortOutputSchema], [_toInputPortId, toPortInputSchema]) => {
            return isTypeCompatible(fromPortOutputSchema, toPortInputSchema, true);
          }
        );

        // Update unmatched required inputs
        unmatchedRequired = unmatchedRequired.filter((r) => !matches.has(r));
      }
    }

    // Determine if there's an error
    const stillUnmatchedRequired = requiredInputsNeedingConnection.filter((r) => !matches.has(r));

    if (stillUnmatchedRequired.length > 0) {
      return {
        matches,
        error:
          `Could not find matches for required inputs [${stillUnmatchedRequired.join(", ")}] of ${targetTask.type}. ` +
          `Attempted to match from ${sourceTask.type} and earlier tasks.`,
        unmatchedRequired: stillUnmatchedRequired,
      };
    }

    if (matches.size === 0 && requiredInputsNeedingConnection.length === 0) {
      // No matches were made AND no required inputs need connection
      // This happens in two cases:
      // 1. Task has required inputs, but they were all provided as parameters
      // 2. Task has no required inputs (all optional)

      // If task has required inputs that were all provided as parameters, allow the task
      const hasRequiredInputs = requiredInputs.size > 0;
      const allRequiredInputsProvided =
        hasRequiredInputs && [...requiredInputs].every((r) => providedInputKeys.has(r));

      // If no required inputs (all optional), check if there are defaults
      const hasInputsWithDefaults =
        typeof targetSchema === "object" &&
        targetSchema.properties &&
        Object.values(targetSchema.properties).some(
          (prop: any) => prop && typeof prop === "object" && "default" in prop
        );

      // Allow if:
      // - All required inputs were provided as parameters, OR
      // - No required inputs and task has defaults
      // Otherwise fail (no required inputs, no defaults, no matches)
      if (!allRequiredInputsProvided && !hasInputsWithDefaults) {
        return {
          matches,
          error:
            `Could not find a match between the outputs of ${sourceTask.type} and the inputs of ${targetTask.type}. ` +
            `You may need to connect the outputs to the inputs via connect() manually.`,
          unmatchedRequired: [],
        };
      }
    }

    return {
      matches,
      unmatchedRequired: [],
    };
  }

  /**
   * Finalizes the template graph and sets it on the iterator task.
   * Only applicable in loop builder mode.
   */
  public finalizeTemplate(): void {
    if (!this._iteratorTask || this.graph.getTasks().length === 0) {
      return;
    }

    this._iteratorTask.subGraph = this.graph;
  }

  /**
   * Finalizes the template graph and returns the parent workflow.
   * Only applicable in loop builder mode.
   *
   * @returns The parent workflow
   * @throws WorkflowError if not in loop builder mode
   */
  public finalizeAndReturn(): Workflow {
    if (!this._parentWorkflow) {
      throw new WorkflowError("finalizeAndReturn() can only be called on loop workflows");
    }
    this.finalizeTemplate();
    // Now that the iterator task has its template graph, its dynamic inputSchema()
    // is available. Run deferred auto-connect on the parent workflow's graph.
    if (this._pendingLoopConnect) {
      this._parentWorkflow.autoConnectLoopTask(this._pendingLoopConnect);
      this._pendingLoopConnect = undefined;
    }
    return this._parentWorkflow;
  }
}
