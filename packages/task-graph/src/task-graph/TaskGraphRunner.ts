/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  collectPropertyValues,
  ConvertAllToOptionalArray,
  globalServiceRegistry,
  ServiceRegistry,
  uuid4,
} from "@workglow/util";
import { TASK_OUTPUT_REPOSITORY, TaskOutputRepository } from "../storage/TaskOutputRepository";
import { ConditionalTask } from "../task/ConditionalTask";
import { ITask } from "../task/ITask";
import { TaskAbortedError, TaskConfigurationError, TaskError } from "../task/TaskError";
import { TaskInput, TaskOutput, TaskStatus } from "../task/TaskTypes";
import { DATAFLOW_ALL_PORTS } from "./Dataflow";
import { TaskGraph, TaskGraphRunConfig } from "./TaskGraph";
import { DependencyBasedScheduler, TopologicalScheduler } from "./TaskGraphScheduler";

export type GraphSingleTaskResult<T> = {
  id: unknown;
  type: String;
  data: T;
};
export type GraphResultArray<T> = Array<GraphSingleTaskResult<T>>;
export type PropertyArrayGraphResult<T> = ConvertAllToOptionalArray<T>;
export type AnyGraphResult<T> = PropertyArrayGraphResult<T> | GraphResultArray<T>;

export const PROPERTY_ARRAY = "PROPERTY_ARRAY" as const;
export const GRAPH_RESULT_ARRAY = "GRAPH_RESULT_ARRAY" as const;

export type GraphResultMap<T> = {
  // array of results with id for tasks that created them -- output is an array of {id, type, data}[]
  [GRAPH_RESULT_ARRAY]: GraphResultArray<T>;
  // property-array -- output is consolidation of each output property, with duplicate properties turned into an array
  [PROPERTY_ARRAY]: PropertyArrayGraphResult<T>;
};

/**
 * Enum representing the possible compound merge strategies
 */
export type CompoundMergeStrategy = typeof PROPERTY_ARRAY | typeof GRAPH_RESULT_ARRAY;

export type GraphResult<
  Output,
  Merge extends CompoundMergeStrategy,
> = GraphResultMap<Output>[Merge];

/**
 * Class for running a task graph
 * Manages the execution of tasks in a task graph, including caching
 */
export class TaskGraphRunner {
  /**
   * Whether the task graph is currently running
   */
  protected running = false;
  protected reactiveRunning = false;

  /**
   * The task graph to run
   */
  public readonly graph: TaskGraph;

  /**
   * Output cache repository
   */
  protected outputCache?: TaskOutputRepository;
  /**
   * Service registry for this graph run
   */
  protected registry: ServiceRegistry = globalServiceRegistry;
  /**
   * AbortController for cancelling graph execution
   */
  protected abortController: AbortController | undefined;

  /**
   * Maps to track task execution state
   */
  protected inProgressTasks: Map<unknown, Promise<TaskOutput>> = new Map();
  protected inProgressFunctions: Map<unknown, Promise<any>> = new Map();
  protected failedTaskErrors: Map<unknown, TaskError> = new Map();

  /**
   * Constructor for TaskGraphRunner
   * @param graph The task graph to run
   * @param outputCache The task output repository to use for caching task outputs
   * @param processScheduler The scheduler to use for task execution
   * @param reactiveScheduler The scheduler to use for reactive task execution
   */
  constructor(
    graph: TaskGraph,
    outputCache?: TaskOutputRepository,
    protected processScheduler = new DependencyBasedScheduler(graph),
    protected reactiveScheduler = new TopologicalScheduler(graph)
  ) {
    this.graph = graph;
    graph.outputCache = outputCache;
    this.handleProgress = this.handleProgress.bind(this);
  }

  // ========================================================================
  // Public methods
  // ========================================================================

  public async runGraph<ExecuteOutput extends TaskOutput>(
    input: TaskInput = {} as TaskInput,
    config?: TaskGraphRunConfig
  ): Promise<GraphResultArray<ExecuteOutput>> {
    await this.handleStart(config);

    const results: GraphResultArray<ExecuteOutput> = [];
    let error: TaskError | undefined;

    try {
      // TODO: A different graph runner may chunk tasks that are in parallel
      // rather them all currently available
      for await (const task of this.processScheduler.tasks()) {
        if (this.abortController?.signal.aborted) {
          break;
        }

        if (this.failedTaskErrors.size > 0) {
          break;
        }

        const isRootTask = this.graph.getSourceDataflows(task.config.id).length === 0;

        const runAsync = async () => {
          try {
            // Only filter input for non-root tasks; root tasks get the full input
            const taskInput = isRootTask ? input : this.filterInputForTask(task, input);

            const taskPromise = this.runTask(task, taskInput);
            this.inProgressTasks!.set(task.config.id, taskPromise);
            const taskResult = await taskPromise;

            if (this.graph.getTargetDataflows(task.config.id).length === 0) {
              // we save the results of all the leaves
              results.push(taskResult as GraphSingleTaskResult<ExecuteOutput>);
            }
          } catch (error) {
            this.failedTaskErrors.set(task.config.id, error as TaskError);
          } finally {
            // IMPORTANT: Push status to edges BEFORE notifying scheduler
            // This ensures dataflow statuses (including DISABLED) are set
            // before the scheduler checks which tasks are ready
            this.pushStatusFromNodeToEdges(this.graph, task);
            this.pushErrorFromNodeToEdges(this.graph, task);
            this.processScheduler.onTaskCompleted(task.config.id);
          }
        };

        // Start task execution without awaiting
        // so we can have many tasks running in parallel
        // but keep track of them to make sure they get awaited
        // otherwise, things will finish after this promise is resolved
        this.inProgressFunctions.set(Symbol(task.config.id as string), runAsync());
      }
    } catch (err) {
      error = err as Error;
    }
    // Wait for all tasks to complete since we did not await runAsync()/this.runTaskWithProvenance()
    await Promise.allSettled(Array.from(this.inProgressTasks.values()));
    // Clean up stragglers to avoid unhandled promise rejections
    await Promise.allSettled(Array.from(this.inProgressFunctions.values()));

    if (this.failedTaskErrors.size > 0) {
      const latestError = this.failedTaskErrors.values().next().value!;
      this.handleError(latestError);
      throw latestError;
    }
    if (this.abortController?.signal.aborted) {
      await this.handleAbort();
      throw new TaskAbortedError();
    }

    await this.handleComplete();

    return results;
  }

  /**
   * Runs the task graph in a reactive manner
   * @param input Optional input to pass to root tasks (tasks with no incoming dataflows)
   * @returns A promise that resolves when all tasks are complete
   * @throws TaskConfigurationError if the graph is already running reactively
   */
  public async runGraphReactive<Output extends TaskOutput>(
    input: TaskInput = {} as TaskInput
  ): Promise<GraphResultArray<Output>> {
    await this.handleStartReactive();

    const results: GraphResultArray<Output> = [];
    try {
      for await (const task of this.reactiveScheduler.tasks()) {
        const isRootTask = this.graph.getSourceDataflows(task.config.id).length === 0;

        if (task.status === TaskStatus.PENDING) {
          task.resetInputData();
          this.copyInputFromEdgesToNode(task);
          // TODO: cacheable here??
          // if (task.cacheable) {
          //   const results = await this.outputCache?.getOutput(
          //     (task.constructor as any).type,
          //     task.runInputData
          //   );
          //   if (results) {
          //     task.runOutputData = results;
          //   }
          // }
        }

        // For root tasks (no incoming dataflows), apply the input parameter
        // This is important for GraphAsTask subgraphs where the InputTask needs
        // to receive the parent's input values
        const taskInput = isRootTask ? input : {};

        const taskResult = await task.runReactive(taskInput);

        await this.pushOutputFromNodeToEdges(task, taskResult);
        if (this.graph.getTargetDataflows(task.config.id).length === 0) {
          results.push({
            id: task.config.id,
            type: (task.constructor as any).runtype || (task.constructor as any).type,
            data: taskResult as Output,
          });
        }
      }
      await this.handleCompleteReactive();
      return results;
    } catch (error) {
      await this.handleErrorReactive();
      throw error;
    }
  }

  /**
   * Aborts the task graph execution
   */
  public abort(): void {
    this.abortController?.abort();
  }

  /**
   * Disables the task graph execution
   */
  public async disable(): Promise<void> {
    await this.handleDisable();
  }

  /**
   * Filters graph-level input to only include properties that are not connected via dataflows for a given task
   * @param task The task to filter input for
   * @param input The graph-level input
   * @returns Filtered input containing only unconnected properties
   */
  protected filterInputForTask(task: ITask, input: TaskInput): TaskInput {
    // Get all inputs that are connected to this task via dataflows
    const sourceDataflows = this.graph.getSourceDataflows(task.config.id);
    const connectedInputs = new Set(sourceDataflows.map((df) => df.targetTaskPortId));

    // If DATAFLOW_ALL_PORTS ("*") is in the set, all inputs are connected
    const allPortsConnected = connectedInputs.has(DATAFLOW_ALL_PORTS);

    // Filter out connected inputs from the graph input
    const filteredInput: TaskInput = {};
    for (const [key, value] of Object.entries(input)) {
      // Skip this input if it's explicitly connected OR if all ports are connected
      if (!connectedInputs.has(key) && !allPortsConnected) {
        filteredInput[key] = value;
      }
    }

    return filteredInput;
  }

  /**
   * Adds input data to a task.
   * Delegates to {@link Task.addInput} for the actual merging logic.
   *
   * @param task The task to add input data to
   * @param overrides The input data to override (or add to if an array)
   */
  public addInputData(task: ITask, overrides: Partial<TaskInput> | undefined): void {
    if (!overrides) return;

    const changed = task.addInput(overrides);

    // TODO(str): This is a hack.
    if (changed && "regenerateGraph" in task && typeof task.regenerateGraph === "function") {
      task.regenerateGraph();
    }
  }

  // ========================================================================
  // Protected Handlers
  // ========================================================================
  public mergeExecuteOutputsToRunOutput<
    ExecuteOutput extends TaskOutput,
    Merge extends CompoundMergeStrategy = CompoundMergeStrategy,
  >(
    results: GraphResultArray<ExecuteOutput>,
    compoundMerge: Merge
  ): GraphResult<ExecuteOutput, Merge> {
    if (compoundMerge === GRAPH_RESULT_ARRAY) {
      return results as GraphResult<ExecuteOutput, Merge>;
    }

    if (compoundMerge === PROPERTY_ARRAY) {
      let fixedOutput = {} as PropertyArrayGraphResult<ExecuteOutput>;
      const outputs = results.map((result: any) => result.data);
      if (outputs.length === 1) {
        fixedOutput = outputs[0];
      } else if (outputs.length > 1) {
        const collected = collectPropertyValues<ExecuteOutput>(outputs as ExecuteOutput[]);
        if (Object.keys(collected).length > 0) {
          fixedOutput = collected;
        }
      }
      return fixedOutput as GraphResult<ExecuteOutput, Merge>;
    }
    throw new TaskConfigurationError(`Unknown compound merge strategy: ${compoundMerge}`);
  }

  /**
   * Copies input data from edges to a task
   * @param task The task to copy input data to
   */
  protected copyInputFromEdgesToNode(task: ITask) {
    const dataflows = this.graph.getSourceDataflows(task.config.id);
    for (const dataflow of dataflows) {
      this.addInputData(task, dataflow.getPortData());
    }
  }

  /**
   * Pushes the output of a task to its target tasks
   * @param node The task that produced the output
   * @param results The output of the task
   */
  protected async pushOutputFromNodeToEdges(node: ITask, results: TaskOutput) {
    const dataflows = this.graph.getTargetDataflows(node.config.id);
    for (const dataflow of dataflows) {
      const compatibility = dataflow.semanticallyCompatible(this.graph, dataflow);
      // console.log("pushOutputFromNodeToEdges", dataflow.id, compatibility, Object.keys(results));
      if (compatibility === "static") {
        dataflow.setPortData(results);
      } else if (compatibility === "runtime") {
        const task = this.graph.getTask(dataflow.targetTaskId)!;
        const narrowed = await task.narrowInput({ ...results }, this.registry);
        dataflow.setPortData(narrowed);
      } else {
        // don't push incompatible data
      }
    }
  }

  /**
   * Pushes the status of a task to its target edges
   * @param node The task that produced the status
   *
   * For ConditionalTask, this method handles selective dataflow status:
   * - Active branch dataflows get COMPLETED status
   * - Inactive branch dataflows get DISABLED status
   */
  protected pushStatusFromNodeToEdges(graph: TaskGraph, node: ITask, status?: TaskStatus): void {
    if (!node?.config?.id) return;

    const dataflows = graph.getTargetDataflows(node.config.id);
    const effectiveStatus = status ?? node.status;

    // Check if this is a ConditionalTask with selective branching
    if (node instanceof ConditionalTask && effectiveStatus === TaskStatus.COMPLETED) {
      // Build a map of output port -> branch ID for lookup
      const branches = node.config.branches ?? [];
      const portToBranch = new Map<string, string>();
      for (const branch of branches) {
        portToBranch.set(branch.outputPort, branch.id);
      }

      const activeBranches = node.getActiveBranches();

      for (const dataflow of dataflows) {
        const branchId = portToBranch.get(dataflow.sourceTaskPortId);
        if (branchId !== undefined) {
          // This dataflow is from a branch port
          if (activeBranches.has(branchId)) {
            // Branch is active - dataflow gets completed status
            dataflow.setStatus(TaskStatus.COMPLETED);
          } else {
            // Branch is inactive - dataflow gets disabled status
            dataflow.setStatus(TaskStatus.DISABLED);
          }
        } else {
          // Not a branch port (e.g., _activeBranches metadata) - use normal status
          dataflow.setStatus(effectiveStatus);
        }
      }

      // Cascade disabled status to downstream tasks
      this.propagateDisabledStatus(graph);
      return;
    }

    // Default behavior for non-conditional tasks
    dataflows.forEach((dataflow) => {
      dataflow.setStatus(effectiveStatus);
    });
  }

  /**
   * Pushes the error of a task to its target edges
   * @param node The task that produced the error
   */
  protected pushErrorFromNodeToEdges(graph: TaskGraph, node: ITask): void {
    if (!node?.config?.id) return;
    graph.getTargetDataflows(node.config.id).forEach((dataflow) => {
      dataflow.error = node.error;
    });
  }

  /**
   * Propagates DISABLED status through the graph.
   *
   * When a task's ALL incoming dataflows are DISABLED, that task becomes unreachable
   * and should also be disabled. This cascades through the graph until no more
   * tasks can be disabled.
   *
   * This is used by ConditionalTask to disable downstream tasks on inactive branches.
   *
   * @param graph The task graph to propagate disabled status through
   */
  protected propagateDisabledStatus(graph: TaskGraph): void {
    let changed = true;

    // Keep iterating until no more changes (fixed-point iteration)
    while (changed) {
      changed = false;

      for (const task of graph.getTasks()) {
        // Only consider tasks that are still pending
        if (task.status !== TaskStatus.PENDING) {
          continue;
        }

        const incomingDataflows = graph.getSourceDataflows(task.config.id);

        // Skip tasks with no incoming dataflows (root tasks)
        if (incomingDataflows.length === 0) {
          continue;
        }

        // Check if ALL incoming dataflows are DISABLED
        const allDisabled = incomingDataflows.every((df) => df.status === TaskStatus.DISABLED);

        if (allDisabled) {
          // This task is unreachable - disable it synchronously
          // Set status directly to avoid async issues
          task.status = TaskStatus.DISABLED;
          task.progress = 100;
          task.completedAt = new Date();
          task.emit("disabled");
          task.emit("status", task.status);

          // Propagate disabled status to its outgoing dataflows
          graph.getTargetDataflows(task.config.id).forEach((dataflow) => {
            dataflow.setStatus(TaskStatus.DISABLED);
          });

          // Mark as completed in scheduler so it doesn't wait for this task
          this.processScheduler.onTaskCompleted(task.config.id);

          changed = true;
        }
      }
    }
  }

  /**
   * Runs a task
   * @param task The task to run
   * @param input The input for the task
   * @returns The output of the task
   */
  protected async runTask<T>(task: ITask, input: TaskInput): Promise<GraphSingleTaskResult<T>> {
    this.copyInputFromEdgesToNode(task);

    const results = await task.runner.run(input, {
      outputCache: this.outputCache,
      updateProgress: async (task: ITask, progress: number, message?: string, ...args: any[]) =>
        await this.handleProgress(task, progress, message, ...args),
      registry: this.registry,
    });

    await this.pushOutputFromNodeToEdges(task, results);

    return {
      id: task.config.id,
      type: (task.constructor as any).runtype || (task.constructor as any).type,
      data: results as T,
    };
  }

  /**
   * Resets a task
   * @param graph The task graph to reset
   * @param task The task to reset
   * @param runId The run ID
   */
  protected resetTask(graph: TaskGraph, task: ITask, runId: string) {
    task.status = TaskStatus.PENDING;
    task.resetInputData();
    task.runOutputData = {};
    task.error = undefined;
    task.progress = 0;
    if (task.config) {
      task.config.runnerId = runId;
    }
    this.pushStatusFromNodeToEdges(graph, task);
    this.pushErrorFromNodeToEdges(graph, task);
    task.emit("reset");
    task.emit("status", task.status);
  }

  /**
   * Resets the task graph, recursively
   * @param graph The task graph to reset
   */
  public resetGraph(graph: TaskGraph, runnerId: string) {
    graph.getTasks().forEach((node) => {
      this.resetTask(graph, node, runnerId);
      node.regenerateGraph();
      if (node.hasChildren()) {
        this.resetGraph(node.subGraph, runnerId);
      }
    });
    graph.getDataflows().forEach((dataflow) => {
      dataflow.reset();
    });
  }

  /**
   * Handles the start of task graph execution
   * @param parentSignal Optional abort signal from parent
   */
  protected async handleStart(config?: TaskGraphRunConfig): Promise<void> {
    // Setup registry - create child from global if not provided
    if (config?.registry !== undefined) {
      this.registry = config.registry;
    } else {
      // Create a child container that inherits from global but allows overrides
      this.registry = new ServiceRegistry(globalServiceRegistry.container.createChildContainer());
    }

    if (config?.outputCache !== undefined) {
      if (typeof config.outputCache === "boolean") {
        if (config.outputCache === true) {
          this.outputCache = this.registry.get(TASK_OUTPUT_REPOSITORY);
        } else {
          this.outputCache = undefined;
        }
      } else {
        this.outputCache = config.outputCache;
      }
      this.graph.outputCache = this.outputCache;
    }
    // Prevent reentrancy
    if (this.running || this.reactiveRunning) {
      throw new TaskConfigurationError("Graph is already running");
    }

    this.running = true;
    this.abortController = new AbortController();
    this.abortController.signal.addEventListener("abort", () => {
      this.handleAbort();
    });

    if (config?.parentSignal?.aborted) {
      this.abortController.abort(); // Immediately abort if the parent is already aborted
      return;
    } else {
      config?.parentSignal?.addEventListener(
        "abort",
        () => {
          this.abortController?.abort();
        },
        { once: true }
      );
    }

    this.resetGraph(this.graph, uuid4());
    this.processScheduler.reset();
    this.inProgressTasks.clear();
    this.inProgressFunctions.clear();
    this.failedTaskErrors.clear();
    this.graph.emit("start");
  }

  protected async handleStartReactive(): Promise<void> {
    if (this.reactiveRunning) {
      throw new TaskConfigurationError("Graph is already running reactively");
    }
    this.reactiveScheduler.reset();
    this.reactiveRunning = true;
  }

  /**
   * Handles the completion of task graph execution
   */
  protected async handleComplete(): Promise<void> {
    this.running = false;
    this.graph.emit("complete");
  }

  protected async handleCompleteReactive(): Promise<void> {
    this.reactiveRunning = false;
  }

  /**
   * Handles errors during task graph execution
   */
  protected async handleError(error: TaskError): Promise<void> {
    await Promise.allSettled(
      this.graph.getTasks().map(async (task: ITask) => {
        if (task.status === TaskStatus.PROCESSING) {
          task.abort();
        }
      })
    );
    this.running = false;
    this.graph.emit("error", error);
  }

  protected async handleErrorReactive(): Promise<void> {
    this.reactiveRunning = false;
  }

  /**
   * Handles task graph abortion
   */
  protected async handleAbort(): Promise<void> {
    this.graph.getTasks().map(async (task: ITask) => {
      if (task.status === TaskStatus.PROCESSING) {
        task.abort();
      }
    });
    this.running = false;
    this.graph.emit("abort");
  }

  protected async handleAbortReactive(): Promise<void> {
    this.reactiveRunning = false;
  }

  /**
   * Handles task graph disabling
   */
  protected async handleDisable(): Promise<void> {
    await Promise.allSettled(
      this.graph.getTasks().map(async (task: ITask) => {
        if (task.status === TaskStatus.PENDING) {
          return task.disable();
        }
      })
    );
    this.running = false;
    this.graph.emit("disabled");
  }

  /**
   * Handles progress updates for the task graph
   * Currently not implemented at the graph level
   * @param progress Progress value (0-100)
   * @param message Optional message
   * @param args Additional arguments
   */
  protected async handleProgress(
    task: ITask,
    progress: number,
    message?: string,
    ...args: any[]
  ): Promise<void> {
    const total = this.graph.getTasks().length;
    if (total > 1) {
      const completed = this.graph.getTasks().reduce((acc, t) => acc + t.progress, 0);
      progress = Math.round(completed / total);
    }
    this.pushStatusFromNodeToEdges(this.graph, task);
    await this.pushOutputFromNodeToEdges(task, task.runOutputData);
    this.graph.emit("graph_progress", progress, message, args);
  }
}
