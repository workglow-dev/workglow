/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  hasVectorOutput,
  PROPERTY_ARRAY,
  Task,
  TaskConfig,
  TaskError,
  Workflow,
  WorkflowError,
} from "@workglow/task-graph";
import { ScalarAddTask, VectorSubtractTask, VectorSumTask } from "@workglow/tasks";
import { sleep } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NumberTask,
  NumberToStringTask,
  StringTask,
  TestInputTask,
  TestOutputTask,
  TestSimpleTask,
} from "../task/TestTasks";
// Import to register vector test tasks with the workflow system
import "../task/TestTasks";

const spyOn = vi.spyOn;

const colsoleError = globalThis.console.error;

describe("Workflow", () => {
  let workflow: Workflow;

  beforeEach(() => {
    workflow = new Workflow();
    globalThis.console.error = () => {};
  });

  afterEach(() => {
    workflow.reset();
    globalThis.console.error = colsoleError;
  });

  describe("constructor", () => {
    it("should create a new workflow instance", () => {
      expect(workflow).toBeInstanceOf(Workflow);
      expect(workflow.graph).toBeDefined();
      expect(workflow.error).toBe("");
    });

    it("should create a workflow with a repository", () => {
      expect(workflow).toBeInstanceOf(Workflow);
      // Repository is private, so we can't directly test it
    });
  });

  describe("createWorkflow", () => {
    it("should create a helper function for adding tasks", () => {
      const addTestTask = CreateWorkflow<{ input: string }, { output: string }>(TestSimpleTask);

      expect(addTestTask).toBeInstanceOf(Function);
    });

    it("should add a task to the workflow when called", () => {
      const addTestTask = Workflow.createWorkflow<{ input: string }, { output: string }>(
        TestSimpleTask
      );

      workflow = addTestTask.call(workflow, { input: "test" });
      expect(workflow.graph.getTasks()).toHaveLength(1);
      expect(workflow.graph.getTasks()[0]).toBeInstanceOf(TestSimpleTask);
    });

    it("should add a task to the workflow when using the prototype method", () => {
      workflow = workflow.testSimple({ input: "test" });
      expect(workflow.graph.getTasks()).toHaveLength(1);
      expect(workflow.graph.getTasks()[0]).toBeInstanceOf(TestSimpleTask);
    });

    it("should add a task and convert to GraphAsTask", () => {
      workflow = workflow.number({ input: 5 }).numberToString().testSimple({ input: "test" });
      const task = workflow.toTask();
      expect(task.subGraph.getTasks()).toHaveLength(3);
      expect(task.subGraph.getTasks()[0]).toBeInstanceOf(NumberTask);
      expect(task.subGraph.getTasks()[1]).toBeInstanceOf(NumberToStringTask);
      expect(task.subGraph.getTasks()[2]).toBeInstanceOf(TestSimpleTask);
      expect(task.inputSchema()).toEqual(NumberTask.inputSchema());
      expect(task.outputSchema()).toEqual(TestSimpleTask.outputSchema());
    });
  });

  describe("run", () => {
    it("should run the task graph and return output", async () => {
      workflow = workflow.testSimple({ input: "test" });

      const startSpy = spyOn(workflow.events, "emit");
      const result = await workflow.run();

      expect(startSpy).toHaveBeenCalledWith("start");
      expect(startSpy).toHaveBeenCalledWith("complete");
      expect(result).toEqual({ output: "processed-test" });
    });

    it("should run the task graph with provided input parameters", async () => {
      workflow = workflow.testSimple();

      const startSpy = spyOn(workflow.events, "emit");
      const result = await workflow.run({ input: "custom-input" });

      expect(startSpy).toHaveBeenCalledWith("start");
      expect(startSpy).toHaveBeenCalledWith("complete");
      expect(result).toEqual({ output: "processed-custom-input" });
    });

    it("should emit error event when task execution fails", async () => {
      workflow = workflow.failing();

      const errorSpy = spyOn(workflow.events, "emit");

      try {
        await workflow.run();
        expect(false).toBe(true); // should not get here
      } catch (error) {
        expect(error).toBeInstanceOf(TaskError);
        expect(errorSpy).toHaveBeenCalledWith("error", expect.any(String));
      }
    });
  });

  describe("abort", () => {
    it("should abort a running task graph", async () => {
      workflow = workflow.longRunning();

      const runPromise = workflow.run();
      await sleep(1);
      workflow.abort();

      await expect(runPromise).rejects.toThrow();
    });
  });

  describe("pop", () => {
    it("should remove the last task from the graph", () => {
      workflow = workflow.testSimple({ input: "test1" }).testSimple({ input: "test2" });

      expect(workflow.graph.getTasks()).toHaveLength(2);

      workflow.pop();

      expect(workflow.graph.getTasks()).toHaveLength(1);
      expect(workflow.graph.getTasks()[0].runInputData).toEqual({ input: "test1" });
    });

    it("should set error when trying to pop from empty graph", () => {
      workflow.pop();

      expect(workflow.error).toBe("No tasks to remove");
    });
  });

  describe("toJSON and toDependencyJSON", () => {
    it("should convert the task graph to JSON", () => {
      const addTestTask = Workflow.createWorkflow<
        { input: string },
        { output: string },
        TaskConfig
      >(TestSimpleTask);

      workflow = addTestTask.call(workflow, { input: "test" });

      const json = workflow.toJSON();

      expect(json).toHaveProperty("tasks");
      expect(json).toHaveProperty("dataflows");
      expect(json.tasks).toHaveLength(1);
    });

    it("should convert the task graph to dependency JSON", () => {
      const addTestTask = Workflow.createWorkflow<
        { input: string },
        { output: string },
        TaskConfig
      >(TestSimpleTask);

      workflow = addTestTask.call(workflow, { input: "test" });

      const json = workflow.toDependencyJSON();

      expect(Array.isArray(json)).toBe(true);
      expect(json).toHaveLength(1);
    });
  });

  describe("parallel", () => {
    it("should create a compound task with parallel workflows", async () => {
      workflow.parallel(
        [new TestSimpleTask({ input: "test1" }), new TestSimpleTask({ input: "test2" })],
        PROPERTY_ARRAY
      );

      expect(workflow.graph.getTasks()).toHaveLength(1);
      expect(workflow.graph.getTasks()[0]).toBeInstanceOf(Task);

      const compoundTask = workflow.graph.getTasks()[0];
      expect(compoundTask.subGraph?.getTasks()).toHaveLength(2);
      const result = await compoundTask.run();
      expect(result).toEqual({ output: ["processed-test1", "processed-test2"] });
    });
  });

  describe("rename", () => {
    it("should rename an output to a new target input", () => {
      const addOutputTask = Workflow.createWorkflow<
        { input: string },
        { customOutput: string },
        TaskConfig
      >(TestOutputTask);
      const addInputTask = Workflow.createWorkflow<
        { customInput: string },
        { output: string },
        TaskConfig
      >(TestInputTask);
      workflow = addOutputTask.call(workflow, { input: "test" });
      workflow.rename("customOutput", "customInput");
      workflow = addInputTask.call(workflow);

      const nodes = workflow.graph.getTasks();
      expect(nodes).toHaveLength(2);

      // Check that the dataflow was created correctly
      const dataflows = workflow.graph.getDataflows();
      expect(dataflows).toHaveLength(1);
      const dataflow = dataflows[0];
      expect(dataflow.sourceTaskId).toBe(nodes[0].config.id);
      expect(dataflow.sourceTaskPortId).toBe("customOutput");
      expect(dataflow.targetTaskId).toBe(nodes[1].config.id);
      expect(dataflow.targetTaskPortId).toBe("customInput");
    });

    it("should throw error when source output doesn't exist", () => {
      const addTestTask = Workflow.createWorkflow<
        { input: string },
        { output: string },
        TaskConfig
      >(TestSimpleTask);

      workflow = addTestTask.call(workflow, { input: "test" });

      expect(() => workflow.rename("nonExistentOutput", "customInput")).toThrow(WorkflowError);
      expect(workflow.error).toContain("Output nonExistentOutput not found");
    });
  });

  describe("reset", () => {
    it("should reset the workflow to its initial state", () => {
      const addTestTask = Workflow.createWorkflow<
        { input: string },
        { output: string },
        TaskConfig
      >(TestSimpleTask);

      workflow = addTestTask.call(workflow, { input: "test" });
      expect(workflow.graph.getTasks()).toHaveLength(1);

      const changedSpy = spyOn(workflow.events, "emit");
      workflow.reset();

      expect(workflow.graph.getTasks()).toHaveLength(0);
      expect(workflow.error).toBe("");
      expect(changedSpy).toHaveBeenCalledWith("changed", undefined);
      expect(changedSpy).toHaveBeenCalledWith("reset");
    });
  });

  describe("event handling", () => {
    it("should emit changed event when graph changes", () => {
      const changedHandler = spyOn(
        {
          handleEvent: () => {},
        },
        "handleEvent"
      );
      workflow.on("changed", changedHandler);

      const addTestTask = Workflow.createWorkflow<
        { input: string },
        { output: string },
        TaskConfig
      >(TestSimpleTask);
      workflow = addTestTask.call(workflow, { input: "test" });

      expect(changedHandler).toHaveBeenCalled();
    });

    it("should allow subscribing to events with on/off/once", () => {
      const handler = spyOn(
        {
          handleEvent: () => {},
        },
        "handleEvent"
      );

      workflow.on("reset", handler);
      workflow.reset();
      expect(handler).toHaveBeenCalledTimes(1);

      workflow.off("reset", handler);
      workflow.reset();
      expect(handler).toHaveBeenCalledTimes(1); // Still 1, not called again

      const onceHandler = spyOn(
        {
          handleEvent: () => {},
        },
        "handleEvent"
      );
      workflow.once("reset", onceHandler);
      workflow.reset();
      workflow.reset();
      expect(onceHandler).toHaveBeenCalledTimes(1); // Only called once
    });

    it("should allow waiting for events with emitted", async () => {
      const resetPromise = workflow.waitOn("reset");

      setTimeout(() => workflow.reset(), 10);

      await expect(resetPromise).resolves.toEqual([]);
    });
  });

  describe("auto-connection behavior", () => {
    it("should auto-connect tasks with matching input/output types and ids", () => {
      const addTestTask1 = Workflow.createWorkflow<
        { input: string },
        { output: string },
        TaskConfig
      >(TestSimpleTask);
      const addTestTask2 = Workflow.createWorkflow<
        { input: string },
        { output: string },
        TaskConfig
      >(TestSimpleTask);
      workflow = addTestTask1.call(workflow, { input: "test" });
      workflow = addTestTask2.call(workflow);

      const edges = workflow.graph.getDataflows();
      expect(edges).toHaveLength(1);
      expect(edges[0].sourceTaskPortId).toBe("output");
      expect(edges[0].targetTaskPortId).toBe("input");
    });

    it("should not auto-connect when types don't match", () => {
      const addStringTask = Workflow.createWorkflow<
        { input: string },
        { output: string },
        TaskConfig
      >(StringTask);
      const addNumberTask = Workflow.createWorkflow<
        { input: number },
        { output: number },
        TaskConfig
      >(NumberTask);
      workflow = addStringTask.call(workflow, { input: "test" });

      // This should set an error because types don't match
      workflow = addNumberTask.call(workflow);

      expect(workflow.error).toContain("Could not find a match");
      expect(workflow.graph.getTasks()).toHaveLength(1); // Second task not added
    });

    it("should auto-connect TypedArray ports with different names by format", () => {
      // VectorOutputTask outputs 'vector', VectorsInputTask expects 'vectors'
      // They should match because both have format: "TypedArray"
      workflow = workflow.vectorOutput({ text: "test" }).vectorsInput();

      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(2);

      const edges = workflow.graph.getDataflows();
      expect(edges).toHaveLength(1);
      expect(edges[0].sourceTaskPortId).toBe("vector");
      expect(edges[0].targetTaskPortId).toBe("vectors");
    });

    it("should auto-connect TypedArray with oneOf wrapper to anyOf input", () => {
      // VectorOneOfOutputTask outputs 'embedding' (oneOf wrapped TypedArray)
      // VectorAnyOfInputTask expects 'data' (anyOf wrapped TypedArray)
      // They should match because both contain format: "TypedArray" inside the wrappers
      workflow = workflow.vectorOneOfOutput({ text: "test" }).vectorAnyOfInput();

      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(2);

      const edges = workflow.graph.getDataflows();
      expect(edges).toHaveLength(1);
      expect(edges[0].sourceTaskPortId).toBe("embedding");
      expect(edges[0].targetTaskPortId).toBe("data");
    });

    it("should not match primitive types (string) with different port names", () => {
      // StringTask outputs 'output', TestInputTask expects 'customInput'
      // These should NOT match because strings are primitive types
      // and we only do type-only matching for specific types (like TypedArray)
      workflow = workflow.string({ input: "test" });
      workflow = workflow.testInput();

      expect(workflow.error).toContain("Could not find a match");
      expect(workflow.graph.getTasks()).toHaveLength(1);
    });
  });

  describe("multi-source input matching", () => {
    it("should match required inputs from multiple earlier tasks (grandparent + parent)", () => {
      // TextOutputTask outputs { text }
      // VectorOutputOnlyTask outputs { vector }
      // TextVectorInputTask requires both { text, vector }
      // Should successfully connect text from grandparent and vector from parent
      workflow = workflow
        .textOutput({ input: "hello" })
        .vectorOutputOnly({ size: 5 })
        .textVectorInput();

      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(3);

      const dataflows = workflow.graph.getDataflows();
      expect(dataflows).toHaveLength(2);

      const nodes = workflow.graph.getTasks();

      // Check connections - text should come from first task (TextOutputTask)
      const textConnection = dataflows.find(
        (df) => df.targetTaskId === nodes[2].config.id && df.targetTaskPortId === "text"
      );
      expect(textConnection).toBeDefined();
      expect(textConnection?.sourceTaskId).toBe(nodes[0].config.id);
      expect(textConnection?.sourceTaskPortId).toBe("text");

      // Check connections - vector should come from second task (VectorOutputOnlyTask)
      const vectorConnection = dataflows.find(
        (df) => df.targetTaskId === nodes[2].config.id && df.targetTaskPortId === "vector"
      );
      expect(vectorConnection).toBeDefined();
      expect(vectorConnection?.sourceTaskId).toBe(nodes[1].config.id);
      expect(vectorConnection?.sourceTaskPortId).toBe("vector");
    });

    it("should fail when required inputs cannot be satisfied by any previous task", () => {
      // VectorOutputOnlyTask only outputs { vector }
      // TextVectorInputTask requires both { text, vector }
      // Should fail because no previous task provides text
      workflow = workflow.vectorOutputOnly({ size: 3 }).textVectorInput();

      expect(workflow.error).toContain("Could not find matches for required inputs");
      expect(workflow.error).toContain("text");
      expect(workflow.graph.getTasks()).toHaveLength(1); // Second task not added
    });

    it("should match required inputs looking back multiple tasks (2+ hops)", () => {
      // TextOutputTask outputs { text }
      // VectorOutputOnlyTask outputs { vector }
      // PassthroughVectorTask outputs { vector } (passes through)
      // TextVectorInputTask requires both { text, vector }
      // Should connect text from 2 tasks back and vector from parent
      workflow = workflow
        .textOutput({ input: "test" })
        .vectorOutputOnly({ size: 4 })
        .passthroughVector()
        .textVectorInput();

      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(4);

      const dataflows = workflow.graph.getDataflows();
      const nodes = workflow.graph.getTasks();

      // Should have connections:
      // 1. vector: VectorOutputOnlyTask -> PassthroughVectorTask
      // 2. vector: PassthroughVectorTask -> TextVectorInputTask
      // 3. text: TextOutputTask -> TextVectorInputTask
      expect(dataflows.length).toBeGreaterThanOrEqual(3);

      // Verify the text connection comes from the first task (looking back 2 tasks)
      const textConnection = dataflows.find(
        (df) => df.targetTaskId === nodes[3].config.id && df.targetTaskPortId === "text"
      );
      expect(textConnection).toBeDefined();
      expect(textConnection?.sourceTaskId).toBe(nodes[0].config.id);
      expect(textConnection?.sourceTaskPortId).toBe("text");

      // Verify the vector connection comes from the passthrough task (parent)
      const vectorConnection = dataflows.find(
        (df) => df.targetTaskId === nodes[3].config.id && df.targetTaskPortId === "vector"
      );
      expect(vectorConnection).toBeDefined();
      expect(vectorConnection?.sourceTaskId).toBe(nodes[2].config.id);
    });

    it("should handle partial match where parent provides some required inputs", () => {
      // Test that we successfully find text from earlier when parent only provides vector

      // TextOutputTask outputs { text }
      // PassthroughVectorTask just to add another task in between
      // VectorOutputOnlyTask outputs { vector }
      // TextVectorInputTask requires both { text, vector }
      workflow = workflow
        .textOutput({ input: "partial" })
        .vectorOutputOnly({ size: 3 }) // First vectorOutputOnly
        .passthroughVector() // Passes vector through (doesn't provide text)
        .vectorOutputOnly({ size: 2 }) // Second vectorOutputOnly (overwrites parent's vector)
        .textVectorInput();

      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(5);

      const dataflows = workflow.graph.getDataflows();
      const nodes = workflow.graph.getTasks();

      // Verify text comes from the first task (4 tasks back)
      const textConnection = dataflows.find(
        (df) => df.targetTaskId === nodes[4].config.id && df.targetTaskPortId === "text"
      );
      expect(textConnection).toBeDefined();
      expect(textConnection?.sourceTaskId).toBe(nodes[0].config.id);

      // Verify vector comes from the parent (last vectorOutputOnly)
      const vectorConnection = dataflows.find(
        (df) => df.targetTaskId === nodes[4].config.id && df.targetTaskPortId === "vector"
      );
      expect(vectorConnection).toBeDefined();
      expect(vectorConnection?.sourceTaskId).toBe(nodes[3].config.id);
    });

    it("should successfully match when all required inputs come from parent", () => {
      // Special case: if parent already provides all required inputs,
      // we shouldn't need to look back (standard auto-connection)

      // TestSimpleTask outputs { output: string }
      // Another TestSimpleTask requires { input: string }
      // Should auto-match because "output" -> "input" is a special case
      workflow = workflow.testSimple({ input: "test" }).testSimple();

      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(2);

      const dataflows = workflow.graph.getDataflows();
      const nodes = workflow.graph.getTasks();

      // Verify connection from parent only (not looking back)
      expect(dataflows).toHaveLength(1);
      const connection = dataflows[0];
      expect(connection.sourceTaskId).toBe(nodes[0].config.id);
      expect(connection.targetTaskId).toBe(nodes[1].config.id);
      expect(connection.sourceTaskPortId).toBe("output");
      expect(connection.targetTaskPortId).toBe("input");
    });

    it("should NOT match when types are incompatible even when looking back", () => {
      // TestSimpleTask outputs { output: string }
      // TestSimpleTask outputs { output: string }
      // TestSimpleTask outputs { output: string }
      // TextVectorInputTask requires { text: string, vector: Float32Array }
      // Should fail because:
      // - All tasks provide string, but port name is "output" not "text" or "vector"
      // - None provide Float32Array
      // - Primitive type string with name "output" won't match different names "text" or "vector"
      workflow = workflow
        .testSimple({ input: "first" })
        .testSimple({ input: "second" })
        .testSimple({ input: "third" })
        .textVectorInput();

      expect(workflow.error).toContain("Could not find matches for required inputs");
      // Should fail because no task provides the required ports
      expect(workflow.graph.getTasks()).toHaveLength(3); // Fourth task not added
    });

    it("should NOT connect optional (non-required) inputs from earlier tasks", () => {
      // TestInputTask has { customInput: string } but it's NOT in the required array
      // TestSimpleTask provides { output: string }
      // TestOutputTask provides { customOutput: string }
      // Should fail because backward matching only considers required inputs,
      // and customInput is optional (not required)
      workflow = workflow.testSimple({ input: "test" }).testSimple({ input: "middle" }).testInput();

      // Should fail because customInput doesn't match "output" (different names, primitive type)
      expect(workflow.error).toContain("Could not find a match");
      expect(workflow.graph.getTasks()).toHaveLength(2);
    });

    it("should NOT match primitive string ports with different names", () => {
      // TestSimpleTask outputs { output: string }
      // TestSimpleTask outputs { output: string }
      // TestInputTask requires { customInput: string }
      // Primitive types only match if names are the same or output->input special case
      // "output" vs "customInput" are different names, so won't match
      workflow = workflow
        .testSimple({ input: "first" })
        .testSimple({ input: "second" })
        .testInput();

      expect(workflow.error).toContain("Could not find a match");
      expect(workflow.graph.getTasks()).toHaveLength(2);
    });

    it("should allow first task with required inputs if no parent exists", () => {
      // When adding a task as the first task in workflow, it's allowed
      // even if it has required inputs (they can be provided at runtime)
      // TextVectorInputTask has required inputs [text, vector]
      workflow = workflow.textVectorInput();

      // Should succeed - no parent means no auto-connection check
      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(1);

      // But dataflows should be empty (no connections)
      expect(workflow.graph.getDataflows()).toHaveLength(0);
    });

    it("should NOT require connections for required inputs that are provided as parameters", () => {
      // TextVectorInputTask has required inputs [text, vector]
      // But if we provide them as parameters, they don't need connections
      workflow = workflow.testSimple({ input: "test" }).textVectorInput({
        text: "provided text",
        vector: new Float32Array([1, 2, 3]),
      });

      // Should succeed - required inputs are provided as parameters
      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(2);

      // No connections should be made since inputs are provided directly
      expect(workflow.graph.getDataflows()).toHaveLength(0);
    });

    it("should only look for connections for required inputs NOT provided as parameters", () => {
      // TextVectorInputTask has required inputs [text, vector]
      // Provide text as parameter, but not vector
      // Should look back only for vector connection
      workflow = workflow
        .testSimple({ input: "test" })
        .vectorOutputOnly({ size: 3 })
        .textVectorInput({
          text: "provided text",
          // vector is NOT provided, should be connected from parent
        });

      // Should succeed - text is provided, vector is connected from parent
      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(3);

      const dataflows = workflow.graph.getDataflows();
      const nodes = workflow.graph.getTasks();

      // Should have 1 connection: vector from VectorOutputOnlyTask
      expect(dataflows.length).toBeGreaterThanOrEqual(1);

      const vectorConnection = dataflows.find(
        (df) => df.targetTaskId === nodes[2].config.id && df.targetTaskPortId === "vector"
      );
      expect(vectorConnection).toBeDefined();
      expect(vectorConnection?.sourceTaskId).toBe(nodes[1].config.id);

      // No connection for text (it was provided as parameter)
      const textConnection = dataflows.find(
        (df) => df.targetTaskId === nodes[2].config.id && df.targetTaskPortId === "text"
      );
      expect(textConnection).toBeUndefined();
    });

    it("should NOT match when no earlier task provides the required type", () => {
      // TestSimpleTask outputs { output: string }
      // TestSimpleTask outputs { output: string }
      // TextVectorInputTask requires { text: string, vector: Float32Array }
      // Should fail because no task provides Float32Array
      workflow = workflow
        .testSimple({ input: "test" })
        .testSimple({ input: "hello" })
        .textVectorInput();

      expect(workflow.error).toContain("Could not find matches for required inputs");
      expect(workflow.error).toContain("vector"); // Missing vector type
      expect(workflow.graph.getTasks()).toHaveLength(2);
    });
  });

  describe("adaptive methods", () => {
    it("should dispatch add() to scalar variant when previous task outputs number", () => {
      workflow = workflow.scalarAdd({ a: 1, b: 2 }).add({ a: 3, b: 4 });

      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(2);
      expect(workflow.graph.getTasks()[0]).toBeInstanceOf(ScalarAddTask);
      expect(workflow.graph.getTasks()[1]).toBeInstanceOf(ScalarAddTask);
    });

    it("should dispatch add() to vector variant when previous task outputs TypedArray", () => {
      workflow = workflow
        .vectorOutputOnly({ size: 2 })
        .add({ vectors: [new Float32Array([1, 2]), new Float32Array([3, 4])] });

      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(2);
      expect(workflow.graph.getTasks()[1]).toBeInstanceOf(VectorSumTask);
    });

    it("should default to scalar variant when add() is first task in chain", () => {
      workflow = workflow.add({ a: 1, b: 2 });

      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(1);
      expect(workflow.graph.getTasks()[0]).toBeInstanceOf(ScalarAddTask);
    });

    it("should chain scalar then adaptive subtract (scalar path)", () => {
      workflow = workflow.scalarAdd({ a: 1, b: 2 }).subtract({ a: 10, b: 1 });

      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(2);
      expect(workflow.graph.getTasks()[1]).not.toBeInstanceOf(VectorSubtractTask);
      expect(workflow.graph.getTasks()[1].type).toBe("ScalarSubtractTask");
    });

    it("should chain vector then adaptive subtract (vector path)", () => {
      workflow = workflow
        .vectorOutputOnly({ size: 2 })
        .subtract({ vectors: [new Float32Array([5, 5]), new Float32Array([1, 2])] });

      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(2);
      expect(workflow.graph.getTasks()[1]).toBeInstanceOf(VectorSubtractTask);
    });

    it("should run scalar add chain and return correct result", async () => {
      workflow = workflow.scalarAdd({ a: 1, b: 2 }).add({ a: 3, b: 4 });

      const result = await workflow.run();

      // PROPERTY_ARRAY merges: first task result 3, second task result 7
      expect(result).toEqual({ result: [3, 7] });
      const resultArr = (result as { result?: number[] }).result!;
      expect(resultArr[resultArr.length - 1]).toBe(7);
    });

    it("should run sum() as first task and return sum of values", async () => {
      workflow = workflow.sum({ values: [1, 2, 3, 4] });

      const result = await workflow.run();

      // Single task: merge returns output as-is, so result.result is the number
      expect((result as { result: number }).result).toBe(10);
    });

    it("should run multiply() as first task and return product", async () => {
      workflow = workflow.multiply({ a: 3, b: 7 });

      const result = await workflow.run();

      expect((result as { result: number }).result).toBe(21);
    });

    it("should run divide() as first task and return quotient", async () => {
      workflow = workflow.divide({ a: 20, b: 4 });

      const result = await workflow.run();

      expect((result as { result: number }).result).toBe(5);
    });

    it("should run subtract() as first task and return difference", async () => {
      workflow = workflow.subtract({ a: 10, b: 3 });

      const result = await workflow.run();

      expect((result as { result: number }).result).toBe(7);
    });

    it("should run chained add then multiply and return correct result", async () => {
      workflow = workflow.add({ a: 1, b: 2 }).multiply({ a: 3, b: 1 }); // 3 then 3*1=3

      const result = await workflow.run();

      const resultArr = (result as { result?: number[] }).result!;
      expect(resultArr).toEqual([3, 3]);
      expect(resultArr[resultArr.length - 1]).toBe(3);
    });

    it("should run chained sum then subtract and return correct result", async () => {
      workflow = workflow.sum({ values: [5, 5] }).subtract({ a: 20, b: 5 }); // 10 then 20-5=15

      const result = await workflow.run();

      const resultArr = (result as { result?: number[] }).result!;
      expect(resultArr).toEqual([10, 15]);
    });

    it("should run vector sum() and return component-wise sum", async () => {
      // First task outputs vector so sum() picks vector variant (VectorSumTask)
      workflow = workflow
        .vectorOutputOnly({ size: 3 }) // [1,1,1]
        .sum({
          vectors: [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])],
        });

      const result = await workflow.run();

      // Linear chain: single leaf output. Parent vector [1,1,1] is auto-connected, so we sum
      // [1,1,1] + [1,2,3] + [4,5,6] = [6, 8, 10]
      const vec = (result as { result: Float32Array }).result;
      expect(Array.from(vec)).toEqual([6, 8, 10]);
    });

    it("should run vector chain: vectorOutputOnly then sum() and return result", async () => {
      // VectorOutputOnlyTask(size: 2) outputs vector [1, 1]. sum() picks vector variant and
      // receives that single vector (auto-connected to "vectors"); sum of one vector is that vector.
      workflow = workflow.vectorOutputOnly({ size: 2 }).sum();

      const result = await workflow.run();

      // Linear chain: single leaf output
      const vec = (result as { result: Float32Array }).result;
      expect(Array.from(vec)).toEqual([1, 1]);
    });

    it("should choose vector variant when sum(vectors: [...]) is called with no previous task", () => {
      workflow = workflow.sum({ vectors: [new Float32Array([1, 2, 3])] });

      expect(workflow.error).toBe("");
      expect(workflow.graph.getTasks()).toHaveLength(1);
      expect(workflow.graph.getTasks()[0]).toBeInstanceOf(VectorSumTask);
    });

    it("should run sum(vectors: [...]) as first task and return the vector", async () => {
      workflow = workflow.sum({ vectors: [new Float32Array([1, 2, 3])] });

      const result = await workflow.run();

      const vec = (result as { result: Float32Array }).result;
      expect(Array.from(vec)).toEqual([1, 2, 3]);
    });

    it("should detect TypedArray output in hasVectorOutput for plain format", () => {
      workflow = workflow.vectorOutputOnly({ size: 2 });
      const lastTask = workflow.graph.getTasks()[workflow.graph.getTasks().length - 1]!;

      expect(hasVectorOutput(lastTask)).toBe(true);
    });

    it("should detect TypedArray inside oneOf in hasVectorOutput", () => {
      workflow = workflow.vectorOneOfOutput({ text: "test" });
      const lastTask = workflow.graph.getTasks()[workflow.graph.getTasks().length - 1]!;

      expect(hasVectorOutput(lastTask)).toBe(true);
    });

    it("should return false from hasVectorOutput for scalar output", () => {
      workflow = workflow.scalarAdd({ a: 1, b: 2 });
      const lastTask = workflow.graph.getTasks()[workflow.graph.getTasks().length - 1]!;

      expect(hasVectorOutput(lastTask)).toBe(false);
    });
  });

  describe("static methods", () => {
    it("should create a workflow using static methods", () => {
      // @ts-ignore
      const workflow = Workflow.pipe(new TestSimpleTask(), new TestSimpleTask());
      expect(workflow).toBeInstanceOf(Workflow);
    });

    it("should create a workflow using static methods", () => {
      const workflow = Workflow.parallel([new TestSimpleTask(), new TestSimpleTask()]);
      expect(workflow).toBeInstanceOf(Workflow);
    });
  });
});
