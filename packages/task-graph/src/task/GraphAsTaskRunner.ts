/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { GraphResultArray } from "../task-graph/TaskGraphRunner";
import { GraphAsTask } from "./GraphAsTask";
import { TaskRunner } from "./TaskRunner";
import { TaskConfig, TaskInput, TaskOutput } from "./TaskTypes";

export class GraphAsTaskRunner<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends TaskRunner<Input, Output, Config> {
  declare task: GraphAsTask<Input, Output, Config>;

  /**
   * Protected method to execute a task subgraph by delegating back to the task itself.
   */
  protected async executeTaskChildren(input: Input): Promise<GraphResultArray<Output>> {
    const unsubscribe = this.task.subGraph!.subscribe(
      "graph_progress",
      (progress: number, message?: string, ...args: any[]) => {
        this.task.emit("progress", progress, message, ...args);
      }
    );
    const results = await this.task.subGraph!.run<Output>(input, {
      parentProvenance: this.nodeProvenance || [],
      parentSignal: this.abortController?.signal,
      outputCache: this.outputCache,
    });
    unsubscribe();
    return results;
  }
  /**
   * Protected method for reactive execution delegation
   *
   * Note: Reactive execution doesn't accept input parameters by design.
   * It works with the graph's internal state and dataflow connections.
   * Tasks in the subgraph will use their existing runInputData (from defaults
   * or previous execution) combined with dataflow connections.
   */
  protected async executeTaskChildrenReactive(): Promise<GraphResultArray<Output>> {
    return this.task.subGraph!.runReactive<Output>();
  }

  protected async handleDisable(): Promise<void> {
    if (this.task.hasChildren()) {
      await this.task.subGraph!.disable();
    }
    super.handleDisable();
  }

  // ========================================================================
  // TaskRunner method overrides and helpers
  // ========================================================================

  /**
   * Execute the task
   */
  protected async executeTask(input: Input): Promise<Output | undefined> {
    if (this.task.hasChildren()) {
      const runExecuteOutputData = await this.executeTaskChildren(input);
      this.task.runOutputData = this.task.subGraph.mergeExecuteOutputsToRunOutput(
        runExecuteOutputData,
        this.task.compoundMerge
      );
    } else {
      const result = await super.executeTask(input);
      this.task.runOutputData = result ?? ({} as Output);
    }
    return this.task.runOutputData as Output;
  }

  /**
   * Execute the task reactively
   */
  public async executeTaskReactive(input: Input, output: Output): Promise<Output> {
    if (this.task.hasChildren()) {
      const reactiveResults = await this.executeTaskChildrenReactive();
      this.task.runOutputData = this.task.subGraph.mergeExecuteOutputsToRunOutput(
        reactiveResults,
        this.task.compoundMerge
      );
    } else {
      const reactiveResults = await super.executeTaskReactive(input, output);
      this.task.runOutputData = Object.assign({}, output, reactiveResults ?? {}) as Output;
    }
    return this.task.runOutputData as Output;
  }
}
