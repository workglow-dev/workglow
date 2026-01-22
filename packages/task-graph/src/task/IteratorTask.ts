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
import { TaskConfigurationError } from "./TaskError";
import type { TaskInput, TaskOutput, TaskTypeName } from "./TaskTypes";

/**
 * Execution mode for iterator tasks.
 * - `parallel`: Execute all iterations concurrently (unlimited)
 * - `parallel-limited`: Execute with a concurrency limit
 * - `sequential`: Execute one at a time
 * - `batched`: Execute in batches of batchSize
 */
export type ExecutionMode = "parallel" | "parallel-limited" | "sequential" | "batched";

/**
 * Configuration interface for IteratorTask.
 * Extends GraphAsTaskConfig with iterator-specific options.
 */
export interface IteratorTaskConfig extends GraphAsTaskConfig {
  /**
   * The execution mode for iterations.
   * @default "parallel"
   */
  readonly executionMode?: ExecutionMode;

  /**
   * Maximum number of concurrent iterations when executionMode is "parallel-limited".
   * @default 5
   */
  readonly concurrencyLimit?: number;

  /**
   * Number of items per batch when executionMode is "batched".
   * @default 10
   */
  readonly batchSize?: number;

  /**
   * Optional custom queue name for job queue integration.
   * If not provided, a unique queue name will be generated.
   */
  readonly queueName?: string;

  /**
   * The name of the input port containing the array to iterate.
   * If not provided, auto-detection will find the first array-typed port.
   */
  readonly iteratorPort?: string;
}

/**
 * Result of detecting the iterator port from the input schema.
 */
interface IteratorPortInfo {
  readonly portName: string;
  readonly itemSchema: DataPortSchema;
}

/**
 * Base class for iterator tasks that process collections of items.
 *
 * IteratorTask provides the foundation for loop-type tasks in the task graph.
 * It manages a subgraph of tasks that are executed for each item in a collection,
 * with configurable execution modes (parallel, sequential, batched, etc.).
 *
 * Subclasses should implement:
 * - `getIterableItems(input)`: Extract the items to iterate over from input
 * - Optionally override `collectResults()`: Define how to collect/merge results
 *
 * @template Input - The input type for the iterator task
 * @template Output - The output type for the iterator task
 * @template Config - The configuration type (must extend IteratorTaskConfig)
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
   * The template subgraph that will be cloned for each iteration.
   * This is the workflow defined between forEach() and endForEach().
   */
  protected _templateGraph: TaskGraph | undefined;

  /**
   * Cached iterator port info from schema analysis.
   */
  protected _iteratorPortInfo: IteratorPortInfo | undefined;

  constructor(input: Partial<Input> = {}, config: Partial<Config> = {}) {
    super(input, config as Config);
  }

  // ========================================================================
  // TaskRunner Override
  // ========================================================================

  declare _runner: IteratorTaskRunner<Input, Output, Config>;

  /**
   * Gets the custom iterator task runner.
   */
  override get runner(): IteratorTaskRunner<Input, Output, Config> {
    if (!this._runner) {
      this._runner = new IteratorTaskRunner<Input, Output, Config>(this);
    }
    return this._runner;
  }

  // ========================================================================
  // Execution Mode Configuration
  // ========================================================================

  /**
   * Gets the execution mode for this iterator.
   */
  public get executionMode(): ExecutionMode {
    return this.config.executionMode ?? "parallel";
  }

  /**
   * Gets the concurrency limit for parallel-limited mode.
   */
  public get concurrencyLimit(): number {
    return this.config.concurrencyLimit ?? 5;
  }

  /**
   * Gets the batch size for batched mode.
   */
  public get batchSize(): number {
    return this.config.batchSize ?? 10;
  }

  // ========================================================================
  // Iterator Port Detection
  // ========================================================================

  /**
   * Auto-detects the iterator port from the input schema.
   * Finds the first property with type "array" or that has an "items" property.
   *
   * @returns The port info or undefined if no array port found
   */
  protected detectIteratorPort(): IteratorPortInfo | undefined {
    if (this._iteratorPortInfo) {
      return this._iteratorPortInfo;
    }

    // If explicitly configured, use that
    if (this.config.iteratorPort) {
      const schema = this.inputSchema();
      if (typeof schema === "boolean") return undefined;

      const portSchema = schema.properties?.[this.config.iteratorPort];
      if (portSchema && typeof portSchema === "object") {
        const itemSchema = (portSchema as any).items ?? { type: "object" };
        this._iteratorPortInfo = {
          portName: this.config.iteratorPort,
          itemSchema,
        };
        return this._iteratorPortInfo;
      }
    }

    // Auto-detect: find first array-typed port
    const schema = this.inputSchema();
    if (typeof schema === "boolean") return undefined;

    const properties = schema.properties || {};
    for (const [portName, portSchema] of Object.entries(properties)) {
      if (typeof portSchema !== "object" || portSchema === null) continue;

      const ps = portSchema as Record<string, unknown>;

      // Check if it's an array type
      if (ps.type === "array" || ps.items !== undefined) {
        const itemSchema = (ps.items as DataPortSchema) ?? {
          type: "object",
          properties: {},
          additionalProperties: true,
        };
        this._iteratorPortInfo = { portName, itemSchema };
        return this._iteratorPortInfo;
      }

      // Check oneOf/anyOf for array types
      const variants = (ps.oneOf ?? ps.anyOf) as unknown[] | undefined;
      if (Array.isArray(variants)) {
        for (const variant of variants) {
          if (typeof variant === "object" && variant !== null) {
            const v = variant as Record<string, unknown>;
            if (v.type === "array" || v.items !== undefined) {
              const itemSchema = (v.items as DataPortSchema) ?? {
                type: "object",
                properties: {},
                additionalProperties: true,
              };
              this._iteratorPortInfo = { portName, itemSchema };
              return this._iteratorPortInfo;
            }
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Gets the name of the port containing the iterable collection.
   */
  public getIteratorPortName(): string | undefined {
    return this.detectIteratorPort()?.portName;
  }

  /**
   * Gets the schema for individual items in the collection.
   */
  public getItemSchema(): DataPortSchema {
    return (
      this.detectIteratorPort()?.itemSchema ?? {
        type: "object",
        properties: {},
        additionalProperties: true,
      }
    );
  }

  // ========================================================================
  // Iterable Items Extraction
  // ========================================================================

  /**
   * Extracts the items to iterate over from the input.
   * Subclasses can override this to provide custom extraction logic.
   *
   * @param input - The task input
   * @returns Array of items to iterate over
   */
  protected getIterableItems(input: Input): unknown[] {
    const portName = this.getIteratorPortName();
    if (!portName) {
      throw new TaskConfigurationError(
        `${this.type}: No array port found in input schema. ` +
          `Specify 'iteratorPort' in config or ensure input has an array-typed property.`
      );
    }

    const items = input[portName];
    if (items === undefined || items === null) {
      return [];
    }

    if (Array.isArray(items)) {
      return items;
    }

    // Single item - wrap in array
    return [items];
  }

  // ========================================================================
  // Template Graph Management
  // ========================================================================

  /**
   * Sets the template graph that defines the workflow to run for each iteration.
   * This is called by the Workflow builder when setting up the loop.
   *
   * Note: This does NOT call regenerateGraph() automatically because during
   * workflow construction, input data may not be available. The graph is
   * regenerated at execution time when actual input data is provided.
   */
  public setTemplateGraph(graph: TaskGraph): void {
    this._templateGraph = graph;
    // Don't regenerate here - wait for execution when input data is available
    this.events.emit("regenerate");
  }

  /**
   * Gets the template graph.
   */
  public getTemplateGraph(): TaskGraph | undefined {
    return this._templateGraph;
  }

  // ========================================================================
  // Graph Regeneration
  // ========================================================================

  /**
   * Regenerates the subgraph based on the template and current input.
   * This creates cloned task instances for each item in the iteration.
   */
  public regenerateGraph(): void {
    // Clear the existing subgraph
    this.subGraph = new TaskGraph();

    // If no template or no items, emit and return
    if (!this._templateGraph || !this._templateGraph.getTasks().length) {
      super.regenerateGraph();
      return;
    }

    const items = this.getIterableItems(this.runInputData as Input);
    if (items.length === 0) {
      super.regenerateGraph();
      return;
    }

    // For each item, clone the template graph tasks
    this.createIterationTasks(items);

    super.regenerateGraph();
  }

  /**
   * Creates task instances for each iteration item.
   * Subclasses can override this for custom iteration behavior.
   *
   * @param items - The items to iterate over
   */
  protected createIterationTasks(items: unknown[]): void {
    const portName = this.getIteratorPortName();
    if (!portName) return;

    // Get all non-iterator input values to pass to each iteration
    const baseInput: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.runInputData)) {
      if (key !== portName) {
        baseInput[key] = value;
      }
    }

    // Create tasks for each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const iterationInput = {
        ...baseInput,
        [portName]: item,
        _iterationIndex: i,
        _iterationItem: item,
      };

      // Clone template tasks for this iteration
      this.cloneTemplateForIteration(iterationInput, i);
    }
  }

  /**
   * Clones the template graph tasks for a single iteration.
   *
   * @param iterationInput - The input for this iteration
   * @param index - The iteration index
   */
  protected cloneTemplateForIteration(
    iterationInput: Record<string, unknown>,
    index: number
  ): void {
    if (!this._templateGraph) return;

    const templateTasks = this._templateGraph.getTasks();
    const templateDataflows = this._templateGraph.getDataflows();

    // Map from template task ID to cloned task ID
    const idMap = new Map<unknown, unknown>();

    // Clone each task
    for (const templateTask of templateTasks) {
      const TaskClass = templateTask.constructor as any;
      const clonedTask = new TaskClass(
        { ...templateTask.defaults, ...iterationInput },
        {
          ...templateTask.config,
          id: `${templateTask.config.id}_iter${index}`,
          name: `${templateTask.config.name || templateTask.type} [${index}]`,
        }
      );

      this.subGraph.addTask(clonedTask);
      idMap.set(templateTask.config.id, clonedTask.config.id);
    }

    // Clone dataflows with updated IDs
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
        this.subGraph.addDataflow(clonedDataflow);
      }
    }
  }

  // ========================================================================
  // Execution
  // ========================================================================

  /**
   * Execute the iterator task.
   * Sets up the iteration and delegates to the parent GraphAsTask execution.
   */
  public async execute(input: Input, context: IExecuteContext): Promise<Output | undefined> {
    // Ensure we have items to iterate
    const items = this.getIterableItems(input);
    if (items.length === 0) {
      return this.getEmptyResult();
    }

    // Regenerate graph with current input
    this.runInputData = { ...this.defaults, ...input };
    this.regenerateGraph();

    // Let the parent handle subgraph execution
    return super.execute(input, context);
  }

  /**
   * Returns the result when there are no items to iterate.
   * Subclasses should override this to return appropriate empty results.
   */
  protected getEmptyResult(): Output {
    return {} as Output;
  }

  // ========================================================================
  // Result Collection
  // ========================================================================

  /**
   * Collects and merges results from all iterations.
   * Subclasses can override this for custom result handling.
   *
   * @param results - Array of results from each iteration
   * @returns Merged output
   */
  protected collectResults(results: TaskOutput[]): Output {
    // Default: use the GraphAsTask's PROPERTY_ARRAY merge strategy
    // which collects values into arrays per property
    return results as unknown as Output;
  }

  // ========================================================================
  // Schema Methods
  // ========================================================================

  /**
   * Input schema for the iterator.
   * Returns the static schema since the iterator accepts the full array.
   */
  public inputSchema(): DataPortSchema {
    // If we have a template graph, derive from its starting nodes
    if (this.hasChildren() || this._templateGraph) {
      return super.inputSchema();
    }
    return (this.constructor as typeof IteratorTask).inputSchema();
  }

  /**
   * Output schema for the iterator.
   * Subclasses should override to define their specific output structure.
   */
  public outputSchema(): DataPortSchema {
    // Default: wrap inner output properties in arrays
    if (!this.hasChildren() && !this._templateGraph) {
      return (this.constructor as typeof IteratorTask).outputSchema();
    }

    return this.getWrappedOutputSchema();
  }

  /**
   * Gets the output schema with properties wrapped in arrays.
   * Used by MapTask and similar tasks that collect results.
   */
  protected getWrappedOutputSchema(): DataPortSchema {
    const templateGraph = this._templateGraph ?? this.subGraph;
    if (!templateGraph) {
      return { type: "object", properties: {}, additionalProperties: false };
    }

    // Get ending nodes in the template
    const tasks = templateGraph.getTasks();
    const endingNodes = tasks.filter(
      (task) => templateGraph.getTargetDataflows(task.config.id).length === 0
    );

    if (endingNodes.length === 0) {
      return { type: "object", properties: {}, additionalProperties: false };
    }

    const properties: Record<string, unknown> = {};

    for (const task of endingNodes) {
      const taskOutputSchema = task.outputSchema();
      if (typeof taskOutputSchema === "boolean") continue;

      const taskProperties = taskOutputSchema.properties || {};
      for (const [key, schema] of Object.entries(taskProperties)) {
        // Wrap in array
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
