/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DirectedAcyclicGraph, EventEmitter, uuid4 } from "@workglow/util";
import { TaskOutputRepository } from "../storage/TaskOutputRepository";
import type { ITask } from "../task/ITask";
import { JsonTaskItem, TaskGraphJson } from "../task/TaskJSON";
import type { TaskIdType, TaskInput, TaskOutput, TaskStatus } from "../task/TaskTypes";
import { ensureTask, type PipeFunction } from "./Conversions";
import { Dataflow, type DataflowIdType } from "./Dataflow";
import type { ITaskGraph } from "./ITaskGraph";
import {
  EventTaskGraphToDagMapping,
  GraphEventDagEvents,
  GraphEventDagParameters,
  TaskGraphEventListener,
  TaskGraphEvents,
  TaskGraphEventStatusParameters,
  TaskGraphStatusEvents,
  TaskGraphStatusListeners,
} from "./TaskGraphEvents";
import {
  CompoundMergeStrategy,
  GraphResult,
  type GraphResultArray,
  TaskGraphRunner,
} from "./TaskGraphRunner";

/**
 * Configuration for running a task graph
 */
export interface TaskGraphRunConfig {
  /** Optional output cache to use for this task graph */
  outputCache?: TaskOutputRepository | boolean;
  /** Optional signal to abort the task graph */
  parentSignal?: AbortSignal;
}

class TaskGraphDAG extends DirectedAcyclicGraph<
  ITask<any, any, any>,
  Dataflow,
  TaskIdType,
  DataflowIdType
> {
  constructor() {
    super(
      (task: ITask<any, any, any>) => task.config.id,
      (dataflow: Dataflow) => dataflow.id
    );
  }
}

interface TaskGraphConstructorConfig {
  outputCache?: TaskOutputRepository;
  dag?: TaskGraphDAG;
}

/**
 * Represents a task graph, a directed acyclic graph of tasks and data flows
 */
export class TaskGraph implements ITaskGraph {
  /** Optional output cache to use for this task graph */
  public outputCache?: TaskOutputRepository;

  /**
   * Constructor for TaskGraph
   * @param config Configuration for the task graph
   */
  constructor({ outputCache, dag }: TaskGraphConstructorConfig = {}) {
    this.outputCache = outputCache;
    this._dag = dag || new TaskGraphDAG();
  }

  private _dag: TaskGraphDAG;

  private _runner: TaskGraphRunner | undefined;
  public get runner(): TaskGraphRunner {
    if (!this._runner) {
      this._runner = new TaskGraphRunner(this, this.outputCache);
    }
    return this._runner;
  }

  // ========================================================================
  // Public methods
  // ========================================================================

  /**
   * Runs the task graph
   * @param config Configuration for the graph run
   * @returns A promise that resolves when all tasks are complete
   * @throws TaskError if any tasks have failed
   */
  public run<ExecuteOutput extends TaskOutput>(
    input: TaskInput = {} as TaskInput,
    config: TaskGraphRunConfig = {}
  ): Promise<GraphResultArray<ExecuteOutput>> {
    return this.runner.runGraph<ExecuteOutput>(input, {
      outputCache: config?.outputCache || this.outputCache,
      parentSignal: config?.parentSignal || undefined,
    });
  }

  /**
   * Runs the task graph reactively
   * @returns A promise that resolves when all tasks are complete
   * @throws TaskError if any tasks have failed
   */
  public runReactive<Output extends TaskOutput>(): Promise<GraphResultArray<Output>> {
    return this.runner.runGraphReactive<Output>();
  }

  /**
   * Merges the execute output to the run output
   * @param results The execute output
   * @param compoundMerge The compound merge strategy to use
   * @returns The run output
   */

  public mergeExecuteOutputsToRunOutput<
    ExecuteOutput extends TaskOutput,
    Merge extends CompoundMergeStrategy = CompoundMergeStrategy,
  >(
    results: GraphResultArray<ExecuteOutput>,
    compoundMerge: Merge
  ): GraphResult<ExecuteOutput, Merge> {
    return this.runner.mergeExecuteOutputsToRunOutput(results, compoundMerge);
  }

  /**
   * Aborts the task graph
   */
  public abort() {
    this.runner.abort();
  }

  /**
   * Disables the task graph
   */
  public async disable() {
    await this.runner.disable();
  }

  /**
   * Retrieves a task from the task graph by its id
   * @param id The id of the task to retrieve
   * @returns The task with the given id, or undefined if not found
   */
  public getTask(id: TaskIdType): ITask<any, any, any> | undefined {
    return this._dag.getNode(id);
  }

  /**
   * Retrieves all tasks in the task graph
   * @returns An array of tasks in the task graph
   */
  public getTasks(): ITask<any, any, any>[] {
    return this._dag.getNodes();
  }

  /**
   * Retrieves all tasks in the task graph topologically sorted
   * @returns An array of tasks in the task graph topologically sorted
   */
  public topologicallySortedNodes(): ITask<any, any, any>[] {
    return this._dag.topologicallySortedNodes();
  }

  /**
   * Adds a task to the task graph
   * @param task The task to add
   * @returns The current task graph
   */
  public addTask(fn: PipeFunction<any, any>, config?: any): unknown;
  public addTask(task: ITask<any, any, any>): unknown;
  public addTask(task: ITask<any, any, any> | PipeFunction<any, any>, config?: any): unknown {
    return this._dag.addNode(ensureTask(task, config));
  }

  /**
   * Adds multiple tasks to the task graph
   * @param tasks The tasks to add
   * @returns The current task graph
   */
  public addTasks(tasks: PipeFunction<any, any>[]): unknown[];
  public addTasks(tasks: ITask<any, any, any>[]): unknown[];
  public addTasks(tasks: ITask<any, any, any>[] | PipeFunction<any, any>[]): unknown[] {
    return this._dag.addNodes(tasks.map(ensureTask));
  }

  /**
   * Adds a data flow to the task graph
   * @param dataflow The data flow to add
   * @returns The current task graph
   */
  public addDataflow(dataflow: Dataflow) {
    return this._dag.addEdge(dataflow.sourceTaskId, dataflow.targetTaskId, dataflow);
  }

  /**
   * Adds multiple data flows to the task graph
   * @param dataflows The data flows to add
   * @returns The current task graph
   */
  public addDataflows(dataflows: Dataflow[]) {
    const addedEdges = dataflows.map<[s: unknown, t: unknown, e: Dataflow]>((edge) => {
      return [edge.sourceTaskId, edge.targetTaskId, edge];
    });
    return this._dag.addEdges(addedEdges);
  }

  /**
   * Retrieves a data flow from the task graph by its id
   * @param id The id of the data flow to retrieve
   * @returns The data flow with the given id, or undefined if not found
   */
  public getDataflow(id: DataflowIdType): Dataflow | undefined {
    // @ts-ignore
    for (const i in this._dag.adjacency) {
      // @ts-ignore
      for (const j in this._dag.adjacency[i]) {
        // @ts-ignore
        const maybeEdges = this._dag.adjacency[i][j];
        if (maybeEdges !== null) {
          for (const edge of maybeEdges) {
            // @ts-ignore
            if (this._dag.edgeIdentity(edge, "", "") == id) {
              return edge;
            }
          }
        }
      }
    }
  }

  /**
   * Retrieves all data flows in the task graph
   * @returns An array of data flows in the task graph
   */
  public getDataflows(): Dataflow[] {
    return this._dag.getEdges().map((edge) => edge[2]);
  }

  /**
   * Removes a data flow from the task graph
   * @param dataflow The data flow to remove
   * @returns The current task graph
   */
  public removeDataflow(dataflow: Dataflow) {
    return this._dag.removeEdge(dataflow.sourceTaskId, dataflow.targetTaskId, dataflow.id);
  }

  /**
   * Retrieves the data flows that are sources of a given task
   * @param taskId The id of the task to retrieve sources for
   * @returns An array of data flows that are sources of the given task
   */
  public getSourceDataflows(taskId: unknown): Dataflow[] {
    return this._dag.inEdges(taskId).map(([, , dataflow]) => dataflow);
  }

  /**
   * Retrieves the data flows that are targets of a given task
   * @param taskId The id of the task to retrieve targets for
   * @returns An array of data flows that are targets of the given task
   */
  public getTargetDataflows(taskId: unknown): Dataflow[] {
    return this._dag.outEdges(taskId).map(([, , dataflow]) => dataflow);
  }

  /**
   * Retrieves the tasks that are sources of a given task
   * @param taskId The id of the task to retrieve sources for
   * @returns An array of tasks that are sources of the given task
   */
  public getSourceTasks(taskId: unknown): ITask<any, any, any>[] {
    return this.getSourceDataflows(taskId).map((dataflow) => this.getTask(dataflow.sourceTaskId)!);
  }

  /**
   * Retrieves the tasks that are targets of a given task
   * @param taskId The id of the task to retrieve targets for
   * @returns An array of tasks that are targets of the given task
   */
  public getTargetTasks(taskId: unknown): ITask<any, any, any>[] {
    return this.getTargetDataflows(taskId).map((dataflow) => this.getTask(dataflow.targetTaskId)!);
  }

  /**
   * Removes a task from the task graph
   * @param taskId The id of the task to remove
   * @returns The current task graph
   */
  public removeTask(taskId: unknown) {
    return this._dag.removeNode(taskId);
  }

  public resetGraph() {
    this.runner.resetGraph(this, uuid4());
  }

  /**
   * Converts the task graph to a JSON format suitable for dependency tracking
   * @returns An array of JsonTaskItem objects, each representing a task and its dependencies
   */
  public toJSON(): TaskGraphJson {
    const tasks = this.getTasks().map((node) => node.toJSON());
    const dataflows = this.getDataflows().map((df) => df.toJSON());
    return {
      tasks,
      dataflows,
    };
  }

  /**
   * Converts the task graph to a JSON format suitable for dependency tracking
   * @returns An array of JsonTaskItem objects, each representing a task and its dependencies
   */
  public toDependencyJSON(): JsonTaskItem[] {
    const tasks = this.getTasks().flatMap((node) => node.toDependencyJSON());
    this.getDataflows().forEach((df) => {
      const target = tasks.find((node) => node.id === df.targetTaskId)!;
      if (!target.dependencies) {
        target.dependencies = {};
      }
      const targetDeps = target.dependencies[df.targetTaskPortId];
      if (!targetDeps) {
        target.dependencies[df.targetTaskPortId] = {
          id: df.sourceTaskId,
          output: df.sourceTaskPortId,
        };
      } else {
        if (Array.isArray(targetDeps)) {
          targetDeps.push({
            id: df.sourceTaskId,
            output: df.sourceTaskPortId,
          });
        } else {
          target.dependencies[df.targetTaskPortId] = [
            targetDeps,
            { id: df.sourceTaskId, output: df.sourceTaskPortId },
          ];
        }
      }
    });
    return tasks;
  }

  // ========================================================================
  // Event handling
  // ========================================================================

  /**
   * Event emitter for task lifecycle events
   */
  public get events(): EventEmitter<TaskGraphStatusListeners> {
    if (!this._events) {
      this._events = new EventEmitter<TaskGraphStatusListeners>();
    }
    return this._events;
  }
  protected _events: EventEmitter<TaskGraphStatusListeners> | undefined;

  /**
   * Subscribes to an event
   * @param name - The event name to listen for
   * @param fn - The callback function to execute when the event occurs
   * @returns a function to unsubscribe from the event
   */
  public subscribe<Event extends TaskGraphEvents>(
    name: Event,
    fn: TaskGraphEventListener<Event>
  ): () => void {
    this.on(name, fn);
    return () => this.off(name, fn);
  }

  /**
   * Subscribes to status changes on all tasks (existing and future)
   * @param callback - Function called when any task's status changes
   * @param callback.taskId - The ID of the task whose status changed
   * @param callback.status - The new status of the task
   * @returns a function to unsubscribe from all task status events
   */
  public subscribeToTaskStatus(
    callback: (taskId: TaskIdType, status: TaskStatus) => void
  ): () => void {
    const unsubscribes: (() => void)[] = [];

    // Subscribe to status events on all existing tasks
    const tasks = this.getTasks();
    tasks.forEach((task) => {
      const unsub = task.subscribe("status", (status) => {
        callback(task.config.id, status);
      });
      unsubscribes.push(unsub);
    });

    const handleTaskAdded = (taskId: TaskIdType) => {
      const task = this.getTask(taskId);
      if (!task || typeof task.subscribe !== "function") return;

      const unsub = task.subscribe("status", (status) => {
        callback(task.config.id, status);
      });
      unsubscribes.push(unsub);
    };

    const graphUnsub = this.subscribe("task_added", handleTaskAdded);
    unsubscribes.push(graphUnsub);

    // Return unsubscribe function
    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }

  /**
   * Subscribes to progress updates on all tasks (existing and future)
   * @param callback - Function called when any task reports progress
   * @param callback.taskId - The ID of the task reporting progress
   * @param callback.progress - The progress value (0-100)
   * @param callback.message - Optional progress message
   * @param callback.args - Additional arguments passed with the progress update
   * @returns a function to unsubscribe from all task progress events
   */
  public subscribeToTaskProgress(
    callback: (taskId: TaskIdType, progress: number, message?: string, ...args: any[]) => void
  ): () => void {
    const unsubscribes: (() => void)[] = [];

    // Subscribe to progress events on all existing tasks
    const tasks = this.getTasks();
    tasks.forEach((task) => {
      const unsub = task.subscribe("progress", (progress, message, ...args) => {
        callback(task.config.id, progress, message, ...args);
      });
      unsubscribes.push(unsub);
    });

    const handleTaskAdded = (taskId: TaskIdType) => {
      const task = this.getTask(taskId);
      if (!task || typeof task.subscribe !== "function") return;

      const unsub = task.subscribe("progress", (progress, message, ...args) => {
        callback(task.config.id, progress, message, ...args);
      });
      unsubscribes.push(unsub);
    };

    const graphUnsub = this.subscribe("task_added", handleTaskAdded);
    unsubscribes.push(graphUnsub);

    // Return unsubscribe function
    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }

  /**
   * Subscribes to status changes on all dataflows (existing and future)
   * @param callback - Function called when any dataflow's status changes
   * @param callback.dataflowId - The ID of the dataflow whose status changed
   * @param callback.status - The new status of the dataflow
   * @returns a function to unsubscribe from all dataflow status events
   */
  public subscribeToDataflowStatus(
    callback: (dataflowId: DataflowIdType, status: TaskStatus) => void
  ): () => void {
    const unsubscribes: (() => void)[] = [];

    // Subscribe to status events on all existing dataflows
    const dataflows = this.getDataflows();
    dataflows.forEach((dataflow) => {
      const unsub = dataflow.subscribe("status", (status) => {
        callback(dataflow.id, status);
      });
      unsubscribes.push(unsub);
    });

    const handleDataflowAdded = (dataflowId: DataflowIdType) => {
      const dataflow = this.getDataflow(dataflowId);
      if (!dataflow || typeof dataflow.subscribe !== "function") return;

      const unsub = dataflow.subscribe("status", (status) => {
        callback(dataflow.id, status);
      });
      unsubscribes.push(unsub);
    };

    const graphUnsub = this.subscribe("dataflow_added", handleDataflowAdded);
    unsubscribes.push(graphUnsub);

    // Return unsubscribe function
    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }

  /**
   * Registers an event listener for the specified event
   * @param name - The event name to listen for
   * @param fn - The callback function to execute when the event occurs
   */
  on<Event extends TaskGraphEvents>(name: Event, fn: TaskGraphEventListener<Event>) {
    const dagEvent = EventTaskGraphToDagMapping[name as keyof typeof EventTaskGraphToDagMapping];
    if (dagEvent) {
      // Safe cast: TaskGraph dag events (task_added, etc.) have the same signature as
      // the underlying DAG events (node-added, etc.) - both pass IDs, not full objects
      return this._dag.on(dagEvent, fn as Parameters<typeof this._dag.on>[1]);
    }
    return this.events.on(
      name as TaskGraphStatusEvents,
      fn as TaskGraphEventListener<TaskGraphStatusEvents>
    );
  }

  /**
   * Removes an event listener for the specified event
   * @param name - The event name to listen for
   * @param fn - The callback function to execute when the event occurs
   */
  off<Event extends TaskGraphEvents>(name: Event, fn: TaskGraphEventListener<Event>) {
    const dagEvent = EventTaskGraphToDagMapping[name as keyof typeof EventTaskGraphToDagMapping];
    if (dagEvent) {
      // Safe cast: TaskGraph dag events (task_added, etc.) have the same signature as
      // the underlying DAG events (node-added, etc.) - both pass IDs, not full objects
      return this._dag.off(dagEvent, fn as Parameters<typeof this._dag.off>[1]);
    }
    return this.events.off(
      name as TaskGraphStatusEvents,
      fn as TaskGraphEventListener<TaskGraphStatusEvents>
    );
  }

  /**
   * Emits an event for the specified event
   * @param name - The event name to emit
   * @param args - The arguments to pass to the event listener
   */
  emit<E extends GraphEventDagEvents>(name: E, ...args: GraphEventDagParameters<E>): void;
  emit<E extends TaskGraphStatusEvents>(name: E, ...args: TaskGraphEventStatusParameters<E>): void;
  emit(name: string, ...args: any[]): void {
    const dagEvent = EventTaskGraphToDagMapping[name as keyof typeof EventTaskGraphToDagMapping];
    if (dagEvent) {
      // @ts-ignore
      return this.emit_dag(name, ...args);
    } else {
      // @ts-ignore
      return this.emit_local(name, ...args);
    }
  }

  /**
   * Emits an event for the specified event
   * @param name - The event name to emit
   * @param args - The arguments to pass to the event listener
   */
  protected emit_local<Event extends TaskGraphStatusEvents>(
    name: Event,
    ...args: TaskGraphEventStatusParameters<Event>
  ) {
    return this.events?.emit(name, ...args);
  }

  /**
   * Emits an event for the specified event
   * @param name - The event name to emit
   * @param args - The arguments to pass to the event listener
   */
  protected emit_dag<Event extends GraphEventDagEvents>(
    name: Event,
    ...args: GraphEventDagParameters<Event>
  ) {
    const dagEvent = EventTaskGraphToDagMapping[name as keyof typeof EventTaskGraphToDagMapping];
    // Safe cast: GraphEventDagParameters matches the DAG's emit parameters (both are ID-based)
    return this._dag.emit(dagEvent, ...(args as unknown as [unknown]));
  }
}

/**
 * Super simple helper if you know the input and output handles, and there is only one each
 *
 * @param tasks
 * @param inputHandle
 * @param outputHandle
 * @returns
 */
function serialGraphEdges(
  tasks: ITask<any, any, any>[],
  inputHandle: string,
  outputHandle: string
): Dataflow[] {
  const edges: Dataflow[] = [];
  for (let i = 0; i < tasks.length - 1; i++) {
    edges.push(new Dataflow(tasks[i].config.id, inputHandle, tasks[i + 1].config.id, outputHandle));
  }
  return edges;
}

/**
 * Super simple helper if you know the input and output handles, and there is only one each
 *
 * @param tasks
 * @param inputHandle
 * @param outputHandle
 * @returns
 */
export function serialGraph(
  tasks: ITask<any, any, any>[],
  inputHandle: string,
  outputHandle: string
): TaskGraph {
  const graph = new TaskGraph();
  graph.addTasks(tasks);
  graph.addDataflows(serialGraphEdges(tasks, inputHandle, outputHandle));
  return graph;
}
