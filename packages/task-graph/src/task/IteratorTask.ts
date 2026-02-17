/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util";
import { TaskGraph } from "../task-graph/TaskGraph";
import { GraphAsTask, GraphAsTaskConfig } from "./GraphAsTask";
import type { IExecuteContext } from "./ITask";
import { IteratorTaskRunner } from "./IteratorTaskRunner";
import type { StreamEvent, StreamFinish } from "./StreamTypes";
import { TaskConfigurationError } from "./TaskError";
import type { TaskInput, TaskOutput, TaskTypeName } from "./TaskTypes";

/**
 * Standard iteration context schema for IteratorTask subclasses (Map, Reduce).
 * Properties are marked with "x-ui-iteration": true so the builder
 * knows to hide them from parent-level display.
 */
export const ITERATOR_CONTEXT_SCHEMA: DataPortSchema = {
  type: "object",
  properties: {
    _iterationIndex: {
      type: "integer",
      minimum: 0,
      title: "Iteration Index",
      description: "Current iteration index (0-based)",
      "x-ui-iteration": true,
    },
    _iterationCount: {
      type: "integer",
      minimum: 0,
      title: "Iteration Count",
      description: "Total number of iterations",
      "x-ui-iteration": true,
    },
  },
};

/**
 * Execution mode for iterator tasks.
 * - `parallel`: Execute all iterations concurrently (logical mode)
 * - `parallel-limited`: Execute with a concurrency limit
 */
export type ExecutionMode = "parallel" | "parallel-limited";

/**
 * Input mode for a property in the iteration input schema.
 * - "array": Property must be an array (will be iterated)
 * - "scalar": Property must be a scalar (constant for all iterations)
 * - "flexible": Property accepts both array and scalar (T | T[])
 */
export type IterationInputMode = "array" | "scalar" | "flexible";

/**
 * Configuration for a single property in the iteration input schema.
 */
export interface IterationPropertyConfig {
  /** The base schema for the property (without array wrapping) */
  readonly baseSchema: DataPortSchema;
  /** The input mode for this property */
  readonly mode: IterationInputMode;
}

/**
 * Configuration interface for IteratorTask.
 * Extends GraphAsTaskConfig with iterator-specific options.
 */
export interface IteratorTaskConfig extends GraphAsTaskConfig {
  /**
   * Maximum number of concurrent iteration workers
   * @default undefined (unlimited)
   */
  readonly concurrencyLimit?: number;

  /**
   * Number of items per batch. When set, iteration indices are grouped into batches.
   * @default undefined
   */
  readonly batchSize?: number;

  /**
   * User-defined iteration input schema configuration.
   */
  readonly iterationInputConfig?: Record<string, IterationPropertyConfig>;
}

/**
 * Result of detecting the iterator port from the input schema.
 */
interface IteratorPortInfo {
  readonly portName: string;
  readonly itemSchema: DataPortSchema;
}

/**
 * Result of analyzing input for iteration.
 */
export interface IterationAnalysisResult {
  /** The number of iterations to perform */
  readonly iterationCount: number;
  /** Names of properties that are arrays (to be iterated) */
  readonly arrayPorts: string[];
  /** Names of properties that are scalars (passed as constants) */
  readonly scalarPorts: string[];
  /** Gets the input for a specific iteration index */
  getIterationInput(index: number): Record<string, unknown>;
}

function isArrayVariant(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const record = schema as Record<string, unknown>;
  return record.type === "array" || record.items !== undefined;
}

function getExplicitIterationFlag(schema: DataPortSchema | undefined): boolean | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const record = schema as Record<string, unknown>;
  const flag = record["x-ui-iteration"];
  if (flag === true) return true;
  if (flag === false) return false;
  return undefined;
}

function inferIterationFromSchema(schema: DataPortSchema | undefined): boolean | undefined {
  if (!schema || typeof schema !== "object") return undefined;

  const record = schema as Record<string, unknown>;

  if (record.type === "array" || record.items !== undefined) {
    return true;
  }

  const variants = (record.oneOf ?? record.anyOf) as unknown[] | undefined;
  if (!Array.isArray(variants) || variants.length === 0) {
    // Schema does not clearly indicate array/non-array - defer to runtime
    if (record.type !== undefined) {
      return false;
    }
    return undefined;
  }

  let hasArrayVariant = false;
  let hasNonArrayVariant = false;

  for (const variant of variants) {
    if (isArrayVariant(variant)) {
      hasArrayVariant = true;
    } else {
      hasNonArrayVariant = true;
    }
  }

  if (hasArrayVariant && hasNonArrayVariant) return undefined;
  if (hasArrayVariant) return true;
  return false;
}

/**
 * Creates a union type schema (T | T[]) for flexible iteration input.
 */
export function createFlexibleSchema(baseSchema: DataPortSchema): DataPortSchema {
  if (typeof baseSchema === "boolean") return baseSchema;
  return {
    anyOf: [baseSchema, { type: "array", items: baseSchema }],
  } as unknown as DataPortSchema;
}

/**
 * Creates an array schema from a base schema.
 */
export function createArraySchema(baseSchema: DataPortSchema): DataPortSchema {
  if (typeof baseSchema === "boolean") return baseSchema;
  return {
    type: "array",
    items: baseSchema,
  } as DataPortSchema;
}

/**
 * Extracts the base (scalar) schema from a potentially wrapped schema.
 */
export function extractBaseSchema(schema: DataPortSchema): DataPortSchema {
  if (typeof schema === "boolean") return schema;

  const schemaType = (schema as Record<string, unknown>).type;
  if (schemaType === "array" && (schema as Record<string, unknown>).items) {
    return (schema as Record<string, unknown>).items as DataPortSchema;
  }

  const variants = (schema.oneOf ?? schema.anyOf) as DataPortSchema[] | undefined;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (typeof variant === "object") {
        const variantType = (variant as Record<string, unknown>).type;
        if (variantType !== "array") {
          return variant;
        }
      }
    }
    for (const variant of variants) {
      if (typeof variant === "object") {
        const variantType = (variant as Record<string, unknown>).type;
        if (variantType === "array" && (variant as Record<string, unknown>).items) {
          return (variant as Record<string, unknown>).items as DataPortSchema;
        }
      }
    }
  }

  return schema;
}

/**
 * Determines if a schema accepts arrays (is array type or has array in union).
 */
export function schemaAcceptsArray(schema: DataPortSchema): boolean {
  if (typeof schema === "boolean") return false;

  const schemaType = (schema as Record<string, unknown>).type;
  if (schemaType === "array") return true;

  const variants = (schema.oneOf ?? schema.anyOf) as DataPortSchema[] | undefined;
  if (Array.isArray(variants)) {
    return variants.some((variant) => isArrayVariant(variant));
  }

  return false;
}

/**
 * Base class for iterator tasks that process collections of items.
 */
export abstract class IteratorTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends IteratorTaskConfig = IteratorTaskConfig,
> extends GraphAsTask<Input, Output, Config> {
  public static type: TaskTypeName = "IteratorTask";
  public static category: string = "Flow Control";
  public static title: string = "Iterator";
  public static description: string = "Base class for loop-type tasks";

  /** This task has dynamic schemas based on the inner workflow */
  public static hasDynamicSchemas: boolean = true;

  /**
   * Returns the schema for iteration-context inputs that will be
   * injected into the subgraph at runtime.
   */
  public static getIterationContextSchema(): DataPortSchema {
    return ITERATOR_CONTEXT_SCHEMA;
  }

  /** Cached iterator port info from schema analysis. */
  protected _iteratorPortInfo: IteratorPortInfo | undefined;

  /** Cached computed iteration input schema. */
  protected _iterationInputSchema: DataPortSchema | undefined;

  constructor(input: Partial<Input> = {}, config: Partial<Config> = {}) {
    super(input, config as Config);
  }

  // ========================================================================
  // TaskRunner Override
  // ========================================================================

  declare _runner: IteratorTaskRunner<Input, Output, Config>;

  override get runner(): IteratorTaskRunner<Input, Output, Config> {
    if (!this._runner) {
      this._runner = new IteratorTaskRunner<Input, Output, Config>(this);
    }
    return this._runner;
  }

  /**
   * IteratorTask does not support streaming pass-through because its output
   * is an aggregation of multiple iterations (arrays for MapTask, accumulated
   * value for ReduceTask). The inherited GraphAsTask.executeStream is
   * overridden to just emit a finish event (no streaming).
   */
  async *executeStream(
    input: Input,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<Output>> {
    yield { type: "finish", data: input as unknown as Output } as StreamFinish<Output>;
  }

  // ========================================================================
  // Graph hooks
  // ========================================================================

  override set subGraph(subGraph: TaskGraph) {
    super.subGraph = subGraph;
    this.invalidateIterationInputSchema();
    this.events.emit("regenerate");
  }

  override get subGraph(): TaskGraph {
    return super.subGraph;
  }

  public override regenerateGraph(): void {
    this.invalidateIterationInputSchema();
    super.regenerateGraph();
  }

  // ========================================================================
  // Runner hooks
  // ========================================================================

  /**
   * Whether results should be ordered by iteration index.
   * MapTask overrides this to use its `preserveOrder` config.
   */
  public preserveIterationOrder(): boolean {
    return true;
  }

  /**
   * Whether this iterator runs in reduce mode.
   */
  public isReduceTask(): boolean {
    return false;
  }

  /**
   * Initial accumulator for reduce mode.
   */
  public getInitialAccumulator(): Output {
    return {} as Output;
  }

  /**
   * Builds the per-iteration subgraph input.
   */
  public buildIterationRunInput(
    analysis: IterationAnalysisResult,
    index: number,
    iterationCount: number,
    extraInput: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      ...analysis.getIterationInput(index),
      ...extraInput,
      _iterationIndex: index,
      _iterationCount: iterationCount,
    };
  }

  /**
   * Updates the accumulator with one iteration result in reduce mode.
   */
  public mergeIterationIntoAccumulator(
    accumulator: Output,
    iterationResult: TaskOutput | undefined,
    _index: number
  ): Output {
    return (iterationResult ?? accumulator) as Output;
  }

  /**
   * Returns the result when there are no items to iterate.
   */
  public getEmptyResult(): Output {
    return {} as Output;
  }

  /**
   * Collects and merges results from all iterations.
   */
  public collectResults(results: TaskOutput[]): Output {
    if (results.length === 0) {
      return {} as Output;
    }

    const merged: Record<string, unknown[]> = {};

    for (const result of results) {
      if (!result || typeof result !== "object") continue;

      for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
        if (!merged[key]) {
          merged[key] = [];
        }
        merged[key].push(value);
      }
    }

    return merged as Output;
  }

  // ========================================================================
  // Execution Mode Configuration
  // ========================================================================

  public get concurrencyLimit(): number | undefined {
    return this.config.concurrencyLimit;
  }

  public get batchSize(): number | undefined {
    return this.config.batchSize;
  }

  // ========================================================================
  // Iteration Input Schema Management
  // ========================================================================

  public get iterationInputConfig(): Record<string, IterationPropertyConfig> | undefined {
    return this.config.iterationInputConfig;
  }

  protected buildDefaultIterationInputSchema(): DataPortSchema {
    const innerSchema = this.getInnerInputSchema();
    if (!innerSchema || typeof innerSchema === "boolean") {
      return { type: "object", properties: {}, additionalProperties: true };
    }

    const properties: Record<string, DataPortSchema> = {};
    const innerProps = innerSchema.properties || {};

    for (const [key, propSchema] of Object.entries(innerProps)) {
      if (typeof propSchema === "boolean") continue;

      if ((propSchema as Record<string, unknown>)["x-ui-iteration"]) {
        continue;
      }

      const baseSchema = propSchema as DataPortSchema;
      properties[key] = createFlexibleSchema(baseSchema);
    }

    return {
      type: "object",
      properties,
      additionalProperties: innerSchema.additionalProperties ?? true,
    } as DataPortSchema;
  }

  protected buildConfiguredIterationInputSchema(): DataPortSchema {
    const innerSchema = this.getInnerInputSchema();
    if (!innerSchema || typeof innerSchema === "boolean") {
      return { type: "object", properties: {}, additionalProperties: true };
    }

    const config = this.iterationInputConfig || {};
    const properties: Record<string, DataPortSchema> = {};
    const innerProps = innerSchema.properties || {};

    for (const [key, propSchema] of Object.entries(innerProps)) {
      if (typeof propSchema === "boolean") continue;

      if ((propSchema as Record<string, unknown>)["x-ui-iteration"]) {
        continue;
      }

      const baseSchema = propSchema as DataPortSchema;
      const propConfig = config[key];

      if (!propConfig) {
        properties[key] = createFlexibleSchema(baseSchema);
        continue;
      }

      switch (propConfig.mode) {
        case "array":
          properties[key] = createArraySchema(propConfig.baseSchema);
          break;
        case "scalar":
          properties[key] = propConfig.baseSchema;
          break;
        case "flexible":
        default:
          properties[key] = createFlexibleSchema(propConfig.baseSchema);
          break;
      }
    }

    return {
      type: "object",
      properties,
      additionalProperties: innerSchema.additionalProperties ?? true,
    } as DataPortSchema;
  }

  /**
   * Derives the schema accepted by each iteration of the inner workflow.
   * This uses root task inputs and does not require an InputTask node.
   */
  protected getInnerInputSchema(): DataPortSchema | undefined {
    if (!this.hasChildren()) return undefined;

    const tasks = this.subGraph.getTasks();
    if (tasks.length === 0) return undefined;

    const startingNodes = tasks.filter(
      (task) => this.subGraph.getSourceDataflows(task.config.id).length === 0
    );
    const sources = startingNodes.length > 0 ? startingNodes : tasks;

    const properties: Record<string, DataPortSchema> = {};
    const required: string[] = [];
    let additionalProperties = false;

    for (const task of sources) {
      const inputSchema = task.inputSchema();
      if (typeof inputSchema === "boolean") {
        if (inputSchema === true) {
          additionalProperties = true;
        }
        continue;
      }

      additionalProperties = additionalProperties || inputSchema.additionalProperties === true;

      for (const [key, prop] of Object.entries(inputSchema.properties || {})) {
        if (typeof prop === "boolean") continue;
        if (!properties[key]) {
          properties[key] = prop as DataPortSchema;
        }
      }

      for (const key of inputSchema.required || []) {
        if (!required.includes(key)) {
          required.push(key);
        }
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties,
    } as DataPortSchema;
  }

  public getIterationInputSchema(): DataPortSchema {
    if (this._iterationInputSchema) {
      return this._iterationInputSchema;
    }

    this._iterationInputSchema = this.iterationInputConfig
      ? this.buildConfiguredIterationInputSchema()
      : this.buildDefaultIterationInputSchema();

    return this._iterationInputSchema;
  }

  public setIterationInputSchema(schema: DataPortSchema): void {
    this._iterationInputSchema = schema;
    this._inputSchemaNode = undefined;
    this.events.emit("regenerate");
  }

  public setPropertyInputMode(
    propertyName: string,
    mode: IterationInputMode,
    baseSchema?: DataPortSchema
  ): void {
    const currentSchema = this.getIterationInputSchema();
    if (typeof currentSchema === "boolean") return;

    const currentProps = (currentSchema.properties || {}) as Record<string, DataPortSchema>;
    const existingProp = currentProps[propertyName];
    const base: DataPortSchema =
      baseSchema ??
      (existingProp ? extractBaseSchema(existingProp) : ({ type: "string" } as DataPortSchema));

    let newPropSchema: DataPortSchema;
    switch (mode) {
      case "array":
        newPropSchema = createArraySchema(base);
        break;
      case "scalar":
        newPropSchema = base;
        break;
      case "flexible":
      default:
        newPropSchema = createFlexibleSchema(base);
        break;
    }

    this._iterationInputSchema = {
      ...currentSchema,
      properties: {
        ...currentProps,
        [propertyName]: newPropSchema,
      },
    } as DataPortSchema;

    this._inputSchemaNode = undefined;
    this.events.emit("regenerate");
  }

  public invalidateIterationInputSchema(): void {
    this._iterationInputSchema = undefined;
    this._iteratorPortInfo = undefined;
    this._inputSchemaNode = undefined;
  }

  // ========================================================================
  // Iteration analysis
  // ========================================================================

  /**
   * Analyzes input to determine which ports are iterated vs scalar.
   * Precedence:
   * 1) explicit x-ui-iteration annotation
   * 2) schema inference where deterministic
   * 3) runtime value fallback (Array.isArray)
   */
  public analyzeIterationInput(input: Input): IterationAnalysisResult {
    const inputData = input as Record<string, unknown>;
    const schema = this.hasChildren() ? this.getIterationInputSchema() : this.inputSchema();
    const schemaProps: Record<string, DataPortSchema> =
      typeof schema === "object" && schema.properties
        ? (schema.properties as Record<string, DataPortSchema>)
        : {};

    const keys = new Set([...Object.keys(schemaProps), ...Object.keys(inputData)]);

    const arrayPorts: string[] = [];
    const scalarPorts: string[] = [];
    const iteratedValues: Record<string, unknown[]> = {};
    const arrayLengths: number[] = [];

    for (const key of keys) {
      if (key.startsWith("_iteration")) continue;

      const value = inputData[key];
      const portSchema = schemaProps[key];

      let shouldIterate: boolean;

      const explicitFlag = getExplicitIterationFlag(portSchema);
      if (explicitFlag !== undefined) {
        shouldIterate = explicitFlag;
      } else {
        const schemaInference = inferIterationFromSchema(portSchema);
        shouldIterate = schemaInference ?? Array.isArray(value);
      }

      if (!shouldIterate) {
        scalarPorts.push(key);
        continue;
      }

      if (!Array.isArray(value)) {
        throw new TaskConfigurationError(
          `${this.type}: Input '${key}' is configured for iteration but value is not an array.`
        );
      }

      iteratedValues[key] = value;
      arrayPorts.push(key);
      arrayLengths.push(value.length);
    }

    if (arrayPorts.length === 0) {
      throw new TaskConfigurationError(
        `${this.type}: At least one array input is required for iteration. ` +
          `Mark a port with x-ui-iteration=true, provide array-typed schema, or pass array values at runtime.`
      );
    }

    const uniqueLengths = new Set(arrayLengths);
    if (uniqueLengths.size > 1) {
      const lengthInfo = arrayPorts
        .map((port, index) => `${port}=${arrayLengths[index]}`)
        .join(", ");
      throw new TaskConfigurationError(
        `${this.type}: All iterated array inputs must have the same length (zip semantics). ` +
          `Found different lengths: ${lengthInfo}`
      );
    }

    const iterationCount = arrayLengths[0] ?? 0;

    const getIterationInput = (index: number): Record<string, unknown> => {
      const iterInput: Record<string, unknown> = {};

      for (const key of arrayPorts) {
        iterInput[key] = iteratedValues[key][index];
      }

      for (const key of scalarPorts) {
        if (key in inputData) {
          iterInput[key] = inputData[key];
        }
      }

      return iterInput;
    };

    return {
      iterationCount,
      arrayPorts,
      scalarPorts,
      getIterationInput,
    };
  }

  // ========================================================================
  // Schema Methods
  // ========================================================================

  public getIterationContextSchema(): DataPortSchema {
    return (this.constructor as typeof IteratorTask).getIterationContextSchema();
  }

  public inputSchema(): DataPortSchema {
    if (this.hasChildren()) {
      return this.getIterationInputSchema();
    }
    return (this.constructor as typeof IteratorTask).inputSchema();
  }

  public outputSchema(): DataPortSchema {
    if (!this.hasChildren()) {
      return (this.constructor as typeof IteratorTask).outputSchema();
    }

    return this.getWrappedOutputSchema();
  }

  protected getWrappedOutputSchema(): DataPortSchema {
    if (!this.hasChildren()) {
      return { type: "object", properties: {}, additionalProperties: false };
    }

    const endingNodes = this.subGraph
      .getTasks()
      .filter((task) => this.subGraph.getTargetDataflows(task.config.id).length === 0);

    if (endingNodes.length === 0) {
      return { type: "object", properties: {}, additionalProperties: false };
    }

    const properties: Record<string, unknown> = {};

    for (const task of endingNodes) {
      const taskOutputSchema = task.outputSchema();
      if (typeof taskOutputSchema === "boolean") continue;

      for (const [key, schema] of Object.entries(taskOutputSchema.properties || {})) {
        properties[key] = {
          type: "array",
          items: schema,
        };
      }
    }

    return {
      type: "object",
      properties,
      additionalProperties: false,
    } as DataPortSchema;
  }
}
