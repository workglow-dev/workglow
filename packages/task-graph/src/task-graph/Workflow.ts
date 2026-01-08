/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter, JsonSchema, type EventParameters } from "@workglow/util";
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

// Task ID counter
let taskIdCounter = 0;

/**
 * Class for building and managing a task graph
 * Provides methods for adding tasks, connecting outputs to inputs, and running the task graph
 */
export class Workflow<
  Input extends DataPorts = DataPorts,
  Output extends DataPorts = DataPorts,
> implements IWorkflow<Input, Output> {
  /**
   * Creates a new Workflow
   *
   * @param repository - Optional repository for task outputs
   */
  constructor(repository?: TaskOutputRepository) {
    this._repository = repository;
    this._graph = new TaskGraph({
      outputCache: this._repository,
    });
    this._onChanged = this._onChanged.bind(this);
    this.setupEvents();
  }
  // Private properties
  private _graph: TaskGraph;
  private _dataFlows: Dataflow[] = [];
  private _error: string = "";
  private _repository?: TaskOutputRepository;

  // Abort controller for cancelling task execution
  private _abortController?: AbortController;

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

      // Create and add the new task
      taskIdCounter++;

      const task = this.addTask<I, O, C>(
        taskClass,
        input as I,
        { id: String(taskIdCounter), ...config } as C
      );

      // Process any pending data flows
      if (this._dataFlows.length > 0) {
        this._dataFlows.forEach((dataflow) => {
          const taskSchema = task.inputSchema();
          if (
            (typeof taskSchema !== "boolean" &&
              taskSchema.properties?.[dataflow.targetTaskPortId] === undefined) ||
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
        // Find matches between parent outputs and task inputs based on valueType
        const matches = new Map<string, string>();
        const sourceSchema = parent.outputSchema();
        const targetSchema = task.inputSchema();

        const makeMatch = (
          comparator: (
            [fromOutputPortId, fromPortOutputSchema]: [string, JsonSchema],
            [toInputPortId, toPortInputSchema]: [string, JsonSchema]
          ) => boolean
        ): Map<string, string> => {
          if (typeof sourceSchema === "object") {
            if (
              targetSchema === true ||
              (typeof targetSchema === "object" && targetSchema.additionalProperties === true)
            ) {
              for (const fromOutputPortId of Object.keys(sourceSchema.properties || {})) {
                matches.set(fromOutputPortId, fromOutputPortId);
                this.connect(parent.config.id, fromOutputPortId, task.config.id, fromOutputPortId);
              }
              return matches;
            }
          }
          // If either schema is true or false, skip auto-matching
          // as we cannot determine the appropriate connections
          if (typeof sourceSchema === "boolean" || typeof targetSchema === "boolean") {
            return matches;
          }

          for (const [fromOutputPortId, fromPortOutputSchema] of Object.entries(
            sourceSchema.properties || {}
          )) {
            for (const [toInputPortId, toPortInputSchema] of Object.entries(
              targetSchema.properties || {}
            )) {
              if (
                !matches.has(toInputPortId) &&
                comparator(
                  [fromOutputPortId, fromPortOutputSchema],
                  [toInputPortId, toPortInputSchema]
                )
              ) {
                matches.set(toInputPortId, fromOutputPortId);
                this.connect(parent.config.id, fromOutputPortId, task.config.id, toInputPortId);
              }
            }
          }
          return matches;
        };

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

        // Strategy 1: Match by type AND port name (highest priority)
        makeMatch(
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

        // Strategy 2: Match by specific type only (fallback for unmatched ports)
        // Only matches specific types like TypedArray (with format), not primitives
        // This allows connecting ports with different names but compatible specific types
        makeMatch(
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
        const providedInputKeys = new Set(Object.keys(input || {}));
        const requiredInputsNeedingConnection = [...requiredInputs].filter(
          (r) => !providedInputKeys.has(r)
        );

        // Compute unmatched required inputs (that aren't already provided)
        let unmatchedRequired = requiredInputsNeedingConnection.filter((r) => !matches.has(r));

        // If there are unmatched required inputs, iterate backwards through earlier tasks
        if (unmatchedRequired.length > 0) {
          const nodes = this._graph.getTasks();
          const parentIndex = nodes.findIndex((n) => n.config.id === parent.config.id);

          // Iterate backwards from task before parent
          for (let i = parentIndex - 1; i >= 0 && unmatchedRequired.length > 0; i--) {
            const earlierTask = nodes[i];
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
                    this.connect(
                      earlierTask.config.id,
                      fromOutputPortId,
                      task.config.id,
                      requiredInputId
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
                  portIdsCompatible &&
                  isTypeCompatible(fromPortOutputSchema, toPortInputSchema, false)
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

        // Updated failure condition: only fail when required inputs (that need connection) remain unmatched
        const stillUnmatchedRequired = requiredInputsNeedingConnection.filter(
          (r) => !matches.has(r)
        );
        if (stillUnmatchedRequired.length > 0) {
          this._error =
            `Could not find matches for required inputs [${stillUnmatchedRequired.join(", ")}] of ${task.type}. ` +
            `Attempted to match from ${parent.type} and earlier tasks. Task not added.`;

          console.error(this._error);
          this.graph.removeTask(task.config.id);
        } else if (matches.size === 0 && requiredInputsNeedingConnection.length === 0) {
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
            this._error =
              `Could not find a match between the outputs of ${parent.type} and the inputs of ${task.type}. ` +
              `You now need to connect the outputs to the inputs via connect() manually before adding this task. Task not added.`;

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
    this.events.emit("start");
    this._abortController = new AbortController();

    try {
      const output = await this.graph.run<Output>(input, {
        parentSignal: this._abortController.signal,
        outputCache: this._repository,
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
    taskIdCounter = 0;
    this.clearEvents();
    this._graph = new TaskGraph({
      outputCache: this._repository,
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

  public addTask<I extends DataPorts, O extends DataPorts, C extends TaskConfig = TaskConfig>(
    taskClass: ITaskConstructor<I, O, C>,
    input: I,
    config: C
  ): ITask<I, O, C> {
    const task = new taskClass(input, config);
    const id = this.graph.addTask(task);
    this.events.emit("changed", id);
    return task;
  }
}

/**
 * Helper function for backward compatibility
 */
export function CreateWorkflow<
  I extends DataPorts,
  O extends DataPorts,
  C extends TaskConfig = TaskConfig,
>(taskClass: any): CreateWorkflow<I, O, C> {
  return Workflow.createWorkflow<I, O, C>(taskClass);
}
