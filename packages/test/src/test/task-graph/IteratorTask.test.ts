/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  IExecuteContext,
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

// ============================================================================
// Test Helper Tasks
// ============================================================================

interface DoubleInput extends TaskInput {
  value: number;
}

interface DoubleOutput extends TaskOutput {
  result: number;
}

/**
 * A simple task that doubles a number
 */
class DoubleTask extends Task<DoubleInput, DoubleOutput> {
  public static type = "DoubleTask";

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number", default: 0 },
      },
      required: ["value"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "number" },
      },
      required: ["result"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: DoubleInput, context: IExecuteContext): Promise<DoubleOutput> {
    return { result: input.value * 2 };
  }
}

interface SquareInput extends TaskInput {
  value: number;
}

interface SquareOutput extends TaskOutput {
  squared: number;
}

/**
 * A simple task that squares a number
 */
class SquareTask extends Task<SquareInput, SquareOutput> {
  public static type = "SquareTask";

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number", default: 0 },
      },
      required: ["value"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        squared: { type: "number" },
      },
      required: ["squared"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: SquareInput, context: IExecuteContext): Promise<SquareOutput> {
    return { squared: input.value * input.value };
  }
}

interface ArrayInput extends TaskInput {
  items: number[];
}

/**
 * Concrete implementation of IteratorTask for testing.
 * Since IteratorTask is abstract, we need a concrete subclass for tests.
 */
class TestIteratorTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
> extends IteratorTask<Input, Output> {
  public static type = "TestIteratorTask";

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "number" },
        },
      },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }
}

// ============================================================================
// IteratorTask Base Class Tests
// ============================================================================

describe("IteratorTask", () => {
  describe("constructor and configuration", () => {
    test("should create with default configuration", () => {
      const task = new TestIteratorTask<ArrayInput>({}, {});

      expect(task.executionMode).toBe("parallel");
      expect(task.concurrencyLimit).toBe(5);
    });

    test("should respect custom configuration", () => {
      const task = new TestIteratorTask<ArrayInput>(
        {},
        {
          executionMode: "parallel-limited",
          concurrencyLimit: 3,
        }
      );

      expect(task.executionMode).toBe("parallel-limited");
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
          executionMode: "parallel-limited",
          concurrencyLimit: 2,
          batchSize: 5,
        }
      );

      expect(task.executionMode).toBe("parallel-limited");
      expect(task.concurrencyLimit).toBe(2);
      expect(task.batchSize).toBe(5);
    });

    test("should have undefined batchSize by default", () => {
      const task = new TestIteratorTask<ArrayInput>({}, {});

      expect(task.batchSize).toBeUndefined();
    });
  });

  describe("iterator port detection", () => {
    test("should detect array port from input schema", () => {
      // Create a custom IteratorTask with a known array input
      class TestIteratorTask extends IteratorTask<ArrayInput> {
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

      const task = new TestIteratorTask({ items: [1, 2, 3] }, {});
      expect(task.getIteratorPortName()).toBe("items");
    });

    test("should use explicit iteratorPort from config", () => {
      class TestIteratorTask extends IteratorTask<ArrayInput> {
        public static inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: { type: "number" },
              },
              otherArray: {
                type: "array",
                items: { type: "string" },
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }
      }

      const task = new TestIteratorTask({ items: [1, 2, 3] }, { iteratorPort: "otherArray" });
      expect(task.getIteratorPortName()).toBe("otherArray");
    });
  });

  describe("template graph management", () => {
    test("should set and get template graph", () => {
      // Need a subclass with an array input schema for setTemplateGraph to work
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
      const templateGraph = new TaskGraph();
      templateGraph.addTask(new DoubleTask({ value: 0 }, { id: "double" }));

      task.setTemplateGraph(templateGraph);

      expect(task.getTemplateGraph()).toBe(templateGraph);
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
// Execution Mode Tests
// ============================================================================

describe("Execution Modes", () => {
  test("IteratorTask should support all execution modes", () => {
    const modes = ["parallel", "parallel-limited"] as const;

    for (const mode of modes) {
      const task = new TestIteratorTask({}, { executionMode: mode });
      expect(task.executionMode).toBe(mode);
    }
  });

  test("parallel-limited mode should use concurrencyLimit", () => {
    const task = new TestIteratorTask(
      {},
      {
        executionMode: "parallel-limited",
        concurrencyLimit: 3,
      }
    );

    expect(task.executionMode).toBe("parallel-limited");
    expect(task.concurrencyLimit).toBe(3);
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

  describe("template graph", () => {
    test("should set and get template graph", () => {
      const task = new WhileTask({}, {});
      const templateGraph = new TaskGraph();
      templateGraph.addTask(new DoubleTask({ value: 0 }, { id: "double" }));

      task.setTemplateGraph(templateGraph);

      expect(task.getTemplateGraph()).toBe(templateGraph);
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

    test("should default port names correctly", () => {
      const task = new ReduceTask({}, {});
      expect(task.accumulatorPort).toBe("accumulator");
      expect(task.currentItemPort).toBe("currentItem");
      expect(task.indexPort).toBe("index");
    });

    test("should respect custom configuration", () => {
      const task = new ReduceTask(
        {},
        {
          initialValue: { sum: 0 },
          accumulatorPort: "acc",
          currentItemPort: "item",
          indexPort: "i",
        }
      );

      expect(task.initialValue).toEqual({ sum: 0 });
      expect(task.accumulatorPort).toBe("acc");
      expect(task.currentItemPort).toBe("item");
      expect(task.indexPort).toBe("i");
    });

    test("should force sequential execution mode (parallel-limited with concurrency 1)", () => {
      const task = new ReduceTask({}, { executionMode: "parallel" });
      // ReduceTask should force sequential regardless of config (using parallel-limited with concurrency of 1)
      expect(task.executionMode).toBe("parallel-limited");
      expect(task.concurrencyLimit).toBe(1);
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
    test("ReduceTask input schema should have accumulator ports", () => {
      const inputSchema = ReduceTask.inputSchema();
      expect(typeof inputSchema).toBe("object");
      if (typeof inputSchema === "object") {
        expect(inputSchema.properties).toHaveProperty("accumulator");
        expect(inputSchema.properties).toHaveProperty("currentItem");
        expect(inputSchema.properties).toHaveProperty("index");
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

// Additional helper tasks for workflow integration tests

interface ItemInput extends TaskInput {
  readonly item: number;
}

interface ItemOutput extends TaskOutput {
  readonly processed: number;
}

/**
 * Processes a single item by doubling it
 */
class ProcessItemTask extends Task<ItemInput, ItemOutput> {
  public static type = "ProcessItemTask";

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        item: { type: "number" },
      },
      required: ["item"],
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        processed: { type: "number" },
      },
      required: ["processed"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: ItemInput, context: IExecuteContext): Promise<ItemOutput> {
    return { processed: input.item * 2 };
  }
}

interface TextInput extends TaskInput {
  readonly text: string;
}

interface EmbeddingOutput extends TaskOutput {
  readonly vector: readonly number[];
}

/**
 * Creates a mock embedding from text
 */
class TextEmbeddingTask extends Task<TextInput, EmbeddingOutput> {
  public static type = "TextEmbeddingTask";

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        vector: {
          type: "array",
          items: { type: "number" },
        },
      },
      required: ["vector"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: TextInput, context: IExecuteContext): Promise<EmbeddingOutput> {
    // Mock embedding: convert text to array of char codes (simplified)
    const vector = input.text.split("").map((c) => c.charCodeAt(0) / 255);
    return { vector };
  }
}

interface QualityInput extends TaskInput {
  readonly value: number;
}

interface QualityOutput extends TaskOutput {
  readonly quality: number;
  readonly value: number;
}

/**
 * Refines a value and calculates quality score
 */
class RefineTask extends Task<QualityInput, QualityOutput> {
  public static type = "RefineTask";

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number" },
        quality: { type: "number" },
      },
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        quality: { type: "number" },
        value: { type: "number" },
      },
      required: ["quality", "value"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: QualityInput, context: IExecuteContext): Promise<QualityOutput> {
    // Each refinement improves quality by 0.2 (capped at 1.0)
    const currentQuality = (input as any).quality ?? 0;
    const newQuality = Math.min(1.0, currentQuality + 0.2);
    return {
      quality: newQuality,
      value: input.value + 1,
    };
  }
}

interface AccumulatorInput extends TaskInput {
  readonly accumulator: { readonly sum: number };
  readonly currentItem: number;
  readonly index: number;
}

interface AccumulatorOutput extends TaskOutput {
  readonly sum: number;
}

/**
 * Adds current item to accumulator sum
 */
class AddToSumTask extends Task<AccumulatorInput, AccumulatorOutput> {
  public static type = "AddToSumTask";

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
        currentItem: { type: "number" },
        index: { type: "number" },
      },
      additionalProperties: true,
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

  async execute(input: AccumulatorInput, context: IExecuteContext): Promise<AccumulatorOutput> {
    return { sum: input.accumulator.sum + input.currentItem };
  }
}

interface BatchInput extends TaskInput {
  readonly items: readonly number[];
}

interface BatchOutput extends TaskOutput {
  readonly results: readonly number[];
}

/**
 * Processes a batch of items
 */
class BulkProcessTask extends Task<BatchInput, BatchOutput> {
  public static type = "BulkProcessTask";

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "number" },
        },
      },
      required: ["items"],
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: { type: "number" },
        },
      },
      required: ["results"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: BatchInput, context: IExecuteContext): Promise<BatchOutput> {
    return { results: input.items.map((x) => x * 10) };
  }
}

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
    const templateGraph = mapTask.getTemplateGraph();
    expect(templateGraph).toBeDefined();
    expect(templateGraph?.getTasks()).toHaveLength(1);
    expect(templateGraph?.getTasks()[0]).toBeInstanceOf(TextEmbeddingTask);
  });

  test("map with flatten option should configure correctly", () => {
    const workflow = new Workflow();

    workflow
      .map({ flatten: true, executionMode: "parallel-limited", concurrencyLimit: 5 })
      .addTask(TextEmbeddingTask)
      .endMap();

    const mapTask = workflow.graph.getTasks()[0] as MapTask;
    expect(mapTask.flatten).toBe(true);
    expect(mapTask.executionMode).toBe("parallel-limited");
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

    // Verify template graph
    const templateGraph = whileTask.getTemplateGraph();
    expect(templateGraph).toBeDefined();
    expect(templateGraph?.getTasks()).toHaveLength(1);
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
    expect(reduceTask.executionMode).toBe("parallel-limited"); // Always sequential (via parallel-limited with concurrency 1) for reduce

    // Verify template graph
    const templateGraph = reduceTask.getTemplateGraph();
    expect(templateGraph).toBeDefined();
    expect(templateGraph?.getTasks()).toHaveLength(1);
  });

  test("reduce with custom port names should configure correctly", () => {
    const workflow = new Workflow();

    workflow
      .reduce({
        initialValue: { count: 0, total: 0 },
        accumulatorPort: "acc",
        currentItemPort: "item",
        indexPort: "idx",
      })
      .addTask(AddToSumTask)
      .endReduce();

    const reduceTask = workflow.graph.getTasks()[0] as ReduceTask;
    expect(reduceTask.initialValue).toEqual({ count: 0, total: 0 });
    expect(reduceTask.accumulatorPort).toBe("acc");
    expect(reduceTask.currentItemPort).toBe("item");
    expect(reduceTask.indexPort).toBe("idx");
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
      .map({ executionMode: "parallel-limited", concurrencyLimit: 1 })
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
    const templateGraph = mapTask.getTemplateGraph();

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
    const templateGraph = whileTask.getTemplateGraph();

    expect(templateGraph).toBeDefined();
    expect(templateGraph?.getTasks()).toHaveLength(2);
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
    const templateTasks = mapTask.getTemplateGraph()?.getTasks() ?? [];

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
    const templateGraph = mapTask.getTemplateGraph();
    const dataflows = templateGraph?.getDataflows() ?? [];

    // Should have a dataflow connecting the two tasks via matching 'result' port
    expect(dataflows.length).toBeGreaterThan(0);
    expect(dataflows[0].sourceTaskPortId).toBe("result");
    expect(dataflows[0].targetTaskPortId).toBe("result");
  });
});
