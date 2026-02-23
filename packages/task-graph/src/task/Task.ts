/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  compileSchema,
  deepEqual,
  EventEmitter,
  SchemaNode,
  uuid4,
  type DataPortSchema,
  type ServiceRegistry,
} from "@workglow/util";
import { DATAFLOW_ALL_PORTS } from "../task-graph/Dataflow";
import { TaskGraph } from "../task-graph/TaskGraph";
import type { IExecuteContext, IExecuteReactiveContext, IRunConfig, ITask } from "./ITask";
import {
  TaskAbortedError,
  TaskConfigurationError,
  TaskError,
  TaskInvalidInputError,
} from "./TaskError";
import {
  type TaskEventListener,
  type TaskEventListeners,
  type TaskEventParameters,
  type TaskEvents,
} from "./TaskEvents";
import type { JsonTaskItem, TaskGraphItemJson } from "./TaskJSON";
import { TaskRunner } from "./TaskRunner";
import {
  TaskConfigSchema,
  TaskStatus,
  type TaskConfig,
  type TaskIdType,
  type TaskInput,
  type TaskOutput,
  type TaskTypeName,
} from "./TaskTypes";

/**
 * Base class for all tasks that implements the ITask interface.
 * This abstract class provides common functionality for both simple and compound tasks.
 *
 * The Task class is responsible for:
 * 1. Defining what a task is (inputs, outputs, configuration)
 * 2. Providing the execution logic (via execute and executeReactive)
 * 3. Delegating the running logic to a TaskRunner
 */
export class Task<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig = TaskConfig,
> implements ITask<Input, Output, Config> {
  // ========================================================================
  // Static properties - should be overridden by subclasses
  // ========================================================================

  /**
   * The type identifier for this task class
   */
  public static type: TaskTypeName = "Task";

  /**
   * The category this task belongs to
   */
  public static category: string = "Hidden";

  /**
   * The title of this task
   */
  public static title: string = "";

  /**
   * The description of this task
   */
  public static description: string = "";

  /**
   * Whether this task has side effects
   */
  public static cacheable: boolean = true;

  /**
   * Whether this task has dynamic input/output schemas that can change at runtime.
   * Tasks with dynamic schemas should override instance methods for inputSchema() and/or outputSchema()
   * and emit 'schemaChange' events when their schemas change.
   */
  public static hasDynamicSchemas: boolean = false;

  /**
   * When true, dynamically added input ports (via the universal "Add Input" handle in the builder)
   * are mirrored as output ports of the same name and type. Set this on pass-through tasks that
   * forward their additional inputs to their outputs unchanged.
   */
  public static passthroughInputsToOutputs: boolean = false;

  /**
   * Input schema for this task
   */
  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Output schema for this task
   */
  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  /**
   * Config schema for this task. Subclasses that add config properties MUST override this
   * and spread TaskConfigSchema["properties"] into their own properties object.
   */
  public static configSchema(): DataPortSchema {
    return TaskConfigSchema;
  }

  // ========================================================================
  // Task Execution Methods - Core logic provided by subclasses
  // ========================================================================

  /**
   * The actual task execution logic for subclasses to override
   *
   * @param input The input to the task
   * @param config The configuration for the task
   * @throws TaskError if the task fails
   * @returns The output of the task or undefined if no changes
   */
  public async execute(_input: Input, context: IExecuteContext): Promise<Output | undefined> {
    if (context.signal?.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    return undefined;
  }

  /**
   * Default implementation of executeReactive that does nothing.
   * Subclasses should override this to provide actual reactive functionality.
   *
   * This is generally for UI updating, and should be lightweight.
   * @param input The input to the task
   * @param output The current output of the task
   * @returns The updated output of the task or undefined if no changes
   */
  public async executeReactive(
    _input: Input,
    output: Output,
    _context: IExecuteReactiveContext
  ): Promise<Output | undefined> {
    return output;
  }

  // ========================================================================
  // TaskRunner delegation - Executes and manages the task
  // ========================================================================

  /**
   * Task runner for handling the task execution
   */
  protected _runner: TaskRunner<Input, Output, Config> | undefined;

  /**
   * Gets the task runner instance
   * Creates a new one if it doesn't exist
   */
  public get runner(): TaskRunner<Input, Output, Config> {
    if (!this._runner) {
      this._runner = new TaskRunner<Input, Output, Config>(this);
    }
    return this._runner;
  }

  /**
   * Runs the task and returns the output
   * Delegates to the task runner
   *
   * @param overrides Optional input overrides
   * @param runConfig Optional per-call run configuration (merged with task's runConfig)
   * @throws TaskError if the task fails
   * @returns The task output
   */
  async run(overrides: Partial<Input> = {}, runConfig: Partial<IRunConfig> = {}): Promise<Output> {
    return this.runner.run(overrides, { ...this.runConfig, ...runConfig });
  }

  /**
   * Runs the task in reactive mode
   * Delegates to the task runner
   *
   * @param overrides Optional input overrides
   * @returns The task output
   */
  public async runReactive(overrides: Partial<Input> = {}): Promise<Output> {
    return this.runner.runReactive(overrides);
  }

  /**
   * Aborts task execution
   * Delegates to the task runner
   */
  public abort(): void {
    this.runner.abort();
  }

  /**
   * Disables task execution
   * Delegates to the task runner
   */
  public async disable(): Promise<void> {
    await this.runner.disable();
  }

  // ========================================================================
  // Static to Instance conversion methods
  // ========================================================================

  /**
   * Gets input schema for this task
   */
  public inputSchema(): DataPortSchema {
    return (this.constructor as typeof Task).inputSchema();
  }

  /**
   * Gets output schema for this task
   */
  public outputSchema(): DataPortSchema {
    return (this.constructor as typeof Task).outputSchema();
  }

  /**
   * Gets config schema for this task
   */
  public configSchema(): DataPortSchema {
    return (this.constructor as typeof Task).configSchema();
  }

  public get type(): TaskTypeName {
    return (this.constructor as typeof Task).type;
  }

  public get category(): string {
    return (this.constructor as typeof Task).category;
  }

  public get title(): string {
    return this.config?.title ?? (this.constructor as typeof Task).title;
  }

  public get description(): string {
    return this.config?.description ?? (this.constructor as typeof Task).description;
  }

  public get cacheable(): boolean {
    return (
      this.runConfig?.cacheable ??
      this.config?.cacheable ??
      (this.constructor as typeof Task).cacheable
    );
  }

  // ========================================================================
  // Instance properties using @template types
  // ========================================================================

  /**
   * Default input values for this task.
   * If no overrides at run time, then this would be equal to the input.
   * resetInputData() will reset inputs to these defaults.
   */
  defaults: Record<string, any>;

  /**
   * The input to the task at the time of the task run.
   * This takes defaults from construction time and overrides from run time.
   * It is the input that created the output.
   */
  runInputData: Record<string, any> = {};

  /**
   * The output of the task at the time of the task run.
   * This is the result of the task execution.
   */
  runOutputData: Record<string, any> = {};

  // ========================================================================
  // Task state properties
  // ========================================================================

  /**
   * The configuration of the task
   */
  config: Config;

  /**
   * Runtime configuration (not serialized with the task).
   * Set via the constructor's third argument or mutated by the graph runner.
   */
  runConfig: Partial<IRunConfig> = {};

  /**
   * Current status of the task
   */
  status: TaskStatus = TaskStatus.PENDING;

  /**
   * Progress of the task (0-100)
   */
  progress: number = 0;

  /**
   * When the task was created
   */
  createdAt: Date = new Date();

  /**
   * When the task started execution
   */
  startedAt?: Date;

  /**
   * When the task completed execution
   */
  completedAt?: Date;

  /**
   * Error that occurred during task execution, if any
   */
  error?: TaskError;

  /**
   * Event emitter for task lifecycle events
   */
  public get events(): EventEmitter<TaskEventListeners> {
    if (!this._events) {
      this._events = new EventEmitter<TaskEventListeners>();
    }
    return this._events;
  }
  protected _events: EventEmitter<TaskEventListeners> | undefined;

  /**
   * Creates a new task instance
   *
   * @param callerDefaultInputs Default input values provided by the caller
   * @param config Configuration for the task
   */
  constructor(
    callerDefaultInputs: Partial<Input> = {},
    config: Partial<Config> = {},
    runConfig: Partial<IRunConfig> = {}
  ) {
    // Initialize input defaults
    const inputDefaults = this.getDefaultInputsFromStaticInputDefinitions();
    const mergedDefaults = Object.assign(inputDefaults, callerDefaultInputs);
    // Strip symbol properties (like [$JSONSchema]) before storing defaults
    this.defaults = this.stripSymbols(mergedDefaults) as Record<string, any>;
    this.resetInputData();

    // Setup configuration defaults (title comes from static class property as fallback)
    const title = (this.constructor as typeof Task).title || undefined;
    const baseConfig = Object.assign(
      {
        id: uuid4(),
        ...(title ? { title } : {}),
      },
      config
    ) as Config;
    this.config = this.validateAndApplyConfigDefaults(baseConfig);

    // Store runtime configuration
    this.runConfig = runConfig;
  }

  // ========================================================================
  // Input/Output handling
  // ========================================================================

  /**
   * Gets default input values from input schema
   */
  getDefaultInputsFromStaticInputDefinitions(): Partial<Input> {
    const schema = this.inputSchema();
    if (typeof schema === "boolean") {
      return {};
    }
    try {
      const compiledSchema = this.getInputSchemaNode(this.type);
      const defaultData = compiledSchema.getData(undefined, {
        addOptionalProps: true,
        removeInvalidData: false,
        useTypeDefaults: false,
      });
      return (defaultData || {}) as Partial<Input>;
    } catch (error) {
      console.warn(
        `Failed to compile input schema for ${this.type}, falling back to manual extraction:`,
        error
      );
      // Fallback to manual extraction if compilation fails
      return Object.entries(schema.properties || {}).reduce<Record<string, any>>(
        (acc, [id, prop]) => {
          const defaultValue = (prop as any).default;
          if (defaultValue !== undefined) {
            acc[id] = defaultValue;
          }
          return acc;
        },
        {}
      ) as Partial<Input>;
    }
  }

  /**
   * Resets input data to defaults
   */
  public resetInputData(): void {
    this.runInputData = this.smartClone(this.defaults) as Record<string, any>;
  }

  /**
   * Smart clone that deep-clones plain objects and arrays while preserving
   * class instances (objects with non-Object prototype) by reference.
   * Detects and throws an error on circular references.
   *
   * This is necessary because:
   * - structuredClone cannot clone class instances (methods are lost)
   * - JSON.parse/stringify loses methods and fails on circular references
   * - Class instances like repositories should be passed by reference
   *
   * This breaks the idea of everything being json serializable, but it allows
   * more efficient use cases. Do be careful with this though! Use sparingly.
   *
   * @param obj The object to clone
   * @param visited Set of objects in the current cloning path (for circular reference detection)
   * @returns A cloned object with class instances preserved by reference
   */
  private smartClone(obj: any, visited: WeakSet<object> = new WeakSet()): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    // Primitives (string, number, boolean, symbol, bigint) are returned as-is
    if (typeof obj !== "object") {
      return obj;
    }

    // Check for circular references
    if (visited.has(obj)) {
      throw new TaskConfigurationError(
        "Circular reference detected in input data. " +
          "Cannot clone objects with circular references."
      );
    }

    // Clone TypedArrays (Float32Array, Int8Array, etc.) to avoid shared-mutation
    // between defaults and runInputData, while preserving DataView by reference.
    if (ArrayBuffer.isView(obj)) {
      // Preserve DataView instances by reference (constructor signature differs)
      if (typeof DataView !== "undefined" && obj instanceof DataView) {
        return obj;
      }
      // For TypedArrays, create a new instance with the same data
      const typedArray = obj as any;
      return new (typedArray.constructor as any)(typedArray);
    }

    // Preserve class instances (objects with non-Object/non-Array prototype)
    // This includes repository instances, custom classes, etc.
    if (!Array.isArray(obj)) {
      const proto = Object.getPrototypeOf(obj);
      if (proto !== Object.prototype && proto !== null) {
        return obj; // Pass by reference
      }
    }

    // Add object to visited set before recursing
    visited.add(obj);

    try {
      // Deep clone arrays, preserving class instances within
      if (Array.isArray(obj)) {
        return obj.map((item) => this.smartClone(item, visited));
      }

      // Deep clone plain objects
      const result: Record<string, any> = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result[key] = this.smartClone(obj[key], visited);
        }
      }
      return result;
    } finally {
      // Remove from visited set after processing to allow the same object
      // in different branches (non-circular references)
      visited.delete(obj);
    }
  }

  /**
   * Sets the default input values for the task
   *
   * @param defaults The default input values to set
   */
  public setDefaults(defaults: Record<string, any>): void {
    // Strip symbol properties (like [$JSONSchema]) before storing defaults
    this.defaults = this.stripSymbols(defaults) as Record<string, any>;
  }

  /**
   * Sets input values for the task
   *
   * @param input Input values to set
   */
  public setInput(input: Record<string, any>): void {
    const schema = this.inputSchema();
    if (typeof schema === "boolean") {
      if (schema === true) {
        for (const [inputId, value] of Object.entries(input)) {
          if (value !== undefined) {
            this.runInputData[inputId] = value;
          }
        }
      }
      return;
    }
    const properties = schema.properties || {};

    // Copy explicitly defined properties
    for (const [inputId, prop] of Object.entries(properties)) {
      if (input[inputId] !== undefined) {
        this.runInputData[inputId] = input[inputId];
      } else if (this.runInputData[inputId] === undefined && (prop as any).default !== undefined) {
        this.runInputData[inputId] = (prop as any).default;
      }
    }

    // If additionalProperties is true, also copy any additional input properties
    if (schema.additionalProperties === true) {
      for (const [inputId, value] of Object.entries(input)) {
        if (!(inputId in properties)) {
          this.runInputData[inputId] = value;
        }
      }
    }
  }

  /**
   * Adds/merges input data during graph execution.
   * Unlike {@link setInput}, this method:
   * - Detects changes using deep equality
   * - Accumulates array values (appends rather than replaces)
   * - Handles DATAFLOW_ALL_PORTS for pass-through
   * - Handles additionalProperties for dynamic schemas
   *
   * @param overrides The input data to merge
   * @returns true if any input data was changed, false otherwise
   */
  public addInput(overrides: Partial<Input> | undefined): boolean {
    if (!overrides) return false;

    let changed = false;
    const inputSchema = this.inputSchema();

    if (typeof inputSchema === "boolean") {
      if (inputSchema === false) {
        return false;
      }
      // Schema is `true` - accept any input
      for (const [key, value] of Object.entries(overrides)) {
        if (!deepEqual(this.runInputData[key], value)) {
          this.runInputData[key] = value;
          changed = true;
        }
      }
      return changed;
    }

    const properties = inputSchema.properties || {};

    for (const [inputId, prop] of Object.entries(properties)) {
      if (inputId === DATAFLOW_ALL_PORTS) {
        this.runInputData = { ...this.runInputData, ...overrides };
        changed = true;
      } else {
        if (overrides[inputId] === undefined) continue;
        const isArray =
          (prop as any)?.type === "array" ||
          ((prop as any)?.type === "any" &&
            (Array.isArray(overrides[inputId]) || Array.isArray(this.runInputData[inputId])));

        if (isArray) {
          const existingItems = Array.isArray(this.runInputData[inputId])
            ? this.runInputData[inputId]
            : [this.runInputData[inputId]];
          const newitems = [...existingItems];

          const overrideItem = overrides[inputId];
          if (Array.isArray(overrideItem)) {
            newitems.push(...overrideItem);
          } else {
            newitems.push(overrideItem);
          }
          this.runInputData[inputId] = newitems;
          changed = true;
        } else {
          if (!deepEqual(this.runInputData[inputId], overrides[inputId])) {
            this.runInputData[inputId] = overrides[inputId];
            changed = true;
          }
        }
      }
    }

    // If additionalProperties is true, also accept any additional input properties
    if (inputSchema.additionalProperties === true) {
      for (const [inputId, value] of Object.entries(overrides)) {
        if (!(inputId in properties)) {
          if (!deepEqual(this.runInputData[inputId], value)) {
            this.runInputData[inputId] = value;
            changed = true;
          }
        }
      }
    }

    return changed;
  }

  /**
   * Stub for narrowing input. Override in subclasses for custom logic.
   * @param input The input to narrow
   * @param _registry Optional service registry for lookups
   * @returns The (possibly narrowed) input
   */
  public async narrowInput(
    input: Record<string, any>,
    _registry: ServiceRegistry
  ): Promise<Record<string, any>> {
    return input;
  }

  // ========================================================================
  // Event handling methods
  // ========================================================================

  /**
   * Subscribes to an event
   */
  public subscribe<Event extends TaskEvents>(
    name: Event,
    fn: TaskEventListener<Event>
  ): () => void {
    return this.events.subscribe(name, fn);
  }

  /**
   * Registers an event listener
   */
  public on<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void {
    this.events.on(name, fn);
  }

  /**
   * Removes an event listener
   */
  public off<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void {
    this.events.off(name, fn);
  }

  /**
   * Registers a one-time event listener
   */
  public once<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void {
    this.events.once(name, fn);
  }

  /**
   * Returns a promise that resolves when the specified event is emitted
   */
  public waitOn<Event extends TaskEvents>(name: Event): Promise<TaskEventParameters<Event>> {
    return this.events.waitOn(name) as Promise<TaskEventParameters<Event>>;
  }

  /**
   * Emits an event
   */
  public emit<Event extends TaskEvents>(name: Event, ...args: TaskEventParameters<Event>): void {
    // this one is not like the others. Listeners will cause a lazy load of the event emitter.
    // but no need to emit if no one is listening, so we don't want to create the event emitter if not needed
    this._events?.emit(name, ...args);
  }

  /**
   * Emits a schemaChange event when the task's input or output schema changes.
   * This should be called by tasks with dynamic schemas when their configuration
   * changes in a way that affects their schemas.
   *
   * @param inputSchema - The new input schema (optional, will use current schema if not provided)
   * @param outputSchema - The new output schema (optional, will use current schema if not provided)
   */
  protected emitSchemaChange(inputSchema?: DataPortSchema, outputSchema?: DataPortSchema): void {
    const finalInputSchema = inputSchema ?? this.inputSchema();
    const finalOutputSchema = outputSchema ?? this.outputSchema();
    this.emit("schemaChange", finalInputSchema, finalOutputSchema);
  }

  // ========================================================================
  // Input validation methods
  // ========================================================================

  /**
   * The compiled config schema (cached per task type)
   */
  private static _configSchemaNode: Map<string, SchemaNode> = new Map();

  /**
   * Gets the compiled config schema node, or undefined if no configSchema is defined.
   */
  private static getConfigSchemaNode(type: TaskTypeName): SchemaNode | undefined {
    const schema = this.configSchema();
    if (!schema) return undefined;
    if (!this._configSchemaNode.has(type)) {
      try {
        const schemaNode =
          typeof schema === "boolean"
            ? compileSchema(schema ? {} : { not: {} })
            : compileSchema(schema);
        this._configSchemaNode.set(type, schemaNode);
      } catch (error) {
        console.warn(`Failed to compile config schema for ${this.type}:`, error);
        return undefined;
      }
    }
    return this._configSchemaNode.get(type);
  }

  /**
   * Validates config against configSchema.
   * Returns config as-is; throws on validation errors.
   * Returns config as-is if no configSchema is defined.
   */
  private validateAndApplyConfigDefaults(config: Config): Config {
    const ctor = this.constructor as typeof Task;
    const schemaNode = ctor.getConfigSchemaNode(this.type);
    if (!schemaNode) return config;

    const result = schemaNode.validate(config);
    if (!result.valid) {
      const errorMessages = result.errors.map((e) => {
        const path = (e as any).data?.pointer || "";
        return `${e.message}${path ? ` (${path})` : ""}`;
      });
      throw new TaskConfigurationError(
        `[${ctor.name}] Configuration Error: ${errorMessages.join(", ")}`
      );
    }

    return config;
  }

  /**
   * The compiled input schema
   */
  private static _inputSchemaNode: Map<string, SchemaNode> = new Map();

  protected static generateInputSchemaNode(schema: DataPortSchema) {
    if (typeof schema === "boolean") {
      if (schema === false) {
        return compileSchema({ not: {} });
      }
      return compileSchema({});
    }
    return compileSchema(schema);
  }

  /**
   * Gets the compiled input schema
   */
  protected static getInputSchemaNode(type: TaskTypeName): SchemaNode {
    if (!this._inputSchemaNode.has(type)) {
      const dataPortSchema = this.inputSchema();
      const schemaNode = this.generateInputSchemaNode(dataPortSchema);
      try {
        this._inputSchemaNode.set(type, schemaNode);
      } catch (error) {
        // If compilation fails, fall back to accepting any object structure
        // This is a safety net for schemas that json-schema-library can't compile
        console.warn(
          `Failed to compile input schema for ${this.type}, falling back to permissive validation:`,
          error
        );
        this._inputSchemaNode.set(type, compileSchema({}));
      }
    }
    return this._inputSchemaNode.get(type)!;
  }

  protected getInputSchemaNode(type: TaskTypeName): SchemaNode {
    return (this.constructor as typeof Task).getInputSchemaNode(type);
  }

  /**
   * Validates an input data object against the task's input schema
   */
  public async validateInput(input: Partial<Input>): Promise<boolean> {
    const schemaNode = this.getInputSchemaNode(this.type);
    const result = schemaNode.validate(input);

    if (!result.valid) {
      const errorMessages = result.errors.map((e) => {
        const path = e.data.pointer || "";
        return `${e.message}${path ? ` (${path})` : ""}`;
      });
      throw new TaskInvalidInputError(
        `Input ${JSON.stringify(Object.keys(input))} does not match schema: ${errorMessages.join(", ")}`
      );
    }

    return true;
  }

  /**
   * Gets the task ID from the config
   */
  public id(): unknown {
    return this.config.id;
  }

  // ========================================================================
  // Serialization methods
  // ========================================================================

  /**
   * Strips symbol properties from an object to make it serializable
   * @param obj The object to strip symbols from
   * @returns A new object without symbol properties
   */
  private stripSymbols(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    // Preserve TypedArrays (Float32Array, Int8Array, etc.)
    if (ArrayBuffer.isView(obj)) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.stripSymbols(item));
    }
    if (typeof obj === "object") {
      const result: Record<string, any> = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result[key] = this.stripSymbols(obj[key]);
        }
      }
      return result;
    }
    return obj;
  }

  /**
   * Serializes the task and its subtasks into a format that can be stored
   * @returns The serialized task and subtasks
   */
  public toJSON(): TaskGraphItemJson {
    const extras = this.config.extras;
    const json: TaskGraphItemJson = this.stripSymbols({
      id: this.config.id,
      type: this.type,
      defaults: this.defaults,
      config: {
        ...(this.config.title ? { title: this.config.title } : {}),
        ...(this.config.inputSchema ? { inputSchema: this.config.inputSchema } : {}),
        ...(this.config.outputSchema ? { outputSchema: this.config.outputSchema } : {}),
        ...(extras && Object.keys(extras).length ? { extras } : {}),
      },
    });
    return json;
  }

  /**
   * Converts the task to a JSON format suitable for dependency tracking
   * @returns The task and subtasks in JSON thats easier for humans to read
   */
  public toDependencyJSON(): JsonTaskItem {
    const json = this.toJSON();
    return json;
  }

  // ========================================================================
  // Internal graph methods
  // ========================================================================

  /**
   * Checks if the task has children. Useful to gate to use of the internal subGraph
   * as this will return without creating a new graph if graph is non-existent .
   *
   * @returns True if the task has children, otherwise false
   */
  public hasChildren(): boolean {
    return (
      this._subGraph !== undefined &&
      this._subGraph !== null &&
      this._subGraph.getTasks().length > 0
    );
  }

  private _taskAddedListener: (taskId: TaskIdType) => void = () => {
    this.emit("regenerate");
  };

  /**
   * The internal task graph containing subtasks
   *
   * In the base case, these may just be incidental tasks that are not part of the task graph
   * but are used to manage the task's state as part of task execution. Therefore, the graph
   * is not used by the default runner.
   */
  protected _subGraph: TaskGraph | undefined = undefined;

  /**
   * Sets the subtask graph for the compound task
   * @param subGraph The subtask graph to set
   */
  set subGraph(subGraph: TaskGraph) {
    if (this._subGraph) {
      this._subGraph.off("task_added", this._taskAddedListener);
    }
    this._subGraph = subGraph;
    this._subGraph.on("task_added", this._taskAddedListener);
  }

  /**
   * The internal task graph containing subtasks
   *
   * In the base case, these may just be incidental tasks that are not part of the task graph
   * but are used to manage the task's state as part of task execution. Therefore, the graph
   * is not used by the default runner.
   *
   * Creates a new graph if one doesn't exist.
   *
   * @returns The task graph
   */
  get subGraph(): TaskGraph {
    if (!this._subGraph) {
      this._subGraph = new TaskGraph();
      this._subGraph.on("task_added", this._taskAddedListener);
    }
    return this._subGraph;
  }

  /**
   * Regenerates the task graph, which is internal state to execute() with config.own()
   *
   * This is a destructive operation that removes all dataflows and tasks from the graph.
   * It is used to reset the graph to a clean state.
   *
   * GraphAsTask and others override this and do not call super
   */
  public regenerateGraph(): void {
    if (this.hasChildren()) {
      for (const dataflow of this.subGraph.getDataflows()) {
        this.subGraph.removeDataflow(dataflow);
      }
      for (const child of this.subGraph.getTasks()) {
        this.subGraph.removeTask(child.config.id);
      }
    }
    this.events.emit("regenerate");
  }
}
