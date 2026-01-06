/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util";
import { describe, expect, test } from "vitest";
import { Dataflow } from "../task-graph/Dataflow";
import { TaskGraph } from "../task-graph/TaskGraph";
import { GraphAsTask } from "./GraphAsTask";
import type { IExecuteContext } from "./ITask";
import { Task } from "./Task";
import type { TaskGraphItemJson, TaskGraphJson } from "./TaskJSON";
import { createGraphFromGraphJSON, createTaskFromGraphJSON } from "./TaskJSON";
import { TaskRegistry } from "./TaskRegistry";

// Test task classes
class TestTask extends Task<{ value: number }, { result: number }> {
  static readonly type = "TestTask";
  static readonly category = "Test";
  static readonly title = "Test Task";
  static readonly description = "A simple test task";
  declare runInputData: { value: number };
  declare runOutputData: { result: number };

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { value: number }, context: IExecuteContext): Promise<{ result: number }> {
    return { result: input.value * 2 };
  }
}

class TestTaskWithDefaults extends Task<
  { value: number; multiplier?: number },
  { result: number }
> {
  static readonly type = "TestTaskWithDefaults";
  static readonly category = "Test";
  declare runInputData: { value: number; multiplier?: number };
  declare runOutputData: { result: number };

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number" },
        multiplier: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(
    input: { value: number; multiplier?: number },
    context: IExecuteContext
  ): Promise<{ result: number }> {
    const multiplier = input.multiplier ?? 1;
    return { result: input.value * multiplier };
  }
}

class TestGraphAsTask extends GraphAsTask<{ input: string }, { output: string }> {
  static readonly type = "TestGraphAsTask";
  static readonly category = "Test";
  declare runInputData: { input: string };
  declare runOutputData: { output: string };

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: { type: "string" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: { type: "string" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
}

// Register test tasks
TaskRegistry.registerTask(TestTask);
TaskRegistry.registerTask(TestTaskWithDefaults);
TaskRegistry.registerTask(TestGraphAsTask);

describe("TaskJSON", () => {
  describe("Task.toJSON()", () => {
    test("should serialize a simple task to JSON", () => {
      const task = new TestTask({ value: 42 }, { id: "task1", name: "My Task" });
      const json = task.toJSON();

      expect(json.id).toBe("task1");
      expect(json.type).toBe("TestTask");
      expect(json.name).toBe("My Task");
      expect(json.defaults).toEqual({ value: 42 });
      expect(json.extras).toBeUndefined();
    });

    test("should serialize task with defaults", () => {
      const task = new TestTaskWithDefaults({ value: 10, multiplier: 5 }, { id: "task2" });
      const json = task.toJSON();

      expect(json.defaults).toEqual({ value: 10, multiplier: 5 });
    });

    test("should serialize task with extras", () => {
      const task = new TestTask(
        { value: 100 },
        {
          id: "task3",
          extras: { metadata: { key: "value" } },
        }
      );
      const json = task.toJSON();

      expect(json.extras).toEqual({ metadata: { key: "value" } });
    });
  });

  describe("TaskGraph.toJSON()", () => {
    test("should serialize a task graph to JSON", () => {
      const graph = new TaskGraph();
      const task1 = new TestTask({ value: 10 }, { id: "task1" });
      const task2 = new TestTask({ value: 20 }, { id: "task2" });
      graph.addTask(task1);
      graph.addTask(task2);
      graph.addDataflow(new Dataflow("task1", "result", "task2", "value"));

      const json = graph.toJSON();

      expect(json.tasks).toHaveLength(2);
      expect(json.dataflows).toHaveLength(1);
      expect(json.tasks[0].id).toBe("task1");
      expect(json.tasks[1].id).toBe("task2");
      expect(json.dataflows[0]).toEqual({
        sourceTaskId: "task1",
        sourceTaskPortId: "result",
        targetTaskId: "task2",
        targetTaskPortId: "value",
      });
    });

    test("should serialize graph with multiple dataflows", () => {
      const graph = new TaskGraph();
      const task1 = new TestTask({ value: 10 }, { id: "task1" });
      const task2 = new TestTask({ value: 20 }, { id: "task2" });
      const task3 = new TestTask({ value: 30 }, { id: "task3" });
      graph.addTask(task1);
      graph.addTask(task2);
      graph.addTask(task3);
      graph.addDataflow(new Dataflow("task1", "result", "task2", "value"));
      graph.addDataflow(new Dataflow("task1", "result", "task3", "value"));

      const json = graph.toJSON();

      expect(json.tasks).toHaveLength(3);
      expect(json.dataflows).toHaveLength(2);
    });
  });

  describe("createTaskFromGraphJSON()", () => {
    test("should create a task from JSON", () => {
      const json: TaskGraphItemJson = {
        id: "task1",
        type: "TestTask",
        name: "My Task",
        defaults: { value: 42 },
      };

      const task = createTaskFromGraphJSON(json);

      expect(task.config.id).toBe("task1");
      expect(task.type).toBe("TestTask");
      expect(task.config.name).toBe("My Task");
      expect(task.defaults).toEqual({ value: 42 });
    });

    test("should create a task with defaults", () => {
      const json: TaskGraphItemJson = {
        id: "task2",
        type: "TestTaskWithDefaults",
        defaults: { value: 10, multiplier: 5 },
      };

      const task = createTaskFromGraphJSON(json);

      expect(task.defaults).toEqual({ value: 10, multiplier: 5 });
    });

    test("should create a task with provenance and extras", () => {
      const json: TaskGraphItemJson = {
        id: "task3",
        type: "TestTask",
        defaults: { value: 100 },
        extras: { metadata: { key: "value" } },
      };

      const task = createTaskFromGraphJSON(json);

      expect(task.config.extras).toEqual({ metadata: { key: "value" } });
    });

    test("should throw error if task type is not found", () => {
      const json: TaskGraphItemJson = {
        id: "task4",
        type: "NonExistentTask",
        defaults: { value: 10 },
      };

      expect(() => createTaskFromGraphJSON(json)).toThrow("Task type NonExistentTask not found");
    });

    test("should throw error if id is missing", () => {
      const json = {
        type: "TestTask",
        defaults: { value: 10 },
      } as unknown as TaskGraphItemJson;

      expect(() => createTaskFromGraphJSON(json)).toThrow("Task id required");
    });

    test("should throw error if type is missing", () => {
      const json = {
        id: "task5",
        defaults: { value: 10 },
      } as unknown as TaskGraphItemJson;

      expect(() => createTaskFromGraphJSON(json)).toThrow("Task type required");
    });
  });

  describe("createGraphFromGraphJSON()", () => {
    test("should create a task graph from JSON", () => {
      const json: TaskGraphJson = {
        tasks: [
          {
            id: "task1",
            type: "TestTask",
            defaults: { value: 10 },
          },
          {
            id: "task2",
            type: "TestTask",
            defaults: { value: 20 },
          },
        ],
        dataflows: [
          {
            sourceTaskId: "task1",
            sourceTaskPortId: "result",
            targetTaskId: "task2",
            targetTaskPortId: "value",
          },
        ],
      };

      const graph = createGraphFromGraphJSON(json);

      const tasks = graph.getTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].config.id).toBe("task1");
      expect(tasks[1].config.id).toBe("task2");

      const dataflows = graph.getDataflows();
      expect(dataflows).toHaveLength(1);
      expect(dataflows[0].sourceTaskId).toBe("task1");
      expect(dataflows[0].targetTaskId).toBe("task2");
    });

    test("should create graph with nested subgraph", () => {
      const json: TaskGraphJson = {
        tasks: [
          {
            id: "parent",
            type: "TestGraphAsTask",
            defaults: { input: "test" },
            subgraph: {
              tasks: [
                {
                  id: "child1",
                  type: "TestTask",
                  defaults: { value: 5 },
                },
                {
                  id: "child2",
                  type: "TestTask",
                  defaults: { value: 10 },
                },
              ],
              dataflows: [],
            },
          },
        ],
        dataflows: [],
      };

      const graph = createGraphFromGraphJSON(json);

      const tasks = graph.getTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].config.id).toBe("parent");
      expect(tasks[0]).toBeInstanceOf(GraphAsTask);

      const graphAsTask = tasks[0] as GraphAsTask<any, any>;
      expect(graphAsTask.subGraph).toBeDefined();
      const subTasks = graphAsTask.subGraph!.getTasks();
      expect(subTasks).toHaveLength(2);
    });
  });

  describe("Round-trip serialization", () => {
    test("should round-trip a simple task graph", () => {
      const originalGraph = new TaskGraph();
      const task1 = new TestTask({ value: 10 }, { id: "task1", name: "Task 1" });
      const task2 = new TestTask({ value: 20 }, { id: "task2", name: "Task 2" });
      originalGraph.addTask(task1);
      originalGraph.addTask(task2);
      originalGraph.addDataflow(new Dataflow("task1", "result", "task2", "value"));

      const json = originalGraph.toJSON();
      const restoredGraph = createGraphFromGraphJSON(json);

      const originalTasks = originalGraph.getTasks();
      const restoredTasks = restoredGraph.getTasks();

      expect(restoredTasks).toHaveLength(originalTasks.length);
      expect(restoredTasks[0].config.id).toBe(originalTasks[0].config.id);
      expect(restoredTasks[0].type).toBe(originalTasks[0].type);
      expect(restoredTasks[0].config.name).toBe(originalTasks[0].config.name);
      expect(restoredTasks[0].defaults).toEqual(originalTasks[0].defaults);

      const originalDataflows = originalGraph.getDataflows();
      const restoredDataflows = restoredGraph.getDataflows();

      expect(restoredDataflows).toHaveLength(originalDataflows.length);
      expect(restoredDataflows[0].sourceTaskId).toBe(originalDataflows[0].sourceTaskId);
      expect(restoredDataflows[0].targetTaskId).toBe(originalDataflows[0].targetTaskId);
    });

    test("should round-trip a task graph with defaults, and extras", () => {
      const originalGraph = new TaskGraph();
      const task1 = new TestTaskWithDefaults(
        { value: 10, multiplier: 3 },
        {
          id: "task1",
          name: "Task with Defaults",
          extras: { metadata: { key: "value" } },
        }
      );
      originalGraph.addTask(task1);

      const json = originalGraph.toJSON();
      const restoredGraph = createGraphFromGraphJSON(json);

      const restoredTask = restoredGraph.getTasks()[0];
      expect(restoredTask.defaults).toEqual({ value: 10, multiplier: 3 });
      expect(restoredTask.config.extras).toEqual({ metadata: { key: "value" } });
    });

    test("should round-trip a graph with nested subgraph", () => {
      const originalGraph = new TaskGraph();
      const parentTask = new TestGraphAsTask({ input: "test" }, { id: "parent" });
      const childGraph = new TaskGraph();
      const child1 = new TestTask({ value: 5 }, { id: "child1" });
      const child2 = new TestTask({ value: 10 }, { id: "child2" });
      childGraph.addTask(child1);
      childGraph.addTask(child2);
      parentTask.subGraph = childGraph;
      originalGraph.addTask(parentTask);

      const json = originalGraph.toJSON();
      const restoredGraph = createGraphFromGraphJSON(json);

      const restoredParent = restoredGraph.getTasks()[0] as GraphAsTask<any, any>;
      expect(restoredParent.subGraph).toBeDefined();
      const restoredChildren = restoredParent.subGraph!.getTasks();
      expect(restoredChildren).toHaveLength(2);
      expect(restoredChildren[0].config.id).toBe("child1");
      expect(restoredChildren[1].config.id).toBe("child2");
    });
  });
});
