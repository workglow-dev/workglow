/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util";
import { PROPERTY_ARRAY } from "../task-graph/TaskGraphRunner";
import {
  CreateEndLoopWorkflow,
  CreateLoopWorkflow,
  Workflow,
} from "../task-graph/Workflow";
import { IteratorTask, IteratorTaskConfig } from "./IteratorTask";
import type { TaskInput, TaskOutput, TaskTypeName } from "./TaskTypes";

/**
 * Configuration for MapTask.
 */
export interface MapTaskConfig extends IteratorTaskConfig {
  /**
   * Whether to preserve the order of results matching the input order.
   * When false, results may be in completion order (faster for parallel).
   * @default true
   */
  readonly preserveOrder?: boolean;

  /**
   * Whether to flatten array results from each iteration.
   * When true, if each iteration returns an array, they are concatenated.
   * @default false
   */
  readonly flatten?: boolean;
}

/**
 * MapTask transforms an array by running a workflow for each element and collecting results.
 *
 * This task is the functional-style map operation: it takes an array input,
 * applies a transformation workflow to each element, and returns an array
 * of transformed results.
 *
 * ## Features
 *
 * - Transforms each array element through inner workflow
 * - Collects and returns array of results
 * - Maintains result order by default
 * - Configurable execution modes (parallel, sequential, etc.)
 * - Optional flattening of nested arrays
 *
 * ## Usage
 *
 * ```typescript
 * // Transform texts to embeddings
 * workflow
 *   .input({ texts: ["hello", "world"] })
 *   .map()
 *     .textEmbedding()
 *   .endMap()
 *   // Result: { vectors: [Float32Array, Float32Array] }
 *
 * // With explicit port
 * workflow
 *   .map({ iteratorPort: "documents" })
 *     .enrich()
 *     .chunk()
 *   .endMap()
 * ```
 *
 * @template Input - The input type containing the array to transform
 * @template Output - The output type (array of transformed results)
 * @template Config - The configuration type
 */
export class MapTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends MapTaskConfig = MapTaskConfig,
> extends IteratorTask<Input, Output, Config> {
  public static type: TaskTypeName = "MapTask";
  public static category: string = "Flow Control";
  public static title: string = "Map";
  public static description: string =
    "Transforms an array by running a workflow for each element";

  /**
   * MapTask always uses PROPERTY_ARRAY merge strategy to collect results.
   */
  public static readonly compoundMerge = PROPERTY_ARRAY;

  /**
   * Static input schema for MapTask.
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
   * Static output schema for MapTask.
   * Dynamic based on inner workflow outputs.
   */
  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  /**
   * Whether to preserve order of results.
   */
  public get preserveOrder(): boolean {
    return this.config.preserveOrder ?? true;
  }

  /**
   * Whether to flatten nested array results.
   */
  public get flatten(): boolean {
    return this.config.flatten ?? false;
  }

  /**
   * Returns the empty result for MapTask.
   * Returns empty arrays for each output property.
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
   * Output schema for MapTask.
   * Wraps inner workflow output properties in arrays.
   */
  public override outputSchema(): DataPortSchema {
    if (!this.hasChildren() && !this._templateGraph) {
      return (this.constructor as typeof MapTask).outputSchema();
    }

    return this.getWrappedOutputSchema();
  }

  /**
   * Collects and optionally flattens results from all iterations.
   */
  protected override collectResults(results: TaskOutput[]): Output {
    const collected = super.collectResults(results);

    if (!this.flatten || typeof collected !== "object" || collected === null) {
      return collected;
    }

    // Flatten array properties
    const flattened: Record<string, unknown[]> = {};
    for (const [key, value] of Object.entries(collected)) {
      if (Array.isArray(value)) {
        // Flatten nested arrays
        flattened[key] = value.flat();
      } else {
        flattened[key] = value as unknown[];
      }
    }

    return flattened as Output;
  }
}

// ============================================================================
// Workflow Prototype Extensions
// ============================================================================

declare module "../task-graph/Workflow" {
  interface Workflow {
    /**
     * Starts a map loop that transforms each element in an array.
     * Use .endMap() to close the loop and return to the parent workflow.
     *
     * @param config - Configuration for the map loop
     * @returns A Workflow in loop builder mode for defining the transformation
     *
     * @example
     * ```typescript
     * workflow
     *   .map()
     *     .textEmbedding()
     *   .endMap()
     *   // Result: { vectors: [...] }
     * ```
     */
    map: CreateLoopWorkflow<TaskInput, TaskOutput, MapTaskConfig>;

    /**
     * Ends the map loop and returns to the parent workflow.
     * Only callable on workflows in loop builder mode.
     *
     * @returns The parent workflow
     */
    endMap(): Workflow;
  }
}

Workflow.prototype.map = CreateLoopWorkflow(MapTask);

Workflow.prototype.endMap = CreateEndLoopWorkflow("endMap");
