/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import { Dataflow } from "../task-graph/Dataflow";
import { TaskGraph } from "../task-graph/TaskGraph";
import { GraphAsTaskRunner } from "./GraphAsTaskRunner";
import type { ITaskConstructor } from "./ITask";
import type { IterationAnalysisResult, IteratorTask, IteratorTaskConfig } from "./IteratorTask";
import type { TaskInput, TaskOutput } from "./TaskTypes";

/**
 * Runner for IteratorTask that executes a single subgraph repeatedly with
 * per-iteration inputs. The task defines iteration analysis/collection hooks,
 * while this runner owns scheduling and execution orchestration.
 */
export class IteratorTaskRunner<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends IteratorTaskConfig = IteratorTaskConfig,
> extends GraphAsTaskRunner<Input, Output, Config> {
  declare task: IteratorTask<Input, Output, Config>;

  /**
   * For iterator tasks, reactive runs use full execution for correctness.
   */

  protected override async executeTask(input: Input): Promise<Output | undefined> {
    const analysis = this.task.analyzeIterationInput(input);

    if (analysis.iterationCount === 0) {
      const emptyResult = this.task.getEmptyResult();
      return this.executeTaskReactive(input, emptyResult as Output);
    }

    const result = this.task.isReduceTask()
      ? await this.executeReduceIterations(analysis)
      : await this.executeCollectIterations(analysis);

    return this.executeTaskReactive(input, result as Output);
  }

  /**
   * Iterator tasks should only run the task's reactive hook here.
   */
  public override async executeTaskReactive(input: Input, output: Output): Promise<Output> {
    const reactiveResult = await this.task.executeReactive(input, output, { own: this.own });
    return Object.assign({}, output, reactiveResult ?? {}) as Output;
  }

  protected async executeCollectIterations(analysis: IterationAnalysisResult): Promise<Output> {
    const iterationCount = analysis.iterationCount;
    const preserveOrder = this.task.preserveIterationOrder();

    const batchSize =
      this.task.batchSize !== undefined && this.task.batchSize > 0
        ? this.task.batchSize
        : iterationCount;

    const requestedConcurrency = this.task.concurrencyLimit ?? iterationCount;
    const concurrency = Math.max(1, Math.min(requestedConcurrency, iterationCount));

    const orderedResults: Array<TaskOutput | undefined> = preserveOrder
      ? new Array(iterationCount)
      : [];
    const completionOrderResults: TaskOutput[] = [];

    let completedCount = 0;

    for (let batchStart = 0; batchStart < iterationCount; batchStart += batchSize) {
      if (this.abortController?.signal.aborted) {
        break;
      }

      const batchEnd = Math.min(batchStart + batchSize, iterationCount);
      const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

      const batchResults = await this.executeBatch(
        batchIndices,
        analysis,
        iterationCount,
        concurrency,
        async () => {
          completedCount++;
          const progress = Math.round((completedCount / iterationCount) * 100);
          await this.handleProgress(
            progress,
            `Completed ${completedCount}/${iterationCount} iterations`
          );
        }
      );

      for (const { index, result } of batchResults) {
        if (result === undefined) continue;

        if (preserveOrder) {
          orderedResults[index] = result;
        } else {
          completionOrderResults.push(result);
        }
      }
    }

    const collected = preserveOrder
      ? orderedResults.filter((result): result is TaskOutput => result !== undefined)
      : completionOrderResults;

    return this.task.collectResults(collected);
  }

  protected async executeReduceIterations(analysis: IterationAnalysisResult): Promise<Output> {
    const iterationCount = analysis.iterationCount;
    let accumulator = this.task.getInitialAccumulator();

    for (let index = 0; index < iterationCount; index++) {
      if (this.abortController?.signal.aborted) {
        break;
      }

      const iterationInput = this.task.buildIterationRunInput(analysis, index, iterationCount, {
        accumulator,
      });

      const iterationResult = await this.executeSubgraphIteration(iterationInput);
      accumulator = this.task.mergeIterationIntoAccumulator(accumulator, iterationResult, index);

      const progress = Math.round(((index + 1) / iterationCount) * 100);
      await this.handleProgress(progress, `Completed ${index + 1}/${iterationCount} iterations`);
    }

    return accumulator;
  }

  protected async executeBatch(
    indices: number[],
    analysis: IterationAnalysisResult,
    iterationCount: number,
    concurrency: number,
    onItemComplete?: () => Promise<void>
  ): Promise<Array<{ index: number; result: TaskOutput | undefined }>> {
    const results: Array<{ index: number; result: TaskOutput | undefined }> = [];
    let cursor = 0;

    const workerCount = Math.max(1, Math.min(concurrency, indices.length));

    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        if (this.abortController?.signal.aborted) {
          return;
        }

        const position = cursor;
        cursor += 1;

        if (position >= indices.length) {
          return;
        }

        const index = indices[position];
        const iterationInput = this.task.buildIterationRunInput(analysis, index, iterationCount);
        const result = await this.executeSubgraphIteration(iterationInput);
        results.push({ index, result });
        await onItemComplete?.();
      }
    });

    await Promise.all(workers);
    return results;
  }

  /**
   * Clones a TaskGraph by reconstructing each task from its constructor,
   * defaults, and config. This preserves non-serializable config such as
   * function references (e.g. WhileTask condition functions) via `getCloneConfig()`.
   */
  private cloneGraph(graph: TaskGraph): TaskGraph {
    const clone = new TaskGraph();
    const idMap = new Map<unknown, string>();
    for (const task of graph.getTasks()) {
      const ctor = task.constructor as ITaskConstructor<any, any, any>;
      const newId = uuid4();
      idMap.set(task.config.id, newId);
      const clonedConfig = { ...task.getCloneConfig(), id: newId };
      const newTask = new ctor(task.defaults, clonedConfig, task.runConfig);
      if (task.hasChildren()) {
        newTask.subGraph = this.cloneGraph(task.subGraph);
      }
      clone.addTask(newTask);
    }
    for (const df of graph.getDataflows()) {
      clone.addDataflow(
        new Dataflow(
          idMap.get(df.sourceTaskId) ?? df.sourceTaskId,
          df.sourceTaskPortId,
          idMap.get(df.targetTaskId) ?? df.targetTaskId,
          df.targetTaskPortId
        )
      );
    }
    return clone;
  }

  protected async executeSubgraphIteration(
    input: Record<string, unknown>
  ): Promise<TaskOutput | undefined> {
    if (this.abortController?.signal.aborted) {
      return undefined;
    }

    const graphClone = this.cloneGraph(this.task.subGraph);

    const results = await graphClone.run<TaskOutput>(input as TaskInput, {
      parentSignal: this.abortController?.signal,
      outputCache: this.outputCache,
      registry: this.registry,
    });

    if (results.length === 0) {
      return undefined;
    }

    return graphClone.mergeExecuteOutputsToRunOutput(
      results,
      this.task.compoundMerge
    ) as TaskOutput;
  }
}
