/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util";
import { TaskGraph } from "../task-graph/TaskGraph";
import {
  CreateEndLoopWorkflow,
  CreateLoopWorkflow,
  Workflow,
} from "../task-graph/Workflow";
import { GraphAsTask, GraphAsTaskConfig } from "./GraphAsTask";
import type { IExecuteContext } from "./ITask";
import { TaskConfigurationError } from "./TaskError";
import type { TaskInput, TaskOutput, TaskTypeName } from "./TaskTypes";

/**
 * Condition function type for WhileTask.
 * Receives the current output and iteration count, returns whether to continue looping.
 *
 * @param output - The output from the last iteration
 * @param iteration - The current iteration number (0-based)
 * @returns true to continue looping, false to stop
 */
export type WhileConditionFn<Output> = (output: Output, iteration: number) => boolean;

/**
 * Configuration for WhileTask.
 */
export interface WhileTaskConfig<Output extends TaskOutput = TaskOutput>
  extends GraphAsTaskConfig {
  /**
   * Condition function that determines whether to continue looping.
   * Called after each iteration with the current output and iteration count.
   * Returns true to continue, false to stop.
   */
  readonly condition?: WhileConditionFn<Output>;

  /**
   * Maximum number of iterations to prevent infinite loops.
   * @default 100
   */
  readonly maxIterations?: number;

  /**
   * Whether to pass the output of each iteration as input to the next.
   * When true, output from iteration N becomes input to iteration N+1.
   * @default true
   */
  readonly chainIterations?: boolean;
}

/**
 * WhileTask loops until a condition function returns false.
 *
 * This task is useful for:
 * - Iterative refinement processes
 * - Polling until a condition is met
 * - Convergence algorithms
 * - Retry logic with conditions
 *
 * ## Features
 *
 * - Loops until condition returns false
 * - Configurable maximum iterations (safety limit)
 * - Passes output from each iteration to the next
 * - Access to iteration count in condition function
 *
 * ## Usage
 *
 * ```typescript
 * // Refine until quality threshold
 * workflow
 *   .while({
 *     condition: (output, iteration) => output.quality < 0.9 && iteration < 10,
 *     maxIterations: 20
 *   })
 *     .refineResult()
 *     .evaluateQuality()
 *   .endWhile()
 *
 * // Retry until success
 * workflow
 *   .while({
 *     condition: (output) => !output.success,
 *     maxIterations: 5
 *   })
 *     .attemptOperation()
 *   .endWhile()
 * ```
 *
 * @template Input - The input type for the while task
 * @template Output - The output type for the while task
 * @template Config - The configuration type
 */
export class WhileTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends WhileTaskConfig<Output> = WhileTaskConfig<Output>,
> extends GraphAsTask<Input, Output, Config> {
  public static type: TaskTypeName = "WhileTask";
  public static category: string = "Flow Control";
  public static title: string = "While Loop";
  public static description: string = "Loops until a condition function returns false";

  /** This task has dynamic schemas based on the inner workflow */
  public static hasDynamicSchemas: boolean = true;

  /**
   * The template subgraph that will be executed each iteration.
   */
  protected _templateGraph: TaskGraph | undefined;

  /**
   * Current iteration count during execution.
   */
  protected _currentIteration: number = 0;

  constructor(input: Partial<Input> = {}, config: Partial<Config> = {}) {
    super(input, config as Config);
  }

  // ========================================================================
  // Configuration Accessors
  // ========================================================================

  /**
   * Gets the condition function.
   */
  public get condition(): WhileConditionFn<Output> | undefined {
    return this.config.condition;
  }

  /**
   * Gets the maximum iterations limit.
   */
  public get maxIterations(): number {
    return this.config.maxIterations ?? 100;
  }

  /**
   * Whether to chain iteration outputs to inputs.
   */
  public get chainIterations(): boolean {
    return this.config.chainIterations ?? true;
  }

  /**
   * Gets the current iteration count.
   */
  public get currentIteration(): number {
    return this._currentIteration;
  }

  // ========================================================================
  // Template Graph Management
  // ========================================================================

  /**
   * Sets the template graph that defines the workflow to run each iteration.
   */
  public setTemplateGraph(graph: TaskGraph): void {
    this._templateGraph = graph;
  }

  /**
   * Gets the template graph.
   */
  public getTemplateGraph(): TaskGraph | undefined {
    return this._templateGraph;
  }

  // ========================================================================
  // Execution
  // ========================================================================

  /**
   * Execute the while loop.
   */
  public async execute(input: Input, context: IExecuteContext): Promise<Output | undefined> {
    if (!this._templateGraph || this._templateGraph.getTasks().length === 0) {
      throw new TaskConfigurationError(`${this.type}: No template graph set for while loop`);
    }

    if (!this.condition) {
      throw new TaskConfigurationError(`${this.type}: No condition function provided`);
    }

    this._currentIteration = 0;
    let currentInput: Input = { ...input };
    let currentOutput: Output = {} as Output;

    // Execute iterations until condition returns false or max iterations reached
    while (this._currentIteration < this.maxIterations) {
      if (context.signal?.aborted) {
        break;
      }

      // Clone template for this iteration
      this.subGraph = this.cloneTemplateGraph(this._currentIteration);

      // Run the subgraph
      const results = await this.subGraph.run<Output>(currentInput, {
        parentSignal: context.signal,
      });

      // Merge results
      currentOutput = this.subGraph.mergeExecuteOutputsToRunOutput(
        results,
        this.compoundMerge
      ) as Output;

      // Check condition
      if (!this.condition(currentOutput, this._currentIteration)) {
        break;
      }

      // Chain output to input for next iteration if enabled
      if (this.chainIterations) {
        currentInput = { ...currentInput, ...currentOutput } as Input;
      }

      this._currentIteration++;

      // Update progress
      const progress = Math.min(
        (this._currentIteration / this.maxIterations) * 100,
        99
      );
      await context.updateProgress(progress, `Iteration ${this._currentIteration}`);
    }

    return currentOutput;
  }

  /**
   * Clones the template graph for a specific iteration.
   */
  protected cloneTemplateGraph(iteration: number): TaskGraph {
    const clonedGraph = new TaskGraph();

    if (!this._templateGraph) {
      return clonedGraph;
    }

    const templateTasks = this._templateGraph.getTasks();
    const templateDataflows = this._templateGraph.getDataflows();

    // Map from template task ID to cloned task ID
    const idMap = new Map<unknown, unknown>();

    // Clone each task
    for (const templateTask of templateTasks) {
      const TaskClass = templateTask.constructor as any;
      const clonedTask = new TaskClass(
        { ...templateTask.defaults },
        {
          ...templateTask.config,
          id: `${templateTask.config.id}_iter${iteration}`,
          name: `${templateTask.config.name || templateTask.type} [${iteration}]`,
        }
      );

      clonedGraph.addTask(clonedTask);
      idMap.set(templateTask.config.id, clonedTask.config.id);
    }

    // Clone dataflows
    for (const templateDataflow of templateDataflows) {
      const sourceId = idMap.get(templateDataflow.sourceTaskId);
      const targetId = idMap.get(templateDataflow.targetTaskId);

      if (sourceId !== undefined && targetId !== undefined) {
        const { Dataflow } = require("../task-graph/Dataflow");
        const clonedDataflow = new Dataflow(
          sourceId,
          templateDataflow.sourceTaskPortId,
          targetId,
          templateDataflow.targetTaskPortId
        );
        clonedGraph.addDataflow(clonedDataflow);
      }
    }

    return clonedGraph;
  }

  // ========================================================================
  // Schema Methods
  // ========================================================================

  /**
   * Static input schema for WhileTask.
   */
  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  /**
   * Static output schema for WhileTask.
   */
  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        _iterations: {
          type: "number",
          title: "Iterations",
          description: "Number of iterations executed",
        },
      },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  /**
   * Instance output schema - returns final iteration output schema.
   */
  public override outputSchema(): DataPortSchema {
    if (!this._templateGraph) {
      return (this.constructor as typeof WhileTask).outputSchema();
    }

    // Get ending nodes from template
    const tasks = this._templateGraph.getTasks();
    const endingNodes = tasks.filter(
      (task) => this._templateGraph!.getTargetDataflows(task.config.id).length === 0
    );

    if (endingNodes.length === 0) {
      return (this.constructor as typeof WhileTask).outputSchema();
    }

    const properties: Record<string, unknown> = {
      _iterations: {
        type: "number",
        title: "Iterations",
        description: "Number of iterations executed",
      },
    };

    // Merge output schemas from ending nodes
    for (const task of endingNodes) {
      const taskOutputSchema = task.outputSchema();
      if (typeof taskOutputSchema === "boolean") continue;

      const taskProperties = taskOutputSchema.properties || {};
      for (const [key, schema] of Object.entries(taskProperties)) {
        if (!properties[key]) {
          properties[key] = schema;
        }
      }
    }

    return {
      type: "object",
      properties,
      additionalProperties: false,
    } as DataPortSchema;
  }
}

// ============================================================================
// Workflow Prototype Extensions
// ============================================================================

declare module "../task-graph/Workflow" {
  interface Workflow {
    /**
     * Starts a while loop that continues until a condition is false.
     * Use .endWhile() to close the loop and return to the parent workflow.
     *
     * @param config - Configuration for the while loop (must include condition)
     * @returns A Workflow in loop builder mode for defining the loop body
     *
     * @example
     * ```typescript
     * workflow
     *   .while({
     *     condition: (output, iteration) => output.quality < 0.9,
     *     maxIterations: 10
     *   })
     *     .refineResult()
     *   .endWhile()
     * ```
     */
    while: CreateLoopWorkflow<TaskInput, TaskOutput, WhileTaskConfig<any>>;

    /**
     * Ends the while loop and returns to the parent workflow.
     * Only callable on workflows in loop builder mode.
     *
     * @returns The parent workflow
     */
    endWhile(): Workflow;
  }
}

Workflow.prototype.while = CreateLoopWorkflow(WhileTask);

Workflow.prototype.endWhile = CreateEndLoopWorkflow("endWhile");
