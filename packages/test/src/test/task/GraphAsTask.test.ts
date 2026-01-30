import { Dataflow, GraphAsTask, Task, TaskGraph } from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util";
import { describe, expect, it } from "vitest";

// InputTask-like task that passes through its input as output
class GraphAsTask_InputTask extends Task<Record<string, unknown>, Record<string, unknown>> {
  static type = "GraphAsTask_InputTask";
  static category = "Test";
  static hasDynamicSchemas = true;
  static cacheable = false;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const as DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const as DataPortSchema;
  }

  async execute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return input;
  }

  async executeReactive(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return input;
  }
}

// ComputeTask that adds two numbers
class GraphAsTask_ComputeTask extends Task<{ a: number; b: number }, { result: number }> {
  static type = "GraphAsTask_ComputeTask";
  static category = "Test";
  static cacheable = false;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
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

  async execute(input: { a: number; b: number }): Promise<{ result: number }> {
    return { result: input.a + input.b };
  }

  async executeReactive(input: { a: number; b: number }): Promise<{ result: number }> {
    return { result: input.a + input.b };
  }
}

// OutputTask that passes through its input
class GraphAsTask_OutputTask extends Task<Record<string, unknown>, Record<string, unknown>> {
  static type = "GraphAsTask_OutputTask";
  static category = "Test";
  static cacheable = false;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const as DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const as DataPortSchema;
  }

  async execute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return input;
  }

  async executeReactive(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return input;
  }
}

// Custom GraphAsTask with explicit schemas for testing reactive execution
class TestGraphAsTask_AB extends GraphAsTask<{ a: number; b: number }, { result: number }> {
  static type = "TestGraphAsTask_AB";
  static category = "Test";
  static hasDynamicSchemas = true;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
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

  public inputSchema(): DataPortSchema {
    return (this.constructor as typeof TestGraphAsTask_AB).inputSchema();
  }

  public outputSchema(): DataPortSchema {
    return (this.constructor as typeof TestGraphAsTask_AB).outputSchema();
  }
}

class TestGraphAsTask_Value extends GraphAsTask<{ value: string }, { value: string }> {
  static type = "TestGraphAsTask_Value";
  static category = "Test";
  static hasDynamicSchemas = true;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public inputSchema(): DataPortSchema {
    return (this.constructor as typeof TestGraphAsTask_Value).inputSchema();
  }

  public outputSchema(): DataPortSchema {
    return (this.constructor as typeof TestGraphAsTask_Value).outputSchema();
  }
}

// Test tasks with specific input/output schemas
class TaskA extends Task {
  static type = "TaskA";
  static category = "Test";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        inputA1: {
          type: "string",
          description: "First input to A",
        },
        inputA2: {
          type: "number",
          description: "Second input to A",
          default: 42,
        },
      },
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        outputA: {
          type: "string",
          description: "Output from A",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: any): Promise<any> {
    return {
      outputA: `${input.inputA1}-${input.inputA2}`,
    };
  }
}

class TaskB extends Task {
  static type = "TaskB";
  static category = "Test";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        inputB: {
          type: "string",
          description: "Input to B",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        outputB: {
          type: "string",
          description: "Output from B",
        },
      },
    } as const satisfies DataPortSchema;
  }

  async execute(input: any): Promise<any> {
    return {
      outputB: `processed-${input.inputB}`,
    };
  }
}

class TaskC extends Task {
  static type = "TaskC";
  static category = "Test";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        inputC1: {
          type: "string",
          description: "First input to C",
        },
        inputC2: {
          type: "string",
          description: "Second input to C",
          default: "defaultC2",
        },
      },
      required: ["inputC1"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        outputC1: {
          type: "string",
          description: "First output from C",
        },
        outputC2: {
          type: "number",
          description: "Second output from C",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: any): Promise<any> {
    return {
      outputC1: `${input.inputC1}+${input.inputC2}`,
      outputC2: input.inputC1.length + input.inputC2.length,
    };
  }
}

describe("GraphAsTask Dynamic Schema", () => {
  describe("Input Schema Calculation", () => {
    it("should calculate input schema from unconnected inputs of starting nodes", () => {
      // Create a graph with TaskA -> TaskB
      // TaskA is the starting node, TaskB is connected
      const taskA = new TaskA();
      const taskB = new TaskB();

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);

      // Connect TaskA's output to TaskB's input
      const dataflow = new Dataflow(taskA.config.id, "outputA", taskB.config.id, "inputB");
      graph.addDataflow(dataflow);

      // Create GraphAsTask with this subgraph
      const graphAsTask = new GraphAsTask();
      graphAsTask.subGraph = graph;

      // The input schema should be the inputs of TaskA (the starting node)
      const inputSchema = graphAsTask.inputSchema();
      if (typeof inputSchema === "boolean") {
        return;
      }
      expect(inputSchema.properties).toBeDefined();
      expect(inputSchema.properties!["inputA1"]).toBeDefined();
      expect(inputSchema.properties!["inputA2"]).toBeDefined();
      expect(inputSchema.properties!["inputB"]).toBeUndefined(); // TaskB's input is connected
    });

    it("should combine inputs from multiple starting nodes", () => {
      // Create a graph with TaskA and TaskB both starting, connecting to TaskC
      const taskA = new TaskA();
      const taskB = new TaskB();
      const taskC = new TaskC();

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);
      graph.addTask(taskC);

      // Connect TaskA -> TaskC and TaskB -> TaskC
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskC.config.id, "inputC1"));
      graph.addDataflow(new Dataflow(taskB.config.id, "outputB", taskC.config.id, "inputC2"));

      const graphAsTask = new GraphAsTask();
      graphAsTask.subGraph = graph;

      // The input schema should combine inputs from both TaskA and TaskB
      const inputSchema = graphAsTask.inputSchema();
      if (typeof inputSchema === "boolean") {
        return;
      }
      expect(inputSchema.properties).toBeDefined();
      expect(inputSchema.properties!["inputA1"]).toBeDefined();
      expect(inputSchema.properties!["inputA2"]).toBeDefined();
      expect(inputSchema.properties!["inputB"]).toBeDefined();
      expect(inputSchema.properties!["inputC1"]).toBeUndefined(); // Connected
      expect(inputSchema.properties!["inputC2"]).toBeUndefined(); // Connected
    });

    it("should only include inputs from starting nodes", () => {
      // Create a graph where TaskC has an incoming connection from TaskA
      const taskA = new TaskA();
      const taskB = new TaskB();
      const taskC = new TaskC();

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);
      graph.addTask(taskC);

      // TaskC has an incoming connection from TaskA, making it a non-starting node
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskC.config.id, "inputC1"));

      const graphAsTask = new GraphAsTask({}, { subGraph: graph });

      // TaskA and TaskB are starting nodes (no incoming connections)
      // TaskC is NOT a starting node (has incoming connection from TaskA)
      // Only inputs from starting nodes (TaskA and TaskB) should be in the schema
      const inputSchema = graphAsTask.inputSchema();
      if (typeof inputSchema === "boolean") {
        return;
      }
      expect(inputSchema.properties).toBeDefined();

      // TaskC is not a starting node, so none of its inputs should be in the schema
      expect(inputSchema.properties!["inputC1"]).toBeUndefined();
      expect(inputSchema.properties!["inputC2"]).toBeUndefined();

      // TaskA is a starting node, so its inputs should be in the schema
      expect(inputSchema.properties!["inputA1"]).toBeDefined();
      expect(inputSchema.properties!["inputA2"]).toBeDefined();

      // TaskB is a starting node, so its inputs should be in the schema
      expect(inputSchema.properties!["inputB"]).toBeDefined();
    });

    it("should return static schema when no children", () => {
      const graphAsTask = new GraphAsTask();

      // Should return the static empty schema
      const inputSchema = graphAsTask.inputSchema();
      if (typeof inputSchema === "boolean") {
        return;
      }
      expect(inputSchema).toBeDefined();
      expect(Object.keys(inputSchema.properties || {}).length).toBe(0);
    });
  });

  describe("Output Schema Calculation", () => {
    it("should calculate output schema from ending nodes", () => {
      // Create a graph with TaskA -> TaskB
      // TaskB is the ending node
      const taskA = new TaskA();
      const taskB = new TaskB();

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);

      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskB.config.id, "inputB"));

      const graphAsTask = new GraphAsTask();
      graphAsTask.subGraph = graph;

      // The output schema should be TaskB's outputs (the ending node)
      const outputSchema = graphAsTask.outputSchema();
      if (typeof outputSchema === "boolean") {
        expect(outputSchema).toBe(!!outputSchema);
        return;
      }
      expect(outputSchema.properties).toBeDefined();
      expect(outputSchema.properties!["outputB"]).toBeDefined();
      expect(outputSchema.properties!["outputA"]).toBeUndefined(); // TaskA is not an ending node
    });

    it("should combine outputs from multiple ending nodes", () => {
      // Create a graph with TaskA splitting to TaskB and TaskC (both ending)
      const taskA = new TaskA();
      const taskB = new TaskB();
      const taskC = new TaskC();

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);
      graph.addTask(taskC);

      // TaskA connects to both TaskB and TaskC
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskB.config.id, "inputB"));
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskC.config.id, "inputC1"));

      const graphAsTask = new GraphAsTask();
      graphAsTask.subGraph = graph;

      // The output schema should combine outputs from both TaskB and TaskC
      const outputSchema = graphAsTask.outputSchema();
      if (typeof outputSchema === "boolean") {
        return;
      }
      expect(outputSchema.properties).toBeDefined();
      expect(outputSchema.properties!["outputB"]).toBeDefined();
      expect(outputSchema.properties!["outputC1"]).toBeDefined();
      expect(outputSchema.properties!["outputC2"]).toBeDefined();
      expect(outputSchema.properties!["outputA"]).toBeUndefined(); // TaskA is not ending
    });

    it("should return static schema when no children", () => {
      const graphAsTask = new GraphAsTask();

      // Should return the static empty schema
      const outputSchema = graphAsTask.outputSchema();
      if (typeof outputSchema === "boolean") {
        return;
      }
      expect(outputSchema).toBeDefined();
      expect(Object.keys(outputSchema.properties || {}).length).toBe(0);
    });
  });

  describe("Full Graph Integration", () => {
    it("should work with a complete graph execution", async () => {
      // Create a simple pipeline: TaskA -> TaskB
      const taskA = new TaskA({ inputA1: "test", inputA2: 10 });
      const taskB = new TaskB();

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskB.config.id, "inputB"));

      const graphAsTask = new GraphAsTask();
      graphAsTask.subGraph = graph;

      // Verify schemas are calculated correctly
      const inputSchema = graphAsTask.inputSchema();
      const outputSchema = graphAsTask.outputSchema();

      if (typeof inputSchema === "boolean" || typeof outputSchema === "boolean") {
        return;
      }
      expect(inputSchema.properties!["inputA1"]).toBeDefined();
      expect(inputSchema.properties!["inputA2"]).toBeDefined();
      expect(outputSchema.properties!["outputB"]).toBeDefined();

      // Execute the graph
      const result = await graphAsTask.run({ inputA1: "hello", inputA2: 99 });

      // Verify the result
      expect(result).toBeDefined();
      expect(result.outputB).toBe("processed-hello-99");
    });

    it("should handle complex multi-path graphs", async () => {
      // Create a diamond graph:
      //      TaskA
      //     /    \
      //  TaskB  TaskC (inputC2 unconnected but TaskC is not a starting node)
      //     \    /
      //      (outputs from both)

      const taskA = new TaskA({ inputA1: "start", inputA2: 1 });
      const taskB = new TaskB();
      const taskC = new TaskC({ inputC2: "extra" }); // Set default since inputC2 won't be in schema

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);
      graph.addTask(taskC);

      // Fork from TaskA
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskB.config.id, "inputB"));
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskC.config.id, "inputC1"));

      const graphAsTask = new GraphAsTask();
      graphAsTask.subGraph = graph;

      // Check schemas
      const inputSchema = graphAsTask.inputSchema();
      const outputSchema = graphAsTask.outputSchema();

      if (typeof inputSchema === "boolean" || typeof outputSchema === "boolean") {
        return;
      }

      // Only TaskA's inputs (TaskA is the only starting node)
      // TaskC is not a starting node because it has an incoming connection from TaskA
      expect(inputSchema.properties!["inputA1"]).toBeDefined();
      expect(inputSchema.properties!["inputA2"]).toBeDefined();
      expect(inputSchema.properties!["inputC2"]).toBeUndefined(); // TaskC is not a starting node

      // Both TaskB and TaskC outputs
      expect(outputSchema.properties!["outputB"]).toBeDefined();
      expect(outputSchema.properties!["outputC1"]).toBeDefined();
      expect(outputSchema.properties!["outputC2"]).toBeDefined();

      // Execute (no inputC2 needed since TaskC is not a starting node)
      const result = await graphAsTask.run({
        inputA1: "begin",
        inputA2: 5,
      });

      // When there are multiple ending nodes, the compoundMerge strategy
      // collects outputs into arrays for each property
      expect(result.outputB).toEqual(["processed-begin-5"]);
      expect(result.outputC1).toEqual(["begin-5+extra"]);
      expect(result.outputC2).toEqual([12]); // "begin-5" (7) + "extra" (5)
    });
  });

  describe("Merge Strategy", () => {
    it("should generate correct schema for PROPERTY_ARRAY strategy with single ending node", () => {
      // Create a graph with single ending node
      const taskA = new TaskA();
      const taskB = new TaskB();

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskB.config.id, "inputB"));

      const graphAsTask = new GraphAsTask({}, { compoundMerge: "PROPERTY_ARRAY" });
      graphAsTask.subGraph = graph;

      const outputSchema = graphAsTask.outputSchema();

      // Single ending node: properties should NOT be arrays
      if (typeof outputSchema === "boolean") {
        return;
      }
      expect(outputSchema.properties!["outputB"]).toBeDefined();
      expect((outputSchema.properties!["outputB"] as any).type).not.toBe("array");
    });

    it("should generate correct schema for PROPERTY_ARRAY strategy with multiple ending nodes", () => {
      // Create a graph with multiple ending nodes
      const taskA = new TaskA();
      const taskB = new TaskB();
      const taskC = new TaskC();

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);
      graph.addTask(taskC);

      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskB.config.id, "inputB"));
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskC.config.id, "inputC1"));

      const graphAsTask = new GraphAsTask({}, { compoundMerge: "PROPERTY_ARRAY" });
      graphAsTask.subGraph = graph;

      const outputSchema = graphAsTask.outputSchema();
      if (typeof outputSchema === "boolean") {
        return;
      }

      // Multiple ending nodes: all properties should be arrays (due to collectPropertyValues behavior)
      expect((outputSchema.properties!["outputB"] as any).type).toBe("array");
      expect((outputSchema.properties!["outputC1"] as any).type).toBe("array");
      expect((outputSchema.properties!["outputC2"] as any).type).toBe("array");
    });
  });

  describe("Last Level Output Schema", () => {
    it("should only include outputs from the last level (TaskA->TaskB->TaskC)", () => {
      // Create a linear chain: TaskA -> TaskB -> TaskC
      // Only TaskC should be in the output schema (deepest level)
      const taskA = new TaskA();
      const taskB = new TaskB();
      const taskC = new TaskC();

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);
      graph.addTask(taskC);

      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskB.config.id, "inputB"));
      graph.addDataflow(new Dataflow(taskB.config.id, "outputB", taskC.config.id, "inputC1"));

      const graphAsTask = new GraphAsTask();
      graphAsTask.subGraph = graph;

      const outputSchema = graphAsTask.outputSchema();
      if (typeof outputSchema === "boolean") {
        return;
      }

      // Only TaskC's outputs should be in the schema (it's at the deepest level)
      expect(outputSchema.properties!["outputC1"]).toBeDefined();
      expect(outputSchema.properties!["outputC2"]).toBeDefined();
      expect(outputSchema.properties!["outputA"]).toBeUndefined(); // TaskA is at level 0
      expect(outputSchema.properties!["outputB"]).toBeUndefined(); // TaskB is at level 1, not the last level
    });

    it("should only include outputs from nodes at maximum depth (mixed depth ending nodes)", () => {
      // Create a graph where:
      // TaskA -> TaskB -> TaskC (TaskC at depth 2)
      // TaskA -> TaskD (TaskD at depth 1)
      // Both TaskC and TaskD have no outgoing edges, but only TaskC should be in output
      const taskA = new TaskA();
      const taskB = new TaskB();
      const taskC = new TaskC();
      const taskD = new TaskC(); // Using TaskC class but treating it as a different task

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);
      graph.addTask(taskC);
      graph.addTask(taskD);

      // Create the connections
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskB.config.id, "inputB"));
      graph.addDataflow(new Dataflow(taskB.config.id, "outputB", taskC.config.id, "inputC1"));
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskD.config.id, "inputC1"));

      const graphAsTask = new GraphAsTask();
      graphAsTask.subGraph = graph;

      const outputSchema = graphAsTask.outputSchema();
      if (typeof outputSchema === "boolean") {
        return;
      }

      // Only TaskC should be in the schema (it's at depth 2, the maximum)
      // TaskD is at depth 1, so it should not be included
      expect(outputSchema.properties!["outputC1"]).toBeDefined();
      expect(outputSchema.properties!["outputC2"]).toBeDefined();

      // The output should NOT be arrays since there's only one node at the last level
      expect((outputSchema.properties!["outputC1"] as any).type).not.toBe("array");
      expect((outputSchema.properties!["outputC2"] as any).type).not.toBe("array");
    });

    it("should include multiple outputs when they are all at the same maximum depth", () => {
      // Create a graph where:
      // TaskA -> TaskB (depth 1)
      // TaskA -> TaskC (depth 1)
      // Both TaskB and TaskC are at the same maximum depth
      const taskA = new TaskA();
      const taskB = new TaskB();
      const taskC = new TaskC();

      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);
      graph.addTask(taskC);

      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskB.config.id, "inputB"));
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskC.config.id, "inputC1"));

      const graphAsTask = new GraphAsTask();
      graphAsTask.subGraph = graph;

      const outputSchema = graphAsTask.outputSchema();
      if (typeof outputSchema === "boolean") {
        return;
      }

      // Both TaskB and TaskC should be in the schema (both at depth 1, the maximum)
      expect(outputSchema.properties!["outputB"]).toBeDefined();
      expect(outputSchema.properties!["outputC1"]).toBeDefined();
      expect(outputSchema.properties!["outputC2"]).toBeDefined();

      // The outputs should be arrays since there are multiple nodes at the last level
      expect((outputSchema.properties!["outputB"] as any).type).toBe("array");
      expect((outputSchema.properties!["outputC1"] as any).type).toBe("array");
      expect((outputSchema.properties!["outputC2"] as any).type).toBe("array");
    });
  });

  describe("Dynamic Schemas", () => {
    it("should have hasDynamicSchemas set to true", () => {
      expect((GraphAsTask as any).hasDynamicSchemas).toBe(true);
    });

    it("should emit schemaChange event when emitSchemaChange is called", () => {
      const taskA = new TaskA();
      const taskB = new TaskB();
      const graph = new TaskGraph();
      graph.addTask(taskA);
      graph.addTask(taskB);
      graph.addDataflow(new Dataflow(taskA.config.id, "outputA", taskB.config.id, "inputB"));

      const graphAsTask = new GraphAsTask();
      graphAsTask.subGraph = graph;

      let schemaChangeEmitted = false;
      let receivedInputSchema: DataPortSchema | undefined;
      let receivedOutputSchema: DataPortSchema | undefined;

      (graphAsTask as any).on(
        "schemaChange",
        (inputSchema?: DataPortSchema, outputSchema?: DataPortSchema) => {
          schemaChangeEmitted = true;
          receivedInputSchema = inputSchema;
          receivedOutputSchema = outputSchema;
        }
      );

      // Call the protected method via type assertion
      (graphAsTask as any).emitSchemaChange();

      expect(schemaChangeEmitted).toBe(true);
      expect(receivedInputSchema).toBeDefined();
      expect(receivedOutputSchema).toBeDefined();
    });

    it("should emit schemaChange event with provided schemas", () => {
      const graphAsTask = new GraphAsTask();

      let receivedInputSchema: DataPortSchema | undefined;
      let receivedOutputSchema: DataPortSchema | undefined;

      (graphAsTask as any).on(
        "schemaChange",
        (inputSchema?: DataPortSchema, outputSchema?: DataPortSchema) => {
          receivedInputSchema = inputSchema;
          receivedOutputSchema = outputSchema;
        }
      );

      const customInputSchema: DataPortSchema = {
        type: "object",
        properties: { custom: { type: "string" } },
      };
      const customOutputSchema: DataPortSchema = {
        type: "object",
        properties: { customOut: { type: "string" } },
      };

      (graphAsTask as any).emitSchemaChange(customInputSchema, customOutputSchema);

      expect(receivedInputSchema).toEqual(customInputSchema);
      expect(receivedOutputSchema).toEqual(customOutputSchema);
    });

    it("should have different schemas for different subgraph structures", () => {
      const taskA1 = new TaskA();
      const graph1 = new TaskGraph();
      graph1.addTask(taskA1);

      const taskA2 = new TaskA();
      const taskB2 = new TaskB();
      const graph2 = new TaskGraph();
      graph2.addTask(taskA2);
      graph2.addTask(taskB2);
      graph2.addDataflow(new Dataflow(taskA2.config.id, "outputA", taskB2.config.id, "inputB"));

      const graphAsTask1 = new GraphAsTask();
      graphAsTask1.subGraph = graph1;

      const graphAsTask2 = new GraphAsTask();
      graphAsTask2.subGraph = graph2;

      const inputSchema1 = graphAsTask1.inputSchema();
      const inputSchema2 = graphAsTask2.inputSchema();

      // Both should have TaskA's inputs, but graph2 might have different structure
      expect(inputSchema1).toBeDefined();
      expect(inputSchema2).toBeDefined();
    });
  });

  describe("Reactive Execution Input Propagation", () => {
    /**
     * These tests verify that during reactive execution on PENDING tasks:
     * 1. Root tasks (no incoming dataflows) receive input from the parent GraphAsTask
     * 2. Non-root tasks receive input from upstream dataflows
     *
     * IMPORTANT: Reactive execution only updates PENDING tasks.
     * Once run() is called and tasks become COMPLETED, their outputs are locked.
     */

    it("should pass input to PENDING root tasks in subgraph during runReactive", async () => {
      // Create a subgraph with just an InputTask -> OutputTask
      const subGraph = new TaskGraph();
      const inputTask = new GraphAsTask_InputTask({}, { id: "input" });
      const outputTask = new GraphAsTask_OutputTask({}, { id: "output" });

      subGraph.addTask(inputTask);
      subGraph.addTask(outputTask);

      // Connect InputTask.value -> OutputTask.value
      subGraph.addDataflow(new Dataflow("input", "value", "output", "value"));

      const graphAsTask = new TestGraphAsTask_Value(
        { value: "initial" },
        { id: "group", subGraph }
      );

      // All tasks are PENDING - no run() called yet
      expect(inputTask.status).toBe("PENDING");
      expect(outputTask.status).toBe("PENDING");

      // Call runReactive on PENDING tasks - this should work
      const reactiveResult = await graphAsTask.runReactive({ value: "first" });

      // Check that the inner InputTask received the input (root task gets parent input)
      expect(inputTask.runInputData).toEqual({ value: "first" });

      // Check the final result propagated through the graph
      expect(reactiveResult.value).toBe("first");

      // Call runReactive again with different values - still PENDING
      const reactiveResult2 = await graphAsTask.runReactive({ value: "second" });
      expect(reactiveResult2.value).toBe("second");
      expect(inputTask.runInputData).toEqual({ value: "second" });
    });

    it("should propagate input through PENDING subgraph tasks", async () => {
      // Create a subgraph: InputTask -> ComputeTask
      const subGraph = new TaskGraph();
      const inputTask = new GraphAsTask_InputTask({}, { id: "input" });
      const computeTask = new GraphAsTask_ComputeTask({}, { id: "compute" });

      subGraph.addTask(inputTask);
      subGraph.addTask(computeTask);

      // Connect InputTask.a -> ComputeTask.a and InputTask.b -> ComputeTask.b
      subGraph.addDataflow(new Dataflow("input", "a", "compute", "a"));
      subGraph.addDataflow(new Dataflow("input", "b", "compute", "b"));

      const graphAsTask = new TestGraphAsTask_AB({ a: 5, b: 3 }, { id: "group", subGraph });

      // All tasks are PENDING
      expect(inputTask.status).toBe("PENDING");
      expect(computeTask.status).toBe("PENDING");

      // Run reactive on PENDING tasks
      const reactiveResult = await graphAsTask.runReactive({ a: 10, b: 7 });

      // Check that the root InputTask received the input
      expect(inputTask.runInputData).toEqual({ a: 10, b: 7 });

      // Check that ComputeTask received input from dataflow and computed correctly
      expect(computeTask.runInputData).toEqual({ a: 10, b: 7 });
      expect(reactiveResult.result).toBe(17); // 10 + 7 = 17

      // Run reactive again with different values
      const reactiveResult2 = await graphAsTask.runReactive({ a: 100, b: 1 });
      expect(reactiveResult2.result).toBe(101); // 100 + 1 = 101
    });

    it("should lock output after run() - COMPLETED tasks return cached output", async () => {
      // Create a subgraph: InputTask -> ComputeTask
      const subGraph = new TaskGraph();
      const inputTask = new GraphAsTask_InputTask({}, { id: "input" });
      const computeTask = new GraphAsTask_ComputeTask({}, { id: "compute" });

      subGraph.addTask(inputTask);
      subGraph.addTask(computeTask);

      subGraph.addDataflow(new Dataflow("input", "a", "compute", "a"));
      subGraph.addDataflow(new Dataflow("input", "b", "compute", "b"));

      const graphAsTask = new TestGraphAsTask_AB({ a: 5, b: 3 }, { id: "group", subGraph });

      // Run the graph - this locks all task outputs
      const runResult = await graphAsTask.run({ a: 5, b: 3 });
      expect(runResult.result).toBe(8); // 5 + 3 = 8

      // All tasks are now COMPLETED
      expect(inputTask.status).toBe("COMPLETED");
      expect(computeTask.status).toBe("COMPLETED");

      // Call runReactive on COMPLETED tasks - should return cached output
      // (COMPLETED tasks are immutable, their outputs don't change)
      const reactiveResult = await graphAsTask.runReactive({ a: 100, b: 200 });

      // The output should still be the original cached result
      // because COMPLETED tasks return their locked output
      expect(reactiveResult.result).toBe(8); // Still 8, not 300
    });
  });
});
