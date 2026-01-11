/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema, EventEmitter } from "@workglow/util";
import { TaskOutputRepository } from "../storage/TaskOutputRepository";
import { ITaskGraph } from "../task-graph/ITaskGraph";
import { IWorkflow } from "../task-graph/IWorkflow";
import type { TaskGraph } from "../task-graph/TaskGraph";
import { CompoundMergeStrategy } from "../task-graph/TaskGraphRunner";
import { TaskError } from "./TaskError";
import type {
  TaskEventListener,
  TaskEventListeners,
  TaskEventParameters,
  TaskEvents,
} from "./TaskEvents";
import type { JsonTaskItem, TaskGraphItemJson } from "./TaskJSON";
import { TaskRunner } from "./TaskRunner";
import type { TaskConfig, TaskInput, TaskOutput, TaskStatus } from "./TaskTypes";

/**
 * Context for task execution
 */
export interface IExecuteContext {
  signal: AbortSignal;
  updateProgress: (progress: number, message?: string, ...args: any[]) => Promise<void>;
  own: <T extends ITask | ITaskGraph | IWorkflow>(i: T) => T;
}

export type IExecuteReactiveContext = Pick<IExecuteContext, "own">;

/**
 * Configuration for running a task
 */
export interface IRunConfig {
  nodeProvenance?: Provenance;
  outputCache?: TaskOutputRepository | boolean;
  updateProgress?: (
    task: ITask,
    progress: number,
    message?: string,
    ...args: any[]
  ) => Promise<void>;
}

/**
 * Interface for task static property metadata
 *
 *   ==== These should be overriden by every new Task class ====
 */
export interface ITaskStaticProperties {
  readonly type: string;
  readonly category?: string;
  readonly title?: string;
  readonly description?: string;
  readonly cacheable: boolean;
  readonly hasDynamicSchemas: boolean;
  readonly inputSchema: () => DataPortSchema;
  readonly outputSchema: () => DataPortSchema;
}

/**
 * Interface for task execution logic
 * These methods define how tasks are executed and should be implemented by Task subclasses
 */
export interface ITaskExecution<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
> {
  execute(input: Input, context: IExecuteContext): Promise<Output | undefined>;
  executeReactive(
    input: Input,
    output: Output,
    context: IExecuteReactiveContext
  ): Promise<Output | undefined>;
}

/**
 * Interface for task lifecycle management
 * These methods define how tasks are run and are usually delegated to a TaskRunner
 */
export interface ITaskLifecycle<
  Input extends TaskInput,
  Output extends TaskOutput,
  Config extends TaskConfig,
> {
  run(overrides?: Partial<Input>): Promise<Output>;
  runReactive(overrides?: Partial<Input>): Promise<Output>;
  get runner(): TaskRunner<Input, Output, Config>;
  abort(): void;
  disable(): Promise<void>;
}

/**
 * Interface for task input/output operations
 */
export interface ITaskIO<Input extends TaskInput> {
  defaults: Record<string, any>;
  runInputData: Record<string, any>;
  runOutputData: Record<string, any>;

  inputSchema(): DataPortSchema; // gets local access for static inputSchema property
  outputSchema(): DataPortSchema; // gets local access for static outputSchema property
  get type(): string; // gets local access for static type property
  get category(): string; // gets local access for static category property
  get title(): string; // gets local access for static title property

  setDefaults(defaults: Record<string, any>): void;
  resetInputData(): void;
  setInput(input: Record<string, any>): void;
  addInput(overrides: Record<string, any> | undefined): boolean;
  validateInput(input: Record<string, any>): Promise<boolean>;
  get cacheable(): boolean;
  narrowInput(input: Record<string, any>): Promise<Record<string, any>>;
}

export interface ITaskInternalGraph {
  subGraph: TaskGraph;
  hasChildren(): boolean;
  regenerateGraph(): void;
}

/**
 * Interface for task event handling
 */
export interface ITaskEvents {
  get events(): EventEmitter<TaskEventListeners>;

  on<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void;
  off<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void;
  once<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): void;
  waitOn<Event extends TaskEvents>(name: Event): Promise<TaskEventParameters<Event>>;
  emit<Event extends TaskEvents>(name: Event, ...args: TaskEventParameters<Event>): void;
  subscribe<Event extends TaskEvents>(name: Event, fn: TaskEventListener<Event>): () => void;
}

/**
 * Interface for task serialization
 */
export interface ITaskSerialization {
  toJSON(): JsonTaskItem | TaskGraphItemJson;
  toDependencyJSON(): JsonTaskItem;
  id(): unknown;
}

/**
 * Interface for task configuration and state
 */
export interface ITaskState<Config extends TaskConfig = TaskConfig> {
  readonly config: Config;
  status: TaskStatus;
  progress: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: TaskError;
}

/**
 * Main task interface that combines all the specialized interfaces
 */
export interface ITask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig = TaskConfig,
>
  extends
    ITaskState<Config>,
    ITaskIO<Input>,
    ITaskEvents,
    ITaskLifecycle<Input, Output, Config>,
    ITaskExecution<Input, Output>,
    ITaskSerialization,
    ITaskInternalGraph {}

export interface IGraphAsTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ITask<Input, Output, Config> {
  get compoundMerge(): CompoundMergeStrategy;
}

/**
 * Type for task constructor
 */
type ITaskConstructorType<
  Input extends TaskInput,
  Output extends TaskOutput,
  Config extends TaskConfig,
> = new (input: Input, config: Config) => ITask<Input, Output, Config>;

/**
 * Interface for task constructor with static properties
 */
export type ITaskConstructor<
  Input extends TaskInput,
  Output extends TaskOutput,
  Config extends TaskConfig,
> = ITaskConstructorType<Input, Output, Config> & ITaskStaticProperties;
