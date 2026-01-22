/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util";
import {
  CreateEndLoopWorkflow,
  CreateLoopWorkflow,
  Workflow,
} from "../task-graph/Workflow";
import { IteratorTask, IteratorTaskConfig } from "./IteratorTask";
import type { TaskInput, TaskOutput, TaskTypeName } from "./TaskTypes";

/**
 * Configuration for ForEachTask.
 */
export interface ForEachTaskConfig extends IteratorTaskConfig {
  /**
   * Whether to collect and return results from each iteration.
   * When false (default), ForEachTask is optimized for side effects.
   * When true, results are collected but not transformed.
   * @default false
   */
  readonly shouldCollectResults?: boolean;
}

/**
 * ForEachTask iterates over an array and runs a workflow for each element.
 *
 * This task is optimized for side-effect operations where the primary goal
 * is to process each item rather than collect transformed results.
 * For transformations that collect results, use MapTask instead.
 *
 * ## Features
 *
 * - Iterates over array input
 * - Runs inner workflow for each element
 * - Configurable execution modes (parallel, sequential, etc.)
 * - Optimized for side effects (default: doesn't collect results)
 *
 * ## Usage
 *
 * ```typescript
 * // Using Workflow API
 * workflow
 *   .input({ items: ["a", "b", "c"] })
 *   .forEach()
 *     .processItem()
 *     .saveToDatabase()
 *   .endForEach()
 *
 * // With sequential execution
 * workflow
 *   .forEach({ executionMode: "sequential" })
 *     .processItem()
 *   .endForEach()
 * ```
 *
 * @template Input - The input type containing the array to iterate
 * @template Output - The output type (typically empty for side-effect operations)
 * @template Config - The configuration type
 */
export class ForEachTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends ForEachTaskConfig = ForEachTaskConfig,
> extends IteratorTask<Input, Output, Config> {
  public static type: TaskTypeName = "ForEachTask";
  public static category: string = "Flow Control";
  public static title: string = "For Each";
  public static description: string = "Iterates over an array and runs a workflow for each element";

  /**
   * Static input schema for ForEachTask.
   * Accepts any object with at least one array property.
   */
  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  /**
   * Static output schema for ForEachTask.
   * By default, returns an empty object (side-effect focused).
   */
  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        completed: {
          type: "boolean",
          title: "Completed",
          description: "Whether all iterations completed successfully",
        },
        count: {
          type: "number",
          title: "Count",
          description: "Number of items processed",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Whether to collect results from iterations.
   */
  public get shouldCollectResults(): boolean {
    return this.config.shouldCollectResults ?? false;
  }

  /**
   * Returns the empty result for ForEachTask.
   * Indicates completion with zero items processed.
   */
  protected override getEmptyResult(): Output {
    return {
      completed: true,
      count: 0,
    } as unknown as Output;
  }

  /**
   * Output schema for ForEachTask instance.
   * If shouldCollectResults is enabled, wraps inner output in arrays.
   * Otherwise, returns the simple completion status schema.
   */
  public override outputSchema(): DataPortSchema {
    if (this.shouldCollectResults && (this.hasChildren() || this._templateGraph)) {
      // When collecting results, wrap inner outputs in arrays
      return this.getWrappedOutputSchema();
    }

    // Default: simple completion status
    return (this.constructor as typeof ForEachTask).outputSchema();
  }

  /**
   * Collects results from all iterations.
   * For ForEachTask, this primarily returns completion status.
   */
  protected override collectResults(results: TaskOutput[]): Output {
    if (this.config.shouldCollectResults) {
      // When collecting, return the wrapped results
      return super.collectResults(results);
    }

    // Default: return completion status
    return {
      completed: true,
      count: results.length,
    } as unknown as Output;
  }
}

// ============================================================================
// Workflow Prototype Extensions
// ============================================================================

declare module "../task-graph/Workflow" {
  interface Workflow {
    /**
     * Starts a forEach loop that iterates over an array.
     * Use .endForEach() to close the loop and return to the parent workflow.
     *
     * @param config - Configuration for the forEach loop
     * @returns A Workflow in loop builder mode for defining the loop body
     *
     * @example
     * ```typescript
     * workflow
     *   .forEach({ executionMode: "sequential" })
     *     .processItem()
     *   .endForEach()
     * ```
     */
    forEach: CreateLoopWorkflow<TaskInput, TaskOutput, ForEachTaskConfig>;

    /**
     * Ends the forEach loop and returns to the parent workflow.
     * Only callable on workflows in loop builder mode.
     *
     * @returns The parent workflow
     */
    endForEach(): Workflow;
  }
}

Workflow.prototype.forEach = CreateLoopWorkflow(ForEachTask);

Workflow.prototype.endForEach = CreateEndLoopWorkflow("endForEach");
