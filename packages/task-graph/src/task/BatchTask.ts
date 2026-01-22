/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type DataPortSchema } from "@workglow/util";
import { TaskGraph } from "../task-graph/TaskGraph";
import { PROPERTY_ARRAY } from "../task-graph/TaskGraphRunner";
import {
  CreateEndLoopWorkflow,
  CreateLoopWorkflow,
  Workflow,
} from "../task-graph/Workflow";
import { IteratorTask, IteratorTaskConfig } from "./IteratorTask";
import type { TaskInput, TaskOutput, TaskTypeName } from "./TaskTypes";

/**
 * Configuration for BatchTask.
 */
export interface BatchTaskConfig extends IteratorTaskConfig {
  /**
   * Number of items per batch.
   * @default 10
   */
  readonly batchSize?: number;

  /**
   * Whether to flatten results from all batches into a single array.
   * When false, results are grouped by batch.
   * @default true
   */
  readonly flattenResults?: boolean;

  /**
   * Whether to execute batches in parallel or sequentially.
   * @default "sequential"
   */
  readonly batchExecutionMode?: "parallel" | "sequential";
}

/**
 * BatchTask processes an array in configurable chunks/batches.
 *
 * This task is useful for:
 * - Rate-limited API calls that accept multiple items
 * - Memory-constrained processing
 * - Progress tracking at batch granularity
 *
 * ## Features
 *
 * - Groups array into chunks of batchSize
 * - Runs inner workflow per batch (receives array of items)
 * - Configurable batch and within-batch execution
 * - Optional result flattening
 *
 * ## Usage
 *
 * ```typescript
 * // Process in batches of 10
 * workflow
 *   .input({ documents: [...100 docs...] })
 *   .batch({ batchSize: 10 })
 *     .bulkEmbed()
 *     .bulkStore()
 *   .endBatch()
 *
 * // Sequential batches for rate limiting
 * workflow
 *   .batch({ batchSize: 5, batchExecutionMode: "sequential" })
 *     .apiCall()
 *   .endBatch()
 * ```
 *
 * @template Input - The input type containing the array to batch
 * @template Output - The output type (collected batch results)
 * @template Config - The configuration type
 */
export class BatchTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends BatchTaskConfig = BatchTaskConfig,
> extends IteratorTask<Input, Output, Config> {
  public static type: TaskTypeName = "BatchTask";
  public static category: string = "Flow Control";
  public static title: string = "Batch";
  public static description: string = "Processes an array in configurable batches";

  /**
   * BatchTask always uses PROPERTY_ARRAY merge strategy.
   */
  public static readonly compoundMerge = PROPERTY_ARRAY;

  /**
   * Static input schema for BatchTask.
   */
  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  /**
   * Static output schema for BatchTask.
   */
  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  /**
   * Gets the batch size.
   */
  public override get batchSize(): number {
    return this.config.batchSize ?? 10;
  }

  /**
   * Whether to flatten results from all batches.
   */
  public get flattenResults(): boolean {
    return this.config.flattenResults ?? true;
  }

  /**
   * Batch execution mode.
   */
  public get batchExecutionMode(): "parallel" | "sequential" {
    return this.config.batchExecutionMode ?? "sequential";
  }

  /**
   * Override to group items into batches instead of individual items.
   */
  protected override getIterableItems(input: Input): unknown[] {
    const items = super.getIterableItems(input);
    return this.groupIntoBatches(items);
  }

  /**
   * Groups items into batches of batchSize.
   */
  protected groupIntoBatches(items: unknown[]): unknown[][] {
    const batches: unknown[][] = [];
    const size = this.batchSize;

    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }

    return batches;
  }

  /**
   * Creates iteration tasks for batches.
   * Each batch receives the array of items for that batch.
   */
  protected override createIterationTasks(batches: unknown[]): void {
    const portName = this.getIteratorPortName();
    if (!portName) return;

    // Get all non-iterator input values
    const baseInput: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.runInputData)) {
      if (key !== portName) {
        baseInput[key] = value;
      }
    }

    // Create tasks for each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchInput = {
        ...baseInput,
        [portName]: batch, // Batch is an array of items
        _batchIndex: i,
        _batchItems: batch,
      };

      this.cloneTemplateForIteration(batchInput, i);
    }
  }

  /**
   * Returns the empty result for BatchTask.
   */
  protected override getEmptyResult(): Output {
    const schema = this.outputSchema();
    if (typeof schema === "boolean") {
      return {} as Output;
    }

    const result: Record<string, unknown[]> = {};
    for (const key of Object.keys(schema.properties || {})) {
      result[key] = [];
    }

    return result as Output;
  }

  /**
   * Output schema for BatchTask.
   * Similar to MapTask - wraps inner outputs in arrays.
   */
  public override outputSchema(): DataPortSchema {
    if (!this.hasChildren() && !this._templateGraph) {
      return (this.constructor as typeof BatchTask).outputSchema();
    }

    return this.getWrappedOutputSchema();
  }

  /**
   * Collects and optionally flattens results from all batches.
   */
  protected override collectResults(results: TaskOutput[]): Output {
    const collected = super.collectResults(results);

    if (!this.flattenResults || typeof collected !== "object" || collected === null) {
      return collected;
    }

    // Flatten nested arrays (from batch results)
    const flattened: Record<string, unknown[]> = {};
    for (const [key, value] of Object.entries(collected)) {
      if (Array.isArray(value)) {
        // Deep flatten for batch results
        flattened[key] = value.flat(2);
      } else {
        flattened[key] = value as unknown[];
      }
    }

    return flattened as Output;
  }

  /**
   * Regenerates the graph for batch execution.
   */
  public override regenerateGraph(): void {
    // Clear the existing subgraph
    this.subGraph = new TaskGraph();

    if (!this._templateGraph || !this._templateGraph.getTasks().length) {
      super.regenerateGraph();
      return;
    }

    const batches = this.getIterableItems(this.runInputData as Input);
    if (batches.length === 0) {
      super.regenerateGraph();
      return;
    }

    // Create tasks for each batch
    this.createIterationTasks(batches);

    // Emit regenerate event
    this.events.emit("regenerate");
  }
}

// ============================================================================
// Workflow Prototype Extensions
// ============================================================================

declare module "../task-graph/Workflow" {
  interface Workflow {
    /**
     * Starts a batch loop that processes arrays in chunks.
     * Use .endBatch() to close the loop and return to the parent workflow.
     *
     * @param config - Configuration for the batch loop
     * @returns A Workflow in loop builder mode for defining the batch processing
     *
     * @example
     * ```typescript
     * workflow
     *   .batch({ batchSize: 10 })
     *     .bulkProcess()
     *   .endBatch()
     * ```
     */
    // batch(config?: Partial<BatchTaskConfig>): Workflow;
    batch: CreateLoopWorkflow<TaskInput, TaskOutput, BatchTaskConfig>;

    /**
     * Ends the batch loop and returns to the parent workflow.
     * Only callable on workflows in loop builder mode.
     *
     * @returns The parent workflow
     */
    endBatch(): Workflow;
  }
}

Workflow.prototype.batch = CreateLoopWorkflow(BatchTask);

Workflow.prototype.endBatch = CreateEndLoopWorkflow("endBatch");
