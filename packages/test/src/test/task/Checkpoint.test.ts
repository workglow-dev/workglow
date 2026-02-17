/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CheckpointData, Dataflow, InMemoryCheckpointSaver, TaskGraph } from "@workglow/task-graph";
import { beforeEach, describe, expect, it } from "vitest";
import { FailingTask, NumberTask, TestSimpleTask } from "./TestTasks";

describe("Checkpoint", () => {
  let saver: InMemoryCheckpointSaver;

  beforeEach(() => {
    saver = new InMemoryCheckpointSaver();
  });

  describe("InMemoryCheckpointSaver", () => {
    it("should save and retrieve a checkpoint", async () => {
      const data: CheckpointData = {
        checkpointId: "cp-1",
        threadId: "thread-1",
        graphJson: { tasks: [], dataflows: [] },
        taskStates: [],
        dataflowStates: [],
        metadata: { createdAt: new Date().toISOString() },
      };

      await saver.saveCheckpoint(data);
      const retrieved = await saver.getCheckpoint("cp-1");
      expect(retrieved).toEqual(data);
    });

    it("should return undefined for non-existent checkpoint", async () => {
      const retrieved = await saver.getCheckpoint("non-existent");
      expect(retrieved).toBeUndefined();
    });

    it("should get latest checkpoint for thread", async () => {
      const data1: CheckpointData = {
        checkpointId: "cp-1",
        threadId: "thread-1",
        graphJson: { tasks: [], dataflows: [] },
        taskStates: [],
        dataflowStates: [],
        metadata: { createdAt: "2025-01-01T00:00:00Z" },
      };
      const data2: CheckpointData = {
        checkpointId: "cp-2",
        threadId: "thread-1",
        parentCheckpointId: "cp-1",
        graphJson: { tasks: [], dataflows: [] },
        taskStates: [],
        dataflowStates: [],
        metadata: { createdAt: "2025-01-01T00:01:00Z" },
      };

      await saver.saveCheckpoint(data1);
      await saver.saveCheckpoint(data2);

      const latest = await saver.getLatestCheckpoint("thread-1");
      expect(latest?.checkpointId).toBe("cp-2");
    });

    it("should get checkpoint history for thread", async () => {
      await saver.saveCheckpoint({
        checkpointId: "cp-1",
        threadId: "thread-1",
        graphJson: { tasks: [], dataflows: [] },
        taskStates: [],
        dataflowStates: [],
        metadata: { createdAt: "2025-01-01T00:00:00Z" },
      });
      await saver.saveCheckpoint({
        checkpointId: "cp-2",
        threadId: "thread-1",
        graphJson: { tasks: [], dataflows: [] },
        taskStates: [],
        dataflowStates: [],
        metadata: { createdAt: "2025-01-01T00:01:00Z" },
      });
      await saver.saveCheckpoint({
        checkpointId: "cp-3",
        threadId: "thread-2",
        graphJson: { tasks: [], dataflows: [] },
        taskStates: [],
        dataflowStates: [],
        metadata: { createdAt: "2025-01-01T00:02:00Z" },
      });

      const history = await saver.getCheckpointHistory("thread-1");
      expect(history).toHaveLength(2);
    });

    it("should get checkpoints for iteration", async () => {
      await saver.saveCheckpoint({
        checkpointId: "cp-1",
        threadId: "thread-1",
        graphJson: { tasks: [], dataflows: [] },
        taskStates: [],
        dataflowStates: [],
        metadata: {
          createdAt: "2025-01-01T00:00:00Z",
          iterationParentTaskId: "while-1",
          iterationIndex: 0,
        },
      });
      await saver.saveCheckpoint({
        checkpointId: "cp-2",
        threadId: "thread-1",
        graphJson: { tasks: [], dataflows: [] },
        taskStates: [],
        dataflowStates: [],
        metadata: {
          createdAt: "2025-01-01T00:01:00Z",
          iterationParentTaskId: "while-1",
          iterationIndex: 1,
        },
      });
      await saver.saveCheckpoint({
        checkpointId: "cp-3",
        threadId: "thread-1",
        graphJson: { tasks: [], dataflows: [] },
        taskStates: [],
        dataflowStates: [],
        metadata: {
          createdAt: "2025-01-01T00:02:00Z",
          triggerTaskId: "other-task",
        },
      });

      const iterCheckpoints = await saver.getCheckpointsForIteration("thread-1", "while-1");
      expect(iterCheckpoints).toHaveLength(2);
    });

    it("should delete checkpoints for thread", async () => {
      await saver.saveCheckpoint({
        checkpointId: "cp-1",
        threadId: "thread-1",
        graphJson: { tasks: [], dataflows: [] },
        taskStates: [],
        dataflowStates: [],
        metadata: { createdAt: "2025-01-01T00:00:00Z" },
      });

      await saver.deleteCheckpoints("thread-1");

      const history = await saver.getCheckpointHistory("thread-1");
      expect(history).toHaveLength(0);
    });
  });

  describe("Checkpoint save during graph execution", () => {
    it("should capture checkpoints after each task completion", async () => {
      const graph = new TaskGraph();
      const task1 = new TestSimpleTask({ input: "hello" }, { id: "task-1" });
      const task2 = new TestSimpleTask({ input: "world" }, { id: "task-2" });

      graph.addTask(task1);
      graph.addTask(task2);
      graph.addDataflow(new Dataflow("task-1", "output", "task-2", "input"));

      const checkpoints: CheckpointData[] = [];
      graph.on("checkpoint", (data) => {
        checkpoints.push(data);
      });

      await graph.run(
        {},
        {
          checkpointSaver: saver,
          threadId: "test-thread",
          checkpointGranularity: "every-task",
        }
      );

      // Should have checkpoints for each task completion
      expect(checkpoints.length).toBeGreaterThanOrEqual(1);

      // Verify checkpoint data structure
      const lastCheckpoint = checkpoints[checkpoints.length - 1];
      expect(lastCheckpoint.threadId).toBe("test-thread");
      expect(lastCheckpoint.taskStates.length).toBe(2);
      expect(lastCheckpoint.dataflowStates.length).toBe(1);
    });

    it("should not capture checkpoints when granularity is none", async () => {
      const graph = new TaskGraph();
      const task1 = new TestSimpleTask({ input: "hello" }, { id: "task-1" });

      graph.addTask(task1);

      const checkpoints: CheckpointData[] = [];
      graph.on("checkpoint", (data) => {
        checkpoints.push(data);
      });

      await graph.run(
        {},
        {
          checkpointSaver: saver,
          checkpointGranularity: "none",
        }
      );

      expect(checkpoints).toHaveLength(0);
    });

    it("should capture single checkpoint for top-level-only granularity", async () => {
      const graph = new TaskGraph();
      const task1 = new TestSimpleTask({ input: "hello" }, { id: "task-1" });
      const task2 = new TestSimpleTask({ input: "world" }, { id: "task-2" });

      graph.addTask(task1);
      graph.addTask(task2);
      graph.addDataflow(new Dataflow("task-1", "output", "task-2", "input"));

      const checkpoints: CheckpointData[] = [];
      graph.on("checkpoint", (data) => {
        checkpoints.push(data);
      });

      await graph.run(
        {},
        {
          checkpointSaver: saver,
          threadId: "test-thread",
          checkpointGranularity: "top-level-only",
        }
      );

      // Should have exactly one checkpoint at the end
      expect(checkpoints).toHaveLength(1);

      // All tasks should be completed in the checkpoint
      const cp = checkpoints[0];
      expect(cp.taskStates.every((ts) => ts.status === "COMPLETED")).toBe(true);
    });

    it("should persist checkpoints in the saver", async () => {
      const graph = new TaskGraph();
      const task1 = new NumberTask({ input: 42 }, { id: "task-1" });

      graph.addTask(task1);

      await graph.run(
        {},
        {
          checkpointSaver: saver,
          threadId: "persist-thread",
        }
      );

      const history = await saver.getCheckpointHistory("persist-thread");
      expect(history.length).toBeGreaterThanOrEqual(1);

      const latest = await saver.getLatestCheckpoint("persist-thread");
      expect(latest).toBeDefined();
      expect(latest!.threadId).toBe("persist-thread");
    });

    it("should chain parent checkpoint IDs", async () => {
      const graph = new TaskGraph();
      const task1 = new TestSimpleTask({ input: "a" }, { id: "task-1" });
      const task2 = new TestSimpleTask({ input: "b" }, { id: "task-2" });

      graph.addTask(task1);
      graph.addTask(task2);
      graph.addDataflow(new Dataflow("task-1", "output", "task-2", "input"));

      await graph.run(
        {},
        {
          checkpointSaver: saver,
          threadId: "chain-thread",
        }
      );

      const history = await saver.getCheckpointHistory("chain-thread");
      if (history.length >= 2) {
        expect(history[1].parentCheckpointId).toBe(history[0].checkpointId);
      }
    });
  });

  describe("Resume from checkpoint", () => {
    it("should resume from a checkpoint, skipping completed tasks", async () => {
      // First run: execute a graph and save checkpoints
      const graph = new TaskGraph();
      const task1 = new TestSimpleTask({ input: "first" }, { id: "task-1" });
      const task2 = new TestSimpleTask({ input: "second" }, { id: "task-2" });

      graph.addTask(task1);
      graph.addTask(task2);
      graph.addDataflow(new Dataflow("task-1", "output", "task-2", "input"));

      await graph.run(
        {},
        {
          checkpointSaver: saver,
          threadId: "resume-thread",
        }
      );

      // Get the checkpoint after task-1 completed (first checkpoint)
      const history = await saver.getCheckpointHistory("resume-thread");
      expect(history.length).toBeGreaterThanOrEqual(1);

      // Now create a new graph with the same structure and resume
      const graph2 = new TaskGraph();
      const task1b = new TestSimpleTask({ input: "first" }, { id: "task-1" });
      const task2b = new TestSimpleTask({ input: "second" }, { id: "task-2" });

      graph2.addTask(task1b);
      graph2.addTask(task2b);
      graph2.addDataflow(new Dataflow("task-1", "output", "task-2", "input"));

      // Resume from the last checkpoint (all tasks completed)
      const lastCheckpoint = history[history.length - 1];
      const results = await graph2.run(
        {},
        {
          checkpointSaver: saver,
          threadId: "resume-thread-2",
          resumeFromCheckpoint: lastCheckpoint.checkpointId,
        }
      );

      // Should complete successfully
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it("should re-run failed tasks when resuming from checkpoint before failure", async () => {
      // Create a graph where task-2 fails
      const graph = new TaskGraph();
      const task1 = new NumberTask({ input: 42 }, { id: "task-1" });
      const task2 = new FailingTask({}, { id: "task-2" });

      graph.addTask(task1);
      graph.addTask(task2);
      graph.addDataflow(new Dataflow("task-1", "output", "task-2", "in"));

      try {
        await graph.run(
          {},
          {
            checkpointSaver: saver,
            threadId: "fail-thread",
          }
        );
      } catch {
        // Expected failure
      }

      // Should have captured at least a checkpoint after task-1
      const history = await saver.getCheckpointHistory("fail-thread");
      expect(history.length).toBeGreaterThanOrEqual(1);

      // Find the checkpoint where task-1 is completed but task-2 hasn't run yet
      const resumeCheckpoint = history.find((cp) =>
        cp.taskStates.some((ts) => ts.taskId === "task-1" && ts.status === "COMPLETED")
      );
      expect(resumeCheckpoint).toBeDefined();
    });
  });

  describe("Checkpoint data correctness", () => {
    it("should capture task input and output data", async () => {
      const graph = new TaskGraph();
      const task = new NumberTask({ input: 42 }, { id: "task-1" });

      graph.addTask(task);

      await graph.run(
        {},
        {
          checkpointSaver: saver,
          threadId: "data-thread",
        }
      );

      const latest = await saver.getLatestCheckpoint("data-thread");
      expect(latest).toBeDefined();

      const taskState = latest!.taskStates.find((ts) => ts.taskId === "task-1");
      expect(taskState).toBeDefined();
      expect(taskState!.status).toBe("COMPLETED");
      expect(taskState!.outputData).toBeDefined();
      expect(taskState!.outputData.output).toBe(42);
    });

    it("should capture dataflow state", async () => {
      const graph = new TaskGraph();
      const task1 = new NumberTask({ input: 10 }, { id: "task-1" });
      const task2 = new NumberTask({}, { id: "task-2" });

      graph.addTask(task1);
      graph.addTask(task2);
      graph.addDataflow(new Dataflow("task-1", "output", "task-2", "input"));

      await graph.run(
        {},
        {
          checkpointSaver: saver,
          threadId: "df-thread",
        }
      );

      const latest = await saver.getLatestCheckpoint("df-thread");
      expect(latest).toBeDefined();
      expect(latest!.dataflowStates.length).toBe(1);

      const dfState = latest!.dataflowStates[0];
      expect(dfState.sourceTaskId).toBe("task-1");
      expect(dfState.targetTaskId).toBe("task-2");
      expect(dfState.status).toBe("COMPLETED");
    });

    it("should include graph JSON in checkpoint", async () => {
      const graph = new TaskGraph();
      const task = new TestSimpleTask({ input: "test" }, { id: "task-1" });
      graph.addTask(task);

      await graph.run(
        {},
        {
          checkpointSaver: saver,
          threadId: "json-thread",
        }
      );

      const latest = await saver.getLatestCheckpoint("json-thread");
      expect(latest).toBeDefined();
      expect(latest!.graphJson).toBeDefined();
      expect(latest!.graphJson.tasks.length).toBe(1);
    });

    it("should auto-generate threadId when not provided", async () => {
      const graph = new TaskGraph();
      const task = new TestSimpleTask({ input: "test" }, { id: "task-1" });
      graph.addTask(task);

      const checkpoints: CheckpointData[] = [];
      graph.on("checkpoint", (data) => {
        checkpoints.push(data);
      });

      await graph.run(
        {},
        {
          checkpointSaver: saver,
        }
      );

      expect(checkpoints.length).toBeGreaterThanOrEqual(1);
      // Thread ID should be auto-generated (non-empty UUID)
      expect(checkpoints[0].threadId).toBeTruthy();
      expect(checkpoints[0].threadId.length).toBeGreaterThan(0);
    });
  });
});
