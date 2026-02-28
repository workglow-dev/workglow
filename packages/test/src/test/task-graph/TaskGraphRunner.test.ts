/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AnyGraphResult,
  Dataflow,
  DataflowArrow,
  ITask,
  TaskAbortedError,
  TaskGraph,
  TaskGraphRunner,
  TaskOutput,
  TaskStatus,
} from "@workglow/task-graph";
import { sleep, setLogger } from "@workglow/util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FailingTask,
  LongRunningTask,
  TestAddTask,
  TestDoubleTask,
  TestIOTask,
  TestSquareTask,
} from "../task/TestTasks";
import { getTestingLogger } from "../../binding/TestingLogger";

const spyOn = vi.spyOn;

describe("TaskGraphRunner", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let runner: TaskGraphRunner;
  let graph: TaskGraph;
  let nodes: ITask[];

  beforeEach(() => {
    graph = new TaskGraph();
    nodes = [
      new TestIOTask({}, { id: "task0" }),
      new TestSquareTask({ input: 5 }, { id: "task1" }),
      new TestDoubleTask({ input: 5 }, { id: "task2" }),
    ];
    graph.addTasks(nodes);
    runner = new TaskGraphRunner(graph);
  });

  describe("Basic", () => {
    it("should run runReactive", async () => {
      const runReactiveSpy = spyOn(nodes[0], "runReactive");

      await runner.runGraphReactive();

      expect(runReactiveSpy).toHaveBeenCalledTimes(1);
    });

    it("should run the graph with results", async () => {
      const results = await runner.runGraph();

      if (Array.isArray(results)) {
        expect(results.find((r) => r.id === "task1")?.data.output).toEqual(25);
        expect(results.find((r) => r.id === "task2")?.data.output).toEqual(10);
      } else {
        expect(true).toEqual(false);
      }
    });

    it("should run the graph in the correct order with dependencies", async () => {
      const task3 = new TestAddTask({}, { id: "task3" });
      graph.addTask(task3);
      graph.addDataflow(new Dataflow("task1", "output", "task3", "a"));
      graph.addDataflow(new Dataflow("task2", "output", "task3", "b"));

      const results = await runner.runGraph();

      expect(nodes[1].runOutputData.output).toEqual(25);
      expect(nodes[2].runOutputData.output).toEqual(10);
      expect(results.find((r) => r.id === "task3")?.data.output).toEqual(35);
    });
  });

  describe("Status Dataflow Propagation", () => {
    let sourceTask: ITask;
    let errorTask: ITask;
    let targetTask: ITask;

    beforeEach(() => {
      graph = new TaskGraph();

      sourceTask = new TestSquareTask({ input: 5 }, { id: "source" });
      targetTask = new TestDoubleTask({ input: 5 }, { id: "target" });

      // Create a task that will throw an error
      errorTask = new FailingTask({}, { id: "error-source" });
      errorTask.executeReactive = async () => {
        throw new Error("Test error");
      };

      graph.addTasks([sourceTask, targetTask, errorTask]);
      graph.addDataflow(new DataflowArrow("source[output] ==> target[input]"));
      graph.addDataflow(new DataflowArrow("error-source[output] ==> target[input]"));

      runner = new TaskGraphRunner(graph);
    });

    it("should propagate task status to dataflow edges", async () => {
      let runPromise: Promise<AnyGraphResult<TaskOutput>>;
      let error: Error | undefined;

      try {
        runPromise = runner.runGraph();
        await runPromise;
      } catch (err) {
        error = err as Error;
      }

      const sourceDataflows = graph.getTargetDataflows("source");
      expect(sourceDataflows.length).toBe(1);

      const sourceTask = graph.getTask("source");
      expect(sourceTask).toBeDefined();
      if (sourceTask) {
        expect(sourceTask.status).toBe(TaskStatus.COMPLETED);
        sourceDataflows.forEach((dataflow) => {
          expect(dataflow.status).toBe(sourceTask.status);
        });
      }

      const errorDataflows = graph.getTargetDataflows("error-source");
      expect(errorDataflows.length).toBe(1);
      expect(errorTask.status).toBe(TaskStatus.FAILED);
      expect(errorDataflows[0].status).toBe(errorTask.status);
      expect(error).toBeDefined();
    });

    it("should propagate task error to dataflow edges", async () => {
      await expect(runner.runGraph()).rejects.toThrow();

      const dataflows = graph.getTargetDataflows("error-source");
      expect(errorTask.status).toBe(TaskStatus.FAILED);
      expect(dataflows[0].status).toBe(errorTask.status);
      expect(dataflows.length).toBe(1);
      expect(dataflows[0].error).toBeDefined();
      if (dataflows[0].error && errorTask.error) {
        expect(dataflows[0].error).toBe(errorTask.error);
      }
    });

    it("should propagate task abort status to dataflow edges", async () => {
      // Create a graph with a long-running task
      graph = new TaskGraph();
      const longRunningTask = new LongRunningTask({}, { id: "long-running" });

      // Override the executeReactive method to be long-running and check for abort signal
      longRunningTask.executeReactive = async () => {
        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, 1000);
            // Check if we're aborted and clean up
            // @ts-expect-error ts(2445)
            longRunningTask.abortController?.signal.addEventListener("abort", () => {
              clearTimeout(timeout);
              reject(new TaskAbortedError("Aborted"));
            });
          });
          return { output: "completed" };
        } catch (error) {
          // This should be caught by the task's error handling
          throw error;
        }
      };

      graph.addTask(longRunningTask);
      const abortTargetTask = new TestIOTask({}, { id: "abort-target" });
      graph.addTask(abortTargetTask);
      graph.addDataflow(new Dataflow("long-running", "output", "abort-target", "input"));

      runner = new TaskGraphRunner(graph);

      const runPromise = runner.runGraph();
      await sleep(1);
      runner.abort();
      try {
        await runPromise;
      } catch (error) {
        // Expected to fail due to abort
      }
      expect(longRunningTask.status).toBe(TaskStatus.ABORTING);
      const dataflows = graph.getTargetDataflows("long-running");
      expect(dataflows.length).toBe(1);
      expect(dataflows[0].status).toBe(TaskStatus.ABORTING);
      expect(dataflows[0].error).toBeDefined();
      expect(dataflows[0].error).toBeInstanceOf(TaskAbortedError);
    });
  });
});
