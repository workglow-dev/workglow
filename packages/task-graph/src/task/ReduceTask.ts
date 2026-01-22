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
import { IteratorTask, IteratorTaskConfig } from "./IteratorTask";
import type { IExecuteContext } from "./ITask";
import type { TaskInput, TaskOutput, TaskTypeName } from "./TaskTypes";

/**
 * Configuration for ReduceTask.
 */
export interface ReduceTaskConfig<Accumulator = unknown> extends IteratorTaskConfig {
  /**
   * The initial value for the accumulator.
   * This is the starting value before processing any items.
   */
  readonly initialValue?: Accumulator;

  /**
   * Name of the accumulator port in the inner workflow input.
   * @default "accumulator"
   */
  readonly accumulatorPort?: string;

  /**
   * Name of the current item port in the inner workflow input.
   * @default "currentItem"
   */
  readonly currentItemPort?: string;

  /**
   * Name of the index port in the inner workflow input.
   * @default "index"
   */
  readonly indexPort?: string;
}

/**
 * ReduceTask processes array elements sequentially with an accumulator.
 *
 * This task implements the functional reduce/fold pattern:
 * - Starts with an initial accumulator value
 * - Processes items one at a time (always sequential)
 * - Passes accumulator, current item, and index to each iteration
 * - Uses the output as the new accumulator for the next iteration
 *
 * ## Features
 *
 * - Sequential-only execution (accumulator pattern requires it)
 * - Configurable initial value
 * - Access to accumulator, current item, and index
 * - Final output is the last accumulator value
 *
 * ## Usage
 *
 * ```typescript
 * // Sum all numbers
 * workflow
 *   .input({ numbers: [1, 2, 3, 4, 5] })
 *   .reduce({ initialValue: { sum: 0 } })
 *     .addToSum()  // receives { accumulator, currentItem, index }
 *   .endReduce()
 *   // Result: { sum: 15 }
 *
 * // Build a string from parts
 * workflow
 *   .reduce({ initialValue: { text: "" } })
 *     .appendText()
 *   .endReduce()
 * ```
 *
 * @template Input - The input type containing the array to reduce
 * @template Output - The output/accumulator type
 * @template Config - The configuration type
 */
export class ReduceTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends ReduceTaskConfig<Output> = ReduceTaskConfig<Output>,
> extends IteratorTask<Input, Output, Config> {
  public static type: TaskTypeName = "ReduceTask";
  public static category: string = "Flow Control";
  public static title: string = "Reduce";
  public static description: string =
    "Processes array elements sequentially with an accumulator (fold)";


  constructor(input: Partial<Input> = {}, config: Partial<Config> = {}) {
    // Force sequential execution for reduce
    const reduceConfig = {
      ...config,
      executionMode: "sequential" as const,
    };
    super(input, reduceConfig as Config);
  }

  // ========================================================================
  // Configuration Accessors
  // ========================================================================

  /**
   * Gets the initial accumulator value.
   */
  public get initialValue(): Output {
    return (this.config.initialValue ?? {}) as Output;
  }

  /**
   * Gets the accumulator port name.
   */
  public get accumulatorPort(): string {
    return this.config.accumulatorPort ?? "accumulator";
  }

  /**
   * Gets the current item port name.
   */
  public get currentItemPort(): string {
    return this.config.currentItemPort ?? "currentItem";
  }

  /**
   * Gets the index port name.
   */
  public get indexPort(): string {
    return this.config.indexPort ?? "index";
  }

  // ========================================================================
  // Execution
  // ========================================================================

  /**
   * Execute the reduce operation.
   * Processes items sequentially, passing accumulator through each iteration.
   */
  public override async execute(
    input: Input,
    context: IExecuteContext
  ): Promise<Output | undefined> {
    if (!this._templateGraph || this._templateGraph.getTasks().length === 0) {
      // No template - just return initial value
      return this.initialValue;
    }

    const items = this.getIterableItems(input);
    if (items.length === 0) {
      return this.initialValue;
    }

    let accumulator: Output = { ...this.initialValue };

    // Process each item sequentially
    for (let index = 0; index < items.length; index++) {
      if (context.signal?.aborted) {
        break;
      }

      const currentItem = items[index];

      // Build input for this reduction step
      const stepInput = {
        ...input,
        [this.accumulatorPort]: accumulator,
        [this.currentItemPort]: currentItem,
        [this.indexPort]: index,
      };

      // Clone template for this step
      this.subGraph = this.cloneTemplateForStep(index);

      // Run the subgraph
      const results = await this.subGraph.run<Output>(stepInput as Input, {
        parentSignal: context.signal,
      });

      // Merge results to get new accumulator
      accumulator = this.subGraph.mergeExecuteOutputsToRunOutput(
        results,
        this.compoundMerge
      ) as Output;

      // Update progress
      const progress = Math.round(((index + 1) / items.length) * 100);
      await context.updateProgress(progress, `Processing item ${index + 1}/${items.length}`);
    }

    return accumulator;
  }

  /**
   * Returns the initial value as empty result.
   */
  protected override getEmptyResult(): Output {
    return this.initialValue;
  }

  /**
   * Clones the template graph for a specific reduction step.
   */
  protected cloneTemplateForStep(stepIndex: number): TaskGraph {
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
          id: `${templateTask.config.id}_step${stepIndex}`,
          name: `${templateTask.config.name || templateTask.type} [${stepIndex}]`,
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
   * Static input schema for ReduceTask.
   * Includes standard accumulator/item/index ports.
   */
  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        accumulator: {
          title: "Accumulator",
          description: "The current accumulator value",
        },
        currentItem: {
          title: "Current Item",
          description: "The current item being processed",
        },
        index: {
          type: "number",
          title: "Index",
          description: "The current item index",
        },
      },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  /**
   * Static output schema for ReduceTask.
   */
  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  /**
   * Instance output schema - returns the accumulator schema from template.
   */
  public override outputSchema(): DataPortSchema {
    if (!this._templateGraph) {
      return (this.constructor as typeof ReduceTask).outputSchema();
    }

    // Get ending nodes from template
    const tasks = this._templateGraph.getTasks();
    const endingNodes = tasks.filter(
      (task) => this._templateGraph!.getTargetDataflows(task.config.id).length === 0
    );

    if (endingNodes.length === 0) {
      return (this.constructor as typeof ReduceTask).outputSchema();
    }

    const properties: Record<string, unknown> = {};

    // Merge output schemas from ending nodes (not wrapped in arrays for reduce)
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

  /**
   * Override regenerateGraph to do nothing for ReduceTask.
   * We create subgraphs on-the-fly during execution.
   */
  public override regenerateGraph(): void {
    // Don't regenerate - we create graphs dynamically during execution
    this.events.emit("regenerate");
  }
}

// ============================================================================
// Workflow Prototype Extensions
// ============================================================================

declare module "../task-graph/Workflow" {
  interface Workflow {
    /**
     * Starts a reduce loop that processes items with an accumulator.
     * Use .endReduce() to close the loop and return to the parent workflow.
     *
     * @param config - Configuration for the reduce loop
     * @returns A Workflow in loop builder mode for defining the reduction
     *
     * @example
     * ```typescript
     * workflow
     *   .reduce({ initialValue: { sum: 0 } })
     *     .addToAccumulator()
     *   .endReduce()
     * ```
     */
    reduce: CreateLoopWorkflow<TaskInput, TaskOutput, ReduceTaskConfig<any>>;

    /**
     * Ends the reduce loop and returns to the parent workflow.
     * Only callable on workflows in loop builder mode.
     *
     * @returns The parent workflow
     */
    endReduce(): Workflow;
  }
}

Workflow.prototype.reduce = CreateLoopWorkflow(ReduceTask);

Workflow.prototype.endReduce = CreateEndLoopWorkflow("endReduce");
