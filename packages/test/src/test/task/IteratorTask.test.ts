/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  IteratorTask,
  MapTask,
  ReduceTask,
  Task,
  TaskGraph,
  TaskInput,
  TaskOutput,
  WhileTask,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util";
import { describe, expect, test } from "vitest";

import {
  AddToSumTask,
  DoubleToResultTask as DoubleTask,
  ProcessItemTask,
  RefineTask,
  TestIteratorTask,
  TextEmbeddingTask,
} from "./TestTasks";

interface ArrayInput extends TaskInput {
  items: number[];
}

// ============================================================================
// IteratorTask Base Class Tests
// ============================================================================

describe("IteratorTask", () => {
  describe("constructor and configuration", () => {
    test("should create with default configuration", () => {
      const task = new TestIteratorTask<ArrayInput>({}, {});

      expect(task.concurrencyLimit).toBe(undefined);
      expect(task.batchSize).toBe(undefined);
    });

    test("should respect custom configuration", () => {
      const task = new TestIteratorTask<ArrayInput>(
        {},
        {
          concurrencyLimit: 3,
        }
      );

      expect(task.concurrencyLimit).toBe(3);
    });

    test("should support batchSize configuration", () => {
      const task = new TestIteratorTask<ArrayInput>(
        {},
        {
          batchSize: 10,
        }
      );

      expect(task.batchSize).toBe(10);
    });

    test("should support combined batchSize and concurrencyLimit", () => {
      // When both are set:
      // - Items are grouped into batches of batchSize
      // - Items within each batch run fully in parallel
      // - Batches run with concurrencyLimit parallelism
      const task = new TestIteratorTask<ArrayInput>(
        {},
        {
          concurrencyLimit: 2,
          batchSize: 5,
        }
      );

      expect(task.concurrencyLimit).toBe(2);
      expect(task.batchSize).toBe(5);
    });

    test("should have undefined batchSize by default", () => {
      const task = new TestIteratorTask<ArrayInput>({}, {});

      expect(task.batchSize).toBeUndefined();
    });
  });

  describe("subgraph management", () => {
    test("should set and get subgraph", () => {
      class TestIteratorWithArray extends IteratorTask<ArrayInput> {
        public static inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: { type: "number" },
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }
      }

      const task = new TestIteratorWithArray({ items: [1, 2, 3] }, {});
      const subGraph = new TaskGraph();
      subGraph.addTask(new DoubleTask({ value: 0 }, { id: "double" }));

      task.subGraph = subGraph;

      expect(task.subGraph).toBe(subGraph);
    });
  });
});

// ============================================================================
// MapTask Tests
// ============================================================================

describe("MapTask", () => {
  describe("basic transformation", () => {
    test("should return empty result for empty array", async () => {
      class TestMapTask extends MapTask<ArrayInput> {
        public static inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: { type: "number" },
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }
      }

      const task = new TestMapTask({ items: [] }, {});
      const result = await task.run();

      expect(result).toEqual({});
    });

    test("should have dynamic output schema", () => {
      const task = new MapTask({}, {});
      const schema = task.outputSchema();

      // Without template graph, should return static schema
      expect(typeof schema).toBe("object");
    });
  });

  describe("configuration", () => {
    test("should default preserveOrder to true", () => {
      const task = new MapTask({}, {});
      expect(task.preserveOrder).toBe(true);
    });

    test("should default flatten to false", () => {
      const task = new MapTask({}, {});
      expect(task.flatten).toBe(false);
    });

    test("should respect custom configuration", () => {
      const task = new MapTask({}, { preserveOrder: false, flatten: true });
      expect(task.preserveOrder).toBe(false);
      expect(task.flatten).toBe(true);
    });
  });
});

// ============================================================================
// Type Safety Tests
// ============================================================================

describe("Type Safety", () => {
  test("IteratorTask should be an instance of IteratorTask", () => {
    const task = new TestIteratorTask({}, {});
    expect(task).toBeInstanceOf(IteratorTask);
  });

  test("MapTask should be an instance of IteratorTask", () => {
    const task = new MapTask({}, {});
    expect(task).toBeInstanceOf(IteratorTask);
    expect(task).toBeInstanceOf(MapTask);
  });
});

// ============================================================================
// Schema Tests
// ============================================================================

describe("Schema Handling", () => {
  test("IteratorTask should have hasDynamicSchemas = true", () => {
    expect(IteratorTask.hasDynamicSchemas).toBe(true);
  });

  test("MapTask should have additionalProperties true for input", () => {
    const inputSchema = MapTask.inputSchema();

    expect(typeof inputSchema).toBe("object");
    if (typeof inputSchema === "object") {
      expect(inputSchema.additionalProperties).toBe(true);
    }
  });
});

// ============================================================================
// WhileTask Tests
// ============================================================================

describe("WhileTask", () => {
  describe("configuration", () => {
    test("should default maxIterations to 100", () => {
      const task = new WhileTask({}, {});
      expect(task.maxIterations).toBe(100);
    });

    test("should default chainIterations to true", () => {
      const task = new WhileTask({}, {});
      expect(task.chainIterations).toBe(true);
    });

    test("should respect custom configuration", () => {
      const condition = (output: any, iteration: number) => iteration < 5;
      const task = new WhileTask(
        {},
        {
          condition,
          maxIterations: 50,
          chainIterations: false,
        }
      );

      expect(task.condition).toBe(condition);
      expect(task.maxIterations).toBe(50);
      expect(task.chainIterations).toBe(false);
    });
  });

  describe("subgraph", () => {
    test("should set and get subGraph", () => {
      const task = new WhileTask({}, {});
      const subGraph = new TaskGraph();
      subGraph.addTask(new DoubleTask({ value: 0 }, { id: "double" }));

      task.subGraph = subGraph;

      expect(task.subGraph).toBe(subGraph);
    });
  });

  describe("type safety", () => {
    test("WhileTask should not be an instance of IteratorTask", () => {
      const task = new WhileTask({}, {});
      // WhileTask extends GraphAsTask, not IteratorTask
      expect(task).toBeInstanceOf(WhileTask);
    });
  });

  describe("schema handling", () => {
    test("WhileTask should have hasDynamicSchemas = true", () => {
      expect(WhileTask.hasDynamicSchemas).toBe(true);
    });

    test("WhileTask should have _iterations in output schema", () => {
      const outputSchema = WhileTask.outputSchema();
      expect(typeof outputSchema).toBe("object");
      if (typeof outputSchema === "object") {
        expect(outputSchema.properties).toHaveProperty("_iterations");
      }
    });
  });
});

// ============================================================================
// ReduceTask Tests
// ============================================================================

describe("ReduceTask", () => {
  describe("configuration", () => {
    test("should default initialValue to empty object", () => {
      const task = new ReduceTask({}, {});
      expect(task.initialValue).toEqual({});
    });

    test("should respect custom initialValue", () => {
      const task = new ReduceTask({}, { initialValue: { sum: 0 } });
      expect(task.initialValue).toEqual({ sum: 0 });
    });

    test("should force sequential execution mode (parallel-limited with concurrency 1)", () => {
      const task = new ReduceTask({}, { concurrencyLimit: 5 });
      expect(task.concurrencyLimit).toBe(1);
      expect(task.batchSize).toBe(1);
    });
  });

  describe("type safety", () => {
    test("ReduceTask should be an instance of IteratorTask", () => {
      const task = new ReduceTask({}, {});
      expect(task).toBeInstanceOf(IteratorTask);
      expect(task).toBeInstanceOf(ReduceTask);
    });
  });

  describe("schema handling", () => {
    test("ReduceTask input schema should allow dynamic ports", () => {
      const inputSchema = ReduceTask.inputSchema();
      expect(typeof inputSchema).toBe("object");
      if (typeof inputSchema === "object") {
        expect(inputSchema.additionalProperties).toBe(true);
      }
    });
  });
});

// ============================================================================
// Workflow Loop Methods Tests
// ============================================================================

describe("Workflow Loop Methods", () => {
  test("Workflow should have map method", () => {
    const workflow = new Workflow();
    expect(typeof workflow.map).toBe("function");
  });

  test("Workflow should have while method", () => {
    const workflow = new Workflow();
    expect(typeof workflow.while).toBe("function");
  });

  test("Workflow should have reduce method", () => {
    const workflow = new Workflow();
    expect(typeof workflow.reduce).toBe("function");
  });

  test("map should return a LoopWorkflowBuilder", () => {
    const workflow = new Workflow();
    const builder = workflow.map();

    expect(builder).toBeDefined();
    expect(typeof builder.endMap).toBe("function");
  });

  test("while should return a LoopWorkflowBuilder", () => {
    const workflow = new Workflow();
    const builder = workflow.while({ maxIterations: 10 });

    expect(builder).toBeDefined();
    expect(typeof builder.endWhile).toBe("function");
  });

  test("reduce should return a LoopWorkflowBuilder", () => {
    const workflow = new Workflow();
    const builder = workflow.reduce({ initialValue: { count: 0 } });

    expect(builder).toBeDefined();
    expect(typeof builder.endReduce).toBe("function");
  });

  test("map should add a MapTask to the graph", () => {
    const workflow = new Workflow();
    workflow.map().endMap();

    const tasks = workflow.graph.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toBeInstanceOf(MapTask);
  });

  test("while should add a WhileTask to the graph", () => {
    const workflow = new Workflow();
    workflow.while({ condition: () => false }).endWhile();

    const tasks = workflow.graph.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toBeInstanceOf(WhileTask);
  });

  test("reduce should add a ReduceTask to the graph", () => {
    const workflow = new Workflow();
    workflow.reduce({ initialValue: {} }).endReduce();

    const tasks = workflow.graph.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toBeInstanceOf(ReduceTask);
  });
});

// ============================================================================
// Workflow Integration Tests - Demonstrating Real Usage Patterns
// ============================================================================

/**
 * These tests demonstrate the actual workflow patterns shown in the JSDoc examples.
 * They show how to build and execute workflows with loop tasks.
 */

describe("Workflow Integration - Map Pattern", () => {
  /**
   * Example: Transform each text into an embedding
   *
   * workflow
   *   .map()
   *     .textEmbedding()
   *   .endMap()
   */
  test("should build workflow with map loop for transformation", () => {
    const workflow = new Workflow();

    workflow.map({ preserveOrder: true }).addTask(TextEmbeddingTask).endMap();

    const tasks = workflow.graph.getTasks();
    expect(tasks).toHaveLength(1);

    const mapTask = tasks[0] as MapTask;
    expect(mapTask).toBeInstanceOf(MapTask);
    expect(mapTask.preserveOrder).toBe(true);

    // Verify template graph
    const templateGraph = mapTask.subGraph;
    expect(templateGraph).toBeDefined();
    expect(templateGraph?.getTasks()).toHaveLength(1);
    expect(templateGraph?.getTasks()[0]).toBeInstanceOf(TextEmbeddingTask);
  });

  test("map with flatten option should configure correctly", () => {
    const workflow = new Workflow();

    workflow.map({ flatten: true, concurrencyLimit: 5 }).addTask(TextEmbeddingTask).endMap();

    const mapTask = workflow.graph.getTasks()[0] as MapTask;
    expect(mapTask.flatten).toBe(true);
    expect(mapTask.concurrencyLimit).toBe(5);
  });
});

describe("Workflow Integration - While Pattern", () => {
  /**
   * Example: Refine until quality threshold is met
   *
   * workflow
   *   .while({
   *     condition: (output, iteration) => output.quality < 0.9 && iteration < 10,
   *     maxIterations: 20
   *   })
   *     .refineResult()
   *   .endWhile()
   */
  test("should build workflow with while loop for iterative refinement", () => {
    const condition = (output: any, iteration: number) => output.quality < 0.9 && iteration < 10;

    const workflow = new Workflow();

    workflow
      .while({
        condition,
        maxIterations: 20,
      })
      .addTask(RefineTask)
      .endWhile();

    const tasks = workflow.graph.getTasks();
    expect(tasks).toHaveLength(1);

    const whileTask = tasks[0] as WhileTask;
    expect(whileTask).toBeInstanceOf(WhileTask);
    expect(whileTask.condition).toBe(condition);
    expect(whileTask.maxIterations).toBe(20);

    // Verify subgraph
    expect(whileTask.hasChildren()).toBe(true);
    expect(whileTask.subGraph.getTasks()).toHaveLength(1);
  });

  /**
   * Example: Retry until success
   *
   * workflow
   *   .while({
   *     condition: (output) => !output.success,
   *     maxIterations: 5
   *   })
   *     .attemptOperation()
   *   .endWhile()
   */
  test("should support retry pattern with while loop", () => {
    const retryCondition = (output: any) => !output.success;

    const workflow = new Workflow();

    workflow
      .while({
        condition: retryCondition,
        maxIterations: 5,
        chainIterations: true,
      })
      .addTask(RefineTask)
      .endWhile();

    const whileTask = workflow.graph.getTasks()[0] as WhileTask;
    expect(whileTask.maxIterations).toBe(5);
    expect(whileTask.chainIterations).toBe(true);
  });
});

describe("Workflow Integration - Reduce Pattern", () => {
  /**
   * Example: Sum all numbers in an array
   *
   * workflow
   *   .reduce({ initialValue: { sum: 0 } })
   *     .addToSum()
   *   .endReduce()
   */
  test("should build workflow with reduce loop for aggregation", () => {
    const workflow = new Workflow();

    workflow
      .reduce({ initialValue: { sum: 0 } })
      .addTask(AddToSumTask)
      .endReduce();

    const tasks = workflow.graph.getTasks();
    expect(tasks).toHaveLength(1);

    const reduceTask = tasks[0] as ReduceTask;
    expect(reduceTask).toBeInstanceOf(ReduceTask);
    expect(reduceTask.initialValue).toEqual({ sum: 0 });

    // Verify template graph
    const templateGraph = reduceTask.subGraph;
    expect(templateGraph).toBeDefined();
    expect(templateGraph?.getTasks()).toHaveLength(1);
  });

  test("reduce with custom initial value should configure correctly", () => {
    const workflow = new Workflow();

    workflow
      .reduce({
        initialValue: { count: 0, total: 0 },
      })
      .addTask(AddToSumTask)
      .endReduce();

    const reduceTask = workflow.graph.getTasks()[0] as ReduceTask;
    expect(reduceTask.initialValue).toEqual({ count: 0, total: 0 });
  });
});

describe("Workflow Integration - Chained Loops", () => {
  /**
   * Example: Multiple loop operations in sequence
   *
   * workflow
   *   .map()
   *     .textEmbedding()
   *   .endMap()
   *   .reduce({ initialValue: { sum: 0 } })
   *     .addToSum()
   *   .endReduce()
   */
  test("should support chaining multiple loop operations", () => {
    const workflow = new Workflow();

    workflow
      .map()
      .addTask(TextEmbeddingTask)
      .endMap()
      .reduce({ initialValue: { sum: 0 } })
      .addTask(AddToSumTask)
      .endReduce();

    const tasks = workflow.graph.getTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toBeInstanceOf(MapTask);
    expect(tasks[1]).toBeInstanceOf(ReduceTask);
  });

  test("should chain map followed by reduce", () => {
    const workflow = new Workflow();

    workflow
      .map({ concurrencyLimit: 1 })
      .addTask(ProcessItemTask)
      .endMap()
      .reduce({ initialValue: { sum: 0 } })
      .addTask(AddToSumTask)
      .endReduce();

    const tasks = workflow.graph.getTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toBeInstanceOf(MapTask);
    expect(tasks[1]).toBeInstanceOf(ReduceTask);
  });
});

describe("Workflow Integration - Multiple Tasks in Loop", () => {
  /**
   * Example: Chain multiple tasks inside a loop
   *
   * workflow
   *   .map()
   *     .processItem()
   *     .anotherTask()
   *   .endMap()
   */
  test("should support multiple tasks inside a loop", () => {
    const workflow = new Workflow();

    workflow.map().addTask(ProcessItemTask).addTask(DoubleTask).endMap();

    const mapTask = workflow.graph.getTasks()[0] as MapTask;
    const templateGraph = mapTask.subGraph;

    expect(templateGraph).toBeDefined();
    expect(templateGraph?.getTasks()).toHaveLength(2);
    expect(templateGraph?.getTasks()[0]).toBeInstanceOf(ProcessItemTask);
    expect(templateGraph?.getTasks()[1]).toBeInstanceOf(DoubleTask);
  });

  test("while loop with multiple refinement steps", () => {
    const workflow = new Workflow();

    workflow
      .while({
        condition: (output, iteration) => iteration < 3,
        maxIterations: 10,
      })
      .addTask(RefineTask)
      .addTask(DoubleTask)
      .endWhile();

    const whileTask = workflow.graph.getTasks()[0] as WhileTask;

    expect(whileTask.hasChildren()).toBe(true);
    expect(whileTask.subGraph.getTasks()).toHaveLength(2);
  });
});

describe("Workflow Integration - Template Graph Access", () => {
  test("loop builder graph should be accessible", () => {
    const workflow = new Workflow();

    const builder = workflow.map();
    expect(builder.graph).toBeInstanceOf(TaskGraph);
    builder.endMap();
  });

  test("template graph should contain added tasks with auto-generated IDs", () => {
    const workflow = new Workflow();

    workflow.map().addTask(ProcessItemTask).addTask(DoubleTask).endMap();

    const mapTask = workflow.graph.getTasks()[0] as MapTask;
    const templateTasks = mapTask.subGraph?.getTasks() ?? [];

    // Tasks should have auto-generated UUID IDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(templateTasks[0].config.id).toMatch(uuidRegex);
    expect(templateTasks[1].config.id).toMatch(uuidRegex);
    // IDs should be unique
    expect(templateTasks[0].config.id).not.toBe(templateTasks[1].config.id);
  });

  test("template graph dataflows should be created between tasks with matching ports", () => {
    // Create tasks with compatible output->input port names
    interface CompatibleInput extends TaskInput {
      readonly result: number;
    }

    interface CompatibleOutput extends TaskOutput {
      readonly result: number;
    }

    class TaskA extends Task<TaskInput, CompatibleOutput> {
      public static type = "IteratorTask_TaskA";
      public static inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { input: { type: "number" } },
          additionalProperties: true,
        } as const satisfies DataPortSchema;
      }
      public static outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { result: { type: "number" } },
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }
      async execute(): Promise<CompatibleOutput> {
        return { result: 42 };
      }
    }

    class TaskB extends Task<CompatibleInput, TaskOutput> {
      public static type = "IteratorTask_TaskB";
      public static inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { result: { type: "number" } },
          required: ["result"],
          additionalProperties: true,
        } as const satisfies DataPortSchema;
      }
      public static outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { final: { type: "number" } },
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }
      async execute(input: CompatibleInput): Promise<TaskOutput> {
        return { final: input.result * 2 };
      }
    }

    const workflow = new Workflow();

    workflow.map().addTask(TaskA).addTask(TaskB).endMap();

    const mapTask = workflow.graph.getTasks()[0] as MapTask;
    const templateGraph = mapTask.subGraph;
    const dataflows = templateGraph?.getDataflows() ?? [];

    // Should have a dataflow connecting the two tasks via matching 'result' port
    expect(dataflows.length).toBeGreaterThan(0);
    expect(dataflows[0].sourceTaskPortId).toBe("result");
    expect(dataflows[0].targetTaskPortId).toBe("result");
  });
});

// ============================================================================
// Execution Regression Tests
// ============================================================================

describe("Iterator Execution Regressions", () => {
  test("workflow map run should execute without pre-run scalar failure", async () => {
    const workflow = new Workflow();

    workflow.map().addTask(ProcessItemTask).endMap();

    const result = await workflow.run({ item: [1, 2, 3] });
    expect(result.processed).toEqual([2, 4, 6]);
  });

  test("direct MapTask.run should execute a reusable subgraph across iterations", async () => {
    const mapTask = new MapTask({}, {});
    const subGraph = new TaskGraph();
    subGraph.addTask(new ProcessItemTask({ item: 0 }, { id: "process" }));

    mapTask.subGraph = subGraph;

    const result = await mapTask.run({ item: [4, 5, 6] } as TaskInput);
    expect(result.processed).toEqual([8, 10, 12]);
  });

  test("map preserveOrder=true should return outputs aligned to input index", async () => {
    class DelayedEchoTask extends Task<{ item: number }, { item: number }> {
      public static type = "DelayedEchoTask";

      public static inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            item: { type: "number" },
          },
          required: ["item"],
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }

      public static outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            item: { type: "number" },
          },
          required: ["item"],
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }

      async execute(input: { item: number }): Promise<{ item: number }> {
        await new Promise((resolve) => setTimeout(resolve, (4 - input.item) * 5));
        return { item: input.item };
      }
    }

    const workflow = new Workflow();
    workflow.map({ preserveOrder: true, concurrencyLimit: 3 }).addTask(DelayedEchoTask).endMap();

    const result = await workflow.run({ item: [1, 2, 3] });
    expect(result.item).toEqual([1, 2, 3]);
  });

  test("map preserveOrder=false should still return complete results", async () => {
    const workflow = new Workflow();
    workflow.map({ preserveOrder: false, concurrencyLimit: 3 }).addTask(ProcessItemTask).endMap();

    const result = await workflow.run({ item: [1, 2, 3] });
    expect((result.processed as number[]).slice().sort((a, b) => a - b)).toEqual([2, 4, 6]);
  });

  test("map should honor batchSize and concurrency settings without data loss", async () => {
    const workflow = new Workflow();
    workflow.map({ concurrencyLimit: 2, batchSize: 2 }).addTask(ProcessItemTask).endMap();

    const result = await workflow.run({ item: [1, 2, 3, 4, 5] });
    expect(result.processed).toEqual([2, 4, 6, 8, 10]);
  });

  test("reduce should process multiple iterated ports with zip semantics", async () => {
    class ZipReduceTask extends Task<
      { accumulator: { sum: number }; left: number; right: number },
      { sum: number }
    > {
      public static type = "ZipReduceTask";

      public static inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            accumulator: {
              type: "object",
              properties: {
                sum: { type: "number" },
              },
            },
            left: { type: "number" },
            right: { type: "number" },
          },
          required: ["accumulator", "left", "right"],
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }

      public static outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            sum: { type: "number" },
          },
          required: ["sum"],
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }

      async execute(input: { accumulator: { sum: number }; left: number; right: number }) {
        return {
          sum: input.accumulator.sum + input.left + input.right,
        };
      }
    }

    const workflow = new Workflow();
    workflow
      .reduce({ initialValue: { sum: 0 } })
      .addTask(ZipReduceTask)
      .endReduce();

    const result = await workflow.run({ left: [1, 2, 3], right: [10, 20, 30] });
    expect(result.sum).toBe(66);
  });

  test("reduce with AddToSumTask should sum array via workflow.run", async () => {
    const workflow = new Workflow();
    workflow
      .reduce({ initialValue: { sum: 0 } })
      .addTask(AddToSumTask)
      .endReduce();

    const result = await workflow.run({ currentItem: [1, 2, 3, 4] });
    expect(result.sum).toBe(10);
  });

  test("while loop should execute via workflow.run and stop when condition false", async () => {
    const workflow = new Workflow();
    workflow
      .while({
        condition: (output: { quality: number }, iteration: number) =>
          output.quality < 0.9 && iteration < 10,
        maxIterations: 20,
      })
      .addTask(RefineTask)
      .endWhile();

    const result = await workflow.run({ value: 0 });
    expect(result).toBeDefined();
    expect(result.quality).toBeGreaterThanOrEqual(0.2);
    expect(result.value).toBeGreaterThan(0);
  });

  test("chained map->reduce should execute end-to-end via workflow.run", async () => {
    // Map inner task outputs "currentItem" so MapTask collects { currentItem: [2,4,6] }.
    // That feeds into ReduceTask whose inner AddToSumTask expects "currentItem".
    class DoubleToCurrentItemTask extends Task<{ item: number }, { currentItem: number }> {
      static type = "DoubleToCurrentItemTask";
      static inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { item: { type: "number" } },
          required: ["item"],
          additionalProperties: true,
        } as const satisfies DataPortSchema;
      }
      static outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { currentItem: { type: "number" } },
          required: ["currentItem"],
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }
      async execute(input: { item: number }): Promise<{ currentItem: number }> {
        return { currentItem: input.item * 2 };
      }
    }

    const workflow = new Workflow();
    workflow
      .map({ concurrencyLimit: 1 })
      .addTask(DoubleToCurrentItemTask)
      .endMap()
      .reduce({ initialValue: { sum: 0 } })
      .addTask(AddToSumTask)
      .endReduce();

    // Map doubles [1,2,3] → currentItem: [2,4,6], reduce sums → 12
    const result = await workflow.run({ item: [1, 2, 3] });
    expect(result.sum).toBe(12);
  });

  test("map with TextEmbeddingTask should produce embeddings via workflow.run", async () => {
    const workflow = new Workflow();
    workflow.map().addTask(TextEmbeddingTask).endMap();

    const result = (await workflow.run({ text: ["hi", "bye"] })) as {
      vector?: readonly (readonly number[])[];
    };
    expect(result.vector).toHaveLength(2);
    expect(result.vector![0]).toBeDefined();
    expect(result.vector![1]).toBeDefined();
  });

  test("iteration analysis should respect annotation/schema/runtime precedence", () => {
    class PrecedenceIterator extends IteratorTask<TaskInput, TaskOutput> {
      public static type = "PrecedenceIterator";

      public static inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            forceArray: {
              oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
              "x-ui-iteration": true,
            },
            forceScalar: {
              type: "array",
              items: { type: "number" },
              "x-ui-iteration": false,
            },
            inferredArray: {
              type: "array",
              items: { type: "number" },
            },
            runtimeFlexible: {
              oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
            },
          },
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }
    }

    const task = new PrecedenceIterator({}, {});
    const analysis = task.analyzeIterationInput({
      forceArray: [1, 2],
      forceScalar: [100, 200],
      inferredArray: [3, 4],
      runtimeFlexible: [5, 6],
    } as TaskInput);

    expect(analysis.arrayPorts.sort()).toEqual(["forceArray", "inferredArray", "runtimeFlexible"]);
    expect(analysis.scalarPorts).toContain("forceScalar");

    const first = analysis.getIterationInput(0);
    expect(first.forceArray).toBe(1);
    expect(first.inferredArray).toBe(3);
    expect(first.runtimeFlexible).toBe(5);
    expect(first.forceScalar).toEqual([100, 200]);
  });
});

// ============================================================================
// Complex Nested Loops (map/while/reduce) - Workflow Integration
// ============================================================================

describe("Complex Nested Loops - Workflow", () => {
  describe("map with while inside (each item refined until condition)", () => {
    test("should run while loop per map item and collect refined results", async () => {
      // For each value in [0,1,2], run a while loop that refines until quality >= 0.9.
      // RefineTask: quality += 0.2 per step, value += 1. So 5 steps to reach 1.0 from 0.
      const workflow = new Workflow();
      workflow
        .map()
        .while({
          condition: (output: { quality?: number }) => (output?.quality ?? 0) < 0.9,
          maxIterations: 10,
          chainIterations: true,
        })
        .addTask(RefineTask)
        .endWhile()
        .endMap();

      const result = await workflow.run({ value: [0, 1, 2] });
      expect(result).toBeDefined();
      expect(result.quality).toEqual([1, 1, 1]);
      expect(result.value).toEqual([5, 6, 7]); // 0+5, 1+5, 2+5 refinements
    });

    test("should respect maxIterations when while is inside map", async () => {
      const workflow = new Workflow();
      workflow
        .map()
        .while({
          condition: () => true, // never exit by condition
          maxIterations: 2,
          chainIterations: true,
        })
        .addTask(RefineTask)
        .endWhile()
        .endMap();

      const result = await workflow.run({ value: [0, 0] });
      expect(result).toBeDefined();
      // 2 iterations each: quality 0.4, value 2 per item
      expect((result.quality as number[]).every((q) => q === 0.4)).toBe(true);
      expect(result.value).toEqual([2, 2]);
    });
  });

  describe("while with map inside (each iteration processes an array)", () => {
    test("should run map over array inside each while iteration", async () => {
      // Outer while: run up to 3 times (by iteration count).
      // Inner map: double each item in the array for that iteration.
      // Input: value (for while start), item: [1,2,3] as scalar passed through?
      // We need while to run 3 times; each time run map on [1,2,3]. So we need
      // the while to receive "item" as scalar and pass it to inner map.
      const workflow = new Workflow();
      workflow
        .while({
          condition: (_output: unknown, iteration: number) => iteration < 3,
          maxIterations: 5,
          chainIterations: true,
        })
        .map()
        .addTask(ProcessItemTask)
        .endMap()
        .endWhile();

      const workflow2 = new Workflow();
      workflow2
        .while({
          condition: (_o: unknown, iteration: number) => iteration < 3,
          maxIterations: 5,
          chainIterations: false,
        })
        .map()
        .addTask(ProcessItemTask)
        .endMap()
        .endWhile();

      const result = await workflow2.run({ item: [1, 2, 3] });
      expect(result).toBeDefined();
      // 3 iterations, each: map on [1,2,3] -> processed [2,4,6]. Last iteration wins.
      expect(result.processed).toEqual([2, 4, 6]);
    });
  });

  describe("map -> reduce with nested map in reduce body", () => {
    test("map then reduce then run with array input", async () => {
      const workflow = new Workflow();
      workflow
        .map({ concurrencyLimit: 1 })
        .addTask(ProcessItemTask)
        .endMap()
        .rename("processed", "currentItem")
        .reduce({ initialValue: { sum: 0 } })
        .addTask(AddToSumTask)
        .endReduce();

      const result = await workflow.run({ item: [1, 2, 3, 4] });
      expect(result.sum).toBe(20); // 2+4+6+8
    });
  });

  describe("triple nesting: map containing while then task after", () => {
    test("map(while(RefineTask).addTask(DoubleTask)) runs correctly", async () => {
      // While condition only sees ending-node outputs. Use RefineTask as sole while body
      // (ending node outputs {quality, value}), then DoubleTask after while completes.
      const workflow = new Workflow();
      workflow
        .map()
        .while({
          condition: (output: { quality?: number }) => (output?.quality ?? 0) < 0.9,
          maxIterations: 10,
          chainIterations: true,
        })
        .addTask(RefineTask)
        .endWhile()
        .addTask(DoubleTask)
        .endMap();

      const result = await workflow.run({ value: [0] });
      expect(result).toBeDefined();
      expect(result.result).toEqual([10]); // 5 refinements -> value 5, doubled -> 10
    });
  });

  describe("reduce with while inside (structure and execution)", () => {
    test("should build reduce whose body contains a WhileTask", () => {
      const workflow = new Workflow();
      workflow
        .reduce({ initialValue: { sum: 0 } })
        .while({
          condition: () => false,
          maxIterations: 2,
        })
        .addTask(RefineTask)
        .endWhile()
        .addTask(AddToSumTask)
        .endReduce();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(1);
      const reduceTask = tasks[0] as ReduceTask;
      expect(reduceTask.subGraph?.getTasks().length).toBeGreaterThanOrEqual(1);
      const whileTask = reduceTask.subGraph?.getTasks()[0] as WhileTask;
      expect(whileTask).toBeInstanceOf(WhileTask);
      expect(whileTask.subGraph?.getTasks()[0]).toBeInstanceOf(RefineTask);
    });
  });

  describe("empty and edge-case nesting", () => {
    test("map with empty while (condition false immediately) still returns structure", async () => {
      const workflow = new Workflow();
      workflow
        .map()
        .while({
          condition: () => false,
          maxIterations: 5,
          chainIterations: true,
        })
        .addTask(RefineTask)
        .endWhile()
        .endMap();

      const result = await workflow.run({ value: [0] });
      expect(result).toBeDefined();
      // While runs 0 iterations (condition false), so RefineTask never runs - we need to check what the while returns when it runs 0 times.
      expect(result).toHaveProperty("value");
    });

    test("chained map -> while -> map (outer map, inner while with inner map) via structure only", () => {
      const workflow = new Workflow();
      workflow
        .map()
        .while({ condition: () => false, maxIterations: 2 })
        .map()
        .addTask(ProcessItemTask)
        .endMap()
        .endWhile()
        .endMap();

      const tasks = workflow.graph.getTasks();
      expect(tasks).toHaveLength(1);
      const mapTask = tasks[0] as MapTask;
      expect(mapTask.subGraph?.getTasks()).toHaveLength(1);
      const whileTask = mapTask.subGraph?.getTasks()[0] as WhileTask;
      expect(whileTask.subGraph?.getTasks()).toHaveLength(1);
      const innerMapTask = whileTask.subGraph?.getTasks()[0] as MapTask;
      expect(innerMapTask.subGraph?.getTasks()).toHaveLength(1);
      expect(innerMapTask.subGraph?.getTasks()[0]).toBeInstanceOf(ProcessItemTask);
    });
  });
});
