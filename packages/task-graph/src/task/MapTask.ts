/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util";
import { PROPERTY_ARRAY } from "../task-graph/TaskGraphRunner";
import { CreateEndLoopWorkflow, CreateLoopWorkflow, Workflow } from "../task-graph/Workflow";
import { IteratorTask, IteratorTaskConfig } from "./IteratorTask";
import type { TaskInput, TaskOutput, TaskTypeName } from "./TaskTypes";

/**
 * Configuration for MapTask.
 */
export interface MapTaskConfig extends IteratorTaskConfig {
  /**
   * Whether to preserve the order of results matching the input order.
   * When false, results may be in completion order.
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
 * MapTask transforms one or more array inputs by running a workflow for each index.
 */
export class MapTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends MapTaskConfig = MapTaskConfig,
> extends IteratorTask<Input, Output, Config> {
  public static type: TaskTypeName = "MapTask";
  public static category: string = "Flow Control";
  public static title: string = "Map";
  public static description: string = "Transforms array inputs by running a workflow per item";

  /**
   * MapTask always uses PROPERTY_ARRAY merge strategy to collect results.
   */
  public static readonly compoundMerge = PROPERTY_ARRAY;

  /**
   * Static input schema for MapTask.
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

  public override preserveIterationOrder(): boolean {
    return this.preserveOrder;
  }

  /**
   * Returns the empty result for MapTask.
   */
  public override getEmptyResult(): Output {
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
    if (!this.hasChildren()) {
      return (this.constructor as typeof MapTask).outputSchema();
    }

    return this.getWrappedOutputSchema();
  }

  /**
   * Collects and optionally flattens results from all iterations.
   */
  public override collectResults(results: TaskOutput[]): Output {
    const collected = super.collectResults(results);

    if (!this.flatten || typeof collected !== "object" || collected === null) {
      return collected;
    }

    const flattened: Record<string, unknown[]> = {};
    for (const [key, value] of Object.entries(collected)) {
      if (Array.isArray(value)) {
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
     * Starts a map loop that transforms each element in array input ports.
     * Use .endMap() to close the loop and return to the parent workflow.
     */
    map: CreateLoopWorkflow<TaskInput, TaskOutput, MapTaskConfig>;

    /**
     * Ends the map loop and returns to the parent workflow.
     */
    endMap(): Workflow;
  }
}

queueMicrotask(() => {
  Workflow.prototype.map = CreateLoopWorkflow(MapTask);
  Workflow.prototype.endMap = CreateEndLoopWorkflow("endMap");
});
