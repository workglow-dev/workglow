/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ConditionalTask,
  createGraphFromGraphJSON,
  createTaskFromGraphJSON,
  Dataflow,
  GraphAsTask,
  TASK_CONSTRUCTORS,
  TaskGraph,
  TaskRegistry,
  TaskSerializationError,
  WhileTask,
} from "@workglow/task-graph";
import type { TaskGraphItemJson, TaskGraphJson } from "@workglow/task-graph";
import { LambdaTask } from "@workglow/tasks";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { Container, ServiceRegistry, setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";
import { DoubleToResultTask, TestGraphAsTask, TestTaskWithDefaults } from "./TestTasks";

// Register test tasks in the global registry (needed for toJSON serialization)
TaskRegistry.registerTask(DoubleToResultTask);
TaskRegistry.registerTask(TestTaskWithDefaults);
TaskRegistry.registerTask(TestGraphAsTask);

/**
 * Creates an isolated ServiceRegistry with only the specified task constructors.
 * Used to verify that JSON deserialization uses the passed registry, not the global one.
 */
function createTestRegistry(
  tasks: Array<{ type: string; new (...args: any[]): any }>
): ServiceRegistry {
  const container = new Container();
  const registry = new ServiceRegistry(container);
  const constructors = new Map<string, any>();
  for (const task of tasks) {
    constructors.set(task.type, task);
  }
  registry.registerInstance(TASK_CONSTRUCTORS, constructors);
  return registry;
}

describe("TaskJSON", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  let registry: ServiceRegistry;
  let savedGlobalConstructors: Map<string, any>;

  beforeEach(() => {
    // Create an isolated registry with test tasks
    registry = createTestRegistry([DoubleToResultTask, TestTaskWithDefaults, TestGraphAsTask]);
    // Save and blank the global task constructors to ensure tests use the local registry
    savedGlobalConstructors = new Map(TaskRegistry.all);
    TaskRegistry.all.clear();
  });

  afterEach(() => {
    // Restore global task constructors
    for (const [key, value] of savedGlobalConstructors) {
      TaskRegistry.all.set(key, value);
    }
  });
  describe("Task.toJSON()", () => {
    test("should serialize a simple task to JSON", () => {
      const task = new DoubleToResultTask({ value: 42 }, { id: "task1", title: "My Task" });
      const json = task.toJSON();

      expect(json.id).toBe("task1");
      expect(json.type).toBe("DoubleToResultTask");
      expect(json.config?.title).toBe("My Task");
      expect(json.defaults).toEqual({ value: 42 });
      expect(json.config?.extras).toBeUndefined();
    });

    test("should serialize task with defaults", () => {
      const task = new TestTaskWithDefaults({ value: 10, multiplier: 5 }, { id: "task2" });
      const json = task.toJSON();

      expect(json.defaults).toEqual({ value: 10, multiplier: 5 });
    });

    test("should serialize task with extras", () => {
      const task = new DoubleToResultTask(
        { value: 100 },
        {
          id: "task3",
          extras: { metadata: { key: "value" } },
        }
      );
      const json = task.toJSON();

      expect(json.config?.extras).toEqual({ metadata: { key: "value" } });
    });
  });

  describe("TaskGraph.toJSON()", () => {
    test("should serialize a task graph to JSON", () => {
      const graph = new TaskGraph();
      const task1 = new DoubleToResultTask({ value: 10 }, { id: "task1" });
      const task2 = new DoubleToResultTask({ value: 20 }, { id: "task2" });
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
      const task1 = new DoubleToResultTask({ value: 10 }, { id: "task1" });
      const task2 = new DoubleToResultTask({ value: 20 }, { id: "task2" });
      const task3 = new DoubleToResultTask({ value: 30 }, { id: "task3" });
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
        type: "DoubleToResultTask",
        defaults: { value: 42 },
        config: { title: "My Task" },
      };

      const task = createTaskFromGraphJSON(json, registry);

      expect(task.id).toBe("task1");
      expect(task.type).toBe("DoubleToResultTask");
      expect(task.config.title).toBe("My Task");
      expect(task.defaults).toEqual({ value: 42 });
    });

    test("should create a task with defaults", () => {
      const json: TaskGraphItemJson = {
        id: "task2",
        type: "TestTaskWithDefaults",
        defaults: { value: 10, multiplier: 5 },
        config: {},
      };

      const task = createTaskFromGraphJSON(json, registry);

      expect(task.defaults).toEqual({ value: 10, multiplier: 5 });
    });

    test("should create a task with extras", () => {
      const json: TaskGraphItemJson = {
        id: "task3",
        type: "DoubleToResultTask",
        defaults: { value: 100 },
        config: { extras: { metadata: { key: "value" } } },
      };

      const task = createTaskFromGraphJSON(json, registry);

      expect(task.config.extras).toEqual({ metadata: { key: "value" } });
    });

    test("should throw error if task type is not found", () => {
      const json: TaskGraphItemJson = {
        id: "task4",
        type: "NonExistentTask",
        defaults: { value: 10 },
        config: {},
      };

      expect(() => createTaskFromGraphJSON(json, registry)).toThrow(
        "Task type NonExistentTask not found"
      );
    });

    test("should throw error if id is missing", () => {
      const json = {
        type: "DoubleToResultTask",
        defaults: { value: 10 },
      } as unknown as TaskGraphItemJson;

      expect(() => createTaskFromGraphJSON(json, registry)).toThrow("Task id required");
    });

    test("should throw error if type is missing", () => {
      const json = {
        id: "task5",
        defaults: { value: 10 },
      } as unknown as TaskGraphItemJson;

      expect(() => createTaskFromGraphJSON(json, registry)).toThrow("Task type required");
    });

    test("should fail without registry when global constructors are cleared", () => {
      const json: TaskGraphItemJson = {
        id: "task1",
        type: "DoubleToResultTask",
        defaults: { value: 42 },
        config: {},
      };

      // Without passing registry, it falls back to global TaskRegistry which is cleared
      expect(() => createTaskFromGraphJSON(json)).toThrow("Task type DoubleToResultTask not found");
    });
  });

  describe("createGraphFromGraphJSON()", () => {
    test("should create a task graph from JSON", () => {
      const json: TaskGraphJson = {
        tasks: [
          {
            id: "task1",
            type: "DoubleToResultTask",
            defaults: { value: 10 },
            config: {},
          },
          {
            id: "task2",
            type: "DoubleToResultTask",
            defaults: { value: 20 },
            config: {},
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

      const graph = createGraphFromGraphJSON(json, registry);

      const tasks = graph.getTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe("task1");
      expect(tasks[1].id).toBe("task2");

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
            config: {},
            subgraph: {
              tasks: [
                {
                  id: "child1",
                  type: "DoubleToResultTask",
                  defaults: { value: 5 },
                  config: {},
                },
                {
                  id: "child2",
                  type: "DoubleToResultTask",
                  defaults: { value: 10 },
                  config: {},
                },
              ],
              dataflows: [],
            },
          },
        ],
        dataflows: [],
      };

      const graph = createGraphFromGraphJSON(json, registry);

      const tasks = graph.getTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("parent");
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
      const task1 = new DoubleToResultTask({ value: 10 }, { id: "task1", title: "Task 1" });
      const task2 = new DoubleToResultTask({ value: 20 }, { id: "task2", title: "Task 2" });
      originalGraph.addTask(task1);
      originalGraph.addTask(task2);
      originalGraph.addDataflow(new Dataflow("task1", "result", "task2", "value"));

      const json = originalGraph.toJSON();
      const restoredGraph = createGraphFromGraphJSON(json, registry);

      const originalTasks = originalGraph.getTasks();
      const restoredTasks = restoredGraph.getTasks();

      expect(restoredTasks).toHaveLength(originalTasks.length);
      expect(restoredTasks[0].id).toBe(originalTasks[0].id);
      expect(restoredTasks[0].type).toBe(originalTasks[0].type);
      expect(restoredTasks[0].config.title).toBe(originalTasks[0].config.title);
      expect(restoredTasks[0].defaults).toEqual(originalTasks[0].defaults);

      const originalDataflows = originalGraph.getDataflows();
      const restoredDataflows = restoredGraph.getDataflows();

      expect(restoredDataflows).toHaveLength(originalDataflows.length);
      expect(restoredDataflows[0].sourceTaskId).toBe(originalDataflows[0].sourceTaskId);
      expect(restoredDataflows[0].targetTaskId).toBe(originalDataflows[0].targetTaskId);
    });

    test("should round-trip a task graph with defaults and extras", () => {
      const originalGraph = new TaskGraph();
      const task1 = new TestTaskWithDefaults(
        { value: 10, multiplier: 3 },
        {
          id: "task1",
          title: "Task with Defaults",
          extras: { metadata: { key: "value" } },
        }
      );
      originalGraph.addTask(task1);

      const json = originalGraph.toJSON();
      const restoredGraph = createGraphFromGraphJSON(json, registry);

      const restoredTask = restoredGraph.getTasks()[0];
      expect(restoredTask.defaults).toEqual({ value: 10, multiplier: 3 });
      expect(restoredTask.config.extras).toEqual({ metadata: { key: "value" } });
    });

    test("should round-trip a graph with nested subgraph", () => {
      const originalGraph = new TaskGraph();
      const parentTask = new TestGraphAsTask({ input: "test" }, { id: "parent" });
      const childGraph = new TaskGraph();
      const child1 = new DoubleToResultTask({ value: 5 }, { id: "child1" });
      const child2 = new DoubleToResultTask({ value: 10 }, { id: "child2" });
      childGraph.addTask(child1);
      childGraph.addTask(child2);
      parentTask.subGraph = childGraph;
      originalGraph.addTask(parentTask);

      const json = originalGraph.toJSON();
      const restoredGraph = createGraphFromGraphJSON(json, registry);

      const restoredParent = restoredGraph.getTasks()[0] as GraphAsTask<any, any>;
      expect(restoredParent.subGraph).toBeDefined();
      const restoredChildren = restoredParent.subGraph!.getTasks();
      expect(restoredChildren).toHaveLength(2);
      expect(restoredChildren[0].id).toBe("child1");
      expect(restoredChildren[1].id).toBe("child2");
    });
  });

  describe("Serialization safety", () => {
    test("LambdaTask.toJSON() should throw TaskSerializationError", () => {
      const task = new LambdaTask(
        {},
        {
          execute: async (input: any) => input,
        }
      );

      expect(() => task.toJSON()).toThrow(TaskSerializationError);
      expect(() => task.toJSON()).toThrow("cannot be serialized");
    });

    test("WhileTask with native condition and no serializable alternative should throw", () => {
      const task = new WhileTask(
        {},
        {
          condition: (output: any) => output.quality < 0.9,
          maxIterations: 10,
        }
      );

      expect(() => task.toJSON()).toThrow(TaskSerializationError);
      expect(() => task.toJSON()).toThrow("conditionField");
    });

    test("WhileTask with serializable condition should succeed", () => {
      const task = new WhileTask(
        {},
        {
          id: "while1",
          conditionField: "quality",
          conditionOperator: "less_than",
          conditionValue: "0.9",
          maxIterations: 10,
        }
      );

      const json = task.toJSON();
      expect(json.id).toBe("while1");
      expect(json.type).toBe("WhileTask");
      expect(json.config?.conditionField).toBe("quality");
      expect(json.config?.conditionOperator).toBe("less_than");
      expect(json.config?.conditionValue).toBe("0.9");
      expect(json.config?.maxIterations).toBe(10);
    });

    test("WhileTask with both native function and serializable fields should succeed", () => {
      const task = new WhileTask(
        {},
        {
          id: "while2",
          condition: (output: any) => output.quality < 0.9,
          conditionField: "quality",
          conditionOperator: "less_than",
          conditionValue: "0.9",
          maxIterations: 10,
        }
      );

      // Should NOT throw because serializable alternatives exist
      const json = task.toJSON();
      expect(json.config?.conditionField).toBe("quality");
    });

    test("ConditionalTask with native branch functions and no conditionConfig should throw", () => {
      const task = new ConditionalTask(
        {},
        {
          branches: [
            { id: "high", condition: (i: any) => i.value > 100, outputPort: "highPath" },
            { id: "low", condition: (i: any) => i.value <= 100, outputPort: "lowPath" },
          ],
        }
      );

      expect(() => task.toJSON()).toThrow(TaskSerializationError);
      expect(() => task.toJSON()).toThrow("conditionConfig");
    });

    test("ConditionalTask with conditionConfig should succeed", () => {
      const task = new ConditionalTask(
        {},
        {
          id: "cond1",
          conditionConfig: {
            branches: [
              { id: "high", field: "value", operator: "greater_than", value: "100" },
            ],
            exclusive: true,
          },
        }
      );

      const json = task.toJSON();
      expect(json.id).toBe("cond1");
      expect(json.type).toBe("ConditionalTask");
      expect(json.config?.conditionConfig).toBeDefined();
    });

    test("toJSON should not include queue property from JobQueueTask descendants", () => {
      // DoubleToResultTask is a regular Task, but we can test that the
      // config output doesn't contain queue for any task
      const task = new DoubleToResultTask({ value: 42 }, { id: "task1" });
      const json = task.toJSON();

      expect(json.config).toBeDefined();
      expect((json.config as Record<string, unknown>)["queue"]).toBeUndefined();
    });

    test("toJSON should not include non-serializable config properties", () => {
      // Verify that functions and symbols are not silently included
      const task = new DoubleToResultTask({ value: 42 }, { id: "task1" });
      const json = task.toJSON();
      const jsonStr = JSON.stringify(json);

      // Should be valid JSON (no functions or symbols)
      expect(() => JSON.parse(jsonStr)).not.toThrow();
    });
  });
});
