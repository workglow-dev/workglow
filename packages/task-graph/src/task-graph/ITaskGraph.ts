/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ITask } from "../task/ITask";
import { JsonTaskItem, TaskGraphJson } from "../task/TaskJSON";
import type { TaskIdType, TaskInput, TaskOutput, TaskStatus } from "../task/TaskTypes";
import { Dataflow, DataflowIdType } from "./Dataflow";
import type { TaskGraphRunConfig } from "./TaskGraph";
import type { TaskGraphEventListener, TaskGraphEvents } from "./TaskGraphEvents";
import {
  CompoundMergeStrategy,
  GraphResult,
  GraphResultArray,
  TaskGraphRunner,
} from "./TaskGraphRunner";

export interface ITaskGraph {
  get runner(): TaskGraphRunner;
  run<ExecuteOutput extends TaskOutput>(
    input?: TaskInput,
    config?: TaskGraphRunConfig
  ): Promise<GraphResultArray<ExecuteOutput>>;
  runReactive<Output extends TaskOutput>(): Promise<GraphResultArray<Output>>;
  mergeExecuteOutputsToRunOutput<
    ExecuteOutput extends TaskOutput,
    Merge extends CompoundMergeStrategy = CompoundMergeStrategy,
  >(
    results: GraphResultArray<ExecuteOutput>,
    compoundMerge: Merge
  ): GraphResult<ExecuteOutput, Merge>;
  abort(): void;
  disable(): Promise<void>;
  getTask(id: TaskIdType): ITask | undefined;
  getTasks(): ITask[];
  topologicallySortedNodes(): ITask[];
  addTask(task: ITask): void;
  addTasks(tasks: ITask[]): void;
  addDataflow(dataflow: Dataflow): void;
  addDataflows(dataflows: Dataflow[]): void;
  getDataflow(id: DataflowIdType): Dataflow | undefined;
  getDataflows(): Dataflow[];
  getSourceDataflows(taskId: unknown): Dataflow[];
  getTargetDataflows(taskId: unknown): Dataflow[];
  getSourceTasks(taskId: unknown): ITask[];
  getTargetTasks(taskId: unknown): ITask[];
  removeTask(taskId: unknown): void;
  toJSON(): TaskGraphJson;
  toDependencyJSON(): JsonTaskItem[];
  subscribe<Event extends TaskGraphEvents>(
    event: Event,
    fn: TaskGraphEventListener<Event>
  ): () => void;
  subscribeToTaskStatus(callback: (taskId: TaskIdType, status: TaskStatus) => void): () => void;
  subscribeToTaskProgress(
    callback: (taskId: TaskIdType, progress: number, message?: string, ...args: any[]) => void
  ): () => void;
  subscribeToDataflowStatus(
    callback: (dataflowId: DataflowIdType, status: TaskStatus) => void
  ): () => void;
}
