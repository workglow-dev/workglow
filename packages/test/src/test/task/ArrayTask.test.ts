/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dataflow,
  IExecuteContext,
  ITask,
  JobQueueTask,
  PROPERTY_ARRAY,
  TaskConfig,
  TaskGraph,
  TaskInput,
  TaskOutput,
  TaskStatus,
} from "@workglow/task-graph";
import { ArrayTask } from "@workglow/tasks";
import { ConvertAllToOptionalArray, DataPortSchema } from "@workglow/util";
import { describe, expect, test, vi } from "vitest";

const spyOn = vi.spyOn;

// Define our input and output types
interface MultiplyInput extends TaskInput {
  a: number;
  b: number;
}

interface MultiplyOutput extends TaskOutput {
  result: number;
}

/**
 * Create a task that multiplies two numbers
 * This is a direct subclass of ArrayTask
 */
class MultiplyRunTask extends ArrayTask<
  ConvertAllToOptionalArray<MultiplyInput>,
  ConvertAllToOptionalArray<MultiplyOutput>,
  TaskConfig
> {
  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: {
          oneOf: [
            { type: "number", default: 0 },
            { type: "array", items: { type: "number", default: 0 } },
          ],
          "x-replicate": true,
        },
        b: {
          oneOf: [
            { type: "number", default: 0 },
            { type: "array", items: { type: "number", default: 0 } },
          ],
          "x-replicate": true,
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: {
          oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public async execute(input: MultiplyInput, context: IExecuteContext): Promise<MultiplyOutput> {
    // Simple multiplication - at this point, we know the inputs are not arrays
    return {
      result: input.a * input.b,
    };
  }
}
/**
 * Create a task that multiplies two numbers
 * This is a direct subclass of ArrayTask
 */
class MultiplyRunReactiveTask extends ArrayTask<
  ConvertAllToOptionalArray<MultiplyInput>,
  ConvertAllToOptionalArray<MultiplyOutput>
> {
  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: {
          oneOf: [
            { type: "number", default: 0 },
            { type: "array", items: { type: "number", default: 0 } },
          ],
          "x-replicate": true,
        },
        b: {
          oneOf: [
            { type: "number", default: 0 },
            { type: "array", items: { type: "number", default: 0 } },
          ],
          "x-replicate": true,
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: {
          oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public async executeReactive(
    input: MultiplyInput,
    output: MultiplyOutput
  ): Promise<MultiplyOutput> {
    return {
      result: input.a * input.b,
    };
  }
}

interface SquareInput extends TaskInput {
  a: number;
}
interface SquareOutput extends TaskOutput {
  result: number;
}

class SquareRunTask extends ArrayTask<
  ConvertAllToOptionalArray<SquareInput>,
  ConvertAllToOptionalArray<SquareOutput>
> {
  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: {
          oneOf: [
            { type: "number", default: 0 },
            { type: "array", items: { type: "number", default: 0 } },
          ],
          "x-replicate": true,
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: {
          oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public async execute(input: SquareInput, context: IExecuteContext): Promise<SquareOutput> {
    return {
      result: input.a * input.a,
    };
  }
}

class SquareRunReactiveTask extends ArrayTask<
  ConvertAllToOptionalArray<SquareInput>,
  ConvertAllToOptionalArray<SquareOutput>
> {
  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        a: {
          oneOf: [
            { type: "number", default: 0 },
            { type: "array", items: { type: "number", default: 0 } },
          ],
          "x-replicate": true,
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: {
          oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public async executeReactive(input: SquareInput, output: SquareOutput): Promise<SquareOutput> {
    return {
      result: input.a * input.a,
    };
  }
}

interface JobQueueTestInput extends TaskInput {
  value: number;
}

interface JobQueueTestOutput extends TaskOutput {
  result: number;
}

class JobQueueReactiveTask extends JobQueueTask<
  ConvertAllToOptionalArray<JobQueueTestInput>,
  ConvertAllToOptionalArray<JobQueueTestOutput>
> {
  public static type = "JobQueueReactiveTask";

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: {
          oneOf: [
            { type: "number", default: 0 },
            { type: "array", items: { type: "number", default: 0 } },
          ],
          "x-replicate": true,
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: {
          oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public async executeReactive(
    input: JobQueueTestInput,
    output: JobQueueTestOutput
  ): Promise<JobQueueTestOutput> {
    // Simple reactive computation: double the value
    return {
      result: input.value * 2,
    };
  }
}

class JobQueueReactiveTask2 extends JobQueueTask<JobQueueTestInput, JobQueueTestOutput> {
  public static type = "JobQueueReactiveTask2";

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: {
          type: "number",
          format: "int32",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: {
          type: "number",
          format: "int32",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public async executeReactive(
    input: JobQueueTestInput,
    output: JobQueueTestOutput
  ): Promise<JobQueueTestOutput> {
    // Simple reactive computation: double the value
    return {
      result: input.value * 2,
    };
  }
}

interface QueryTestInput extends TaskInput {
  query: string;
  val: number;
}

interface QueryTestOutput extends TaskOutput {
  result: string;
  val: number;
}

/**
 * Create a task that appends "-output" to a query string
 * Has one replicated input (query) and one normal input (val)
 */
class QueryAppendTask extends ArrayTask<
  ConvertAllToOptionalArray<QueryTestInput>,
  ConvertAllToOptionalArray<QueryTestOutput>,
  TaskConfig
> {
  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        query: {
          oneOf: [
            { type: "string", default: "" },
            { type: "array", items: { type: "string", default: "" } },
          ],
          "x-replicate": true,
        },
        val: {
          type: "number",
          default: 0,
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: {
          oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        },
        val: {
          type: "number",
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public async execute(input: QueryTestInput): Promise<QueryTestOutput> {
    return {
      result: `${input.query}-output`,
      val: input.val,
    };
  }

  public async executeReactive(
    input: QueryTestInput,
    output: QueryTestOutput
  ): Promise<QueryTestOutput> {
    return {
      result: `${output.result ?? input.query}-reactive`,
      val: input.val,
    };
  }

  /**
   * Override merge to keep non-replicated properties (val) as single values
   */
  public executeMerge(input: QueryTestInput, output: QueryTestOutput): QueryTestOutput {
    output.val = input.val;
    return output;
  }
}

describe("ArrayTask", () => {
  test("MultiplyRunTask in task mode run plain", async () => {
    const task = new MultiplyRunTask({
      a: 4,
      b: 5,
    });
    // @ts-expect-error - we are testing the protected method
    // For plain tasks (not array mode), executeTaskChildren should not be called
    const executeTaskChildrenSpy = spyOn(task.runner, "executeTaskChildren");
    const results = await task.run();
    expect(results).toEqual({ result: 20 });
    expect(executeTaskChildrenSpy).not.toHaveBeenCalled();
  });

  test("MultiplyRunTask in task mode run array", async () => {
    const task = new MultiplyRunTask({
      a: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      b: 1,
    });
    const results = await task.run();
    expect(results).toEqual({ result: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  });

  test("MultiplyRunTask in task mode run array x array", async () => {
    const task = new MultiplyRunTask({
      a: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      b: [1, 2],
    });
    const results = await task.run();
    expect(results).toEqual({
      result: [0, 0, 1, 2, 2, 4, 3, 6, 4, 8, 5, 10, 6, 12, 7, 14, 8, 16, 9, 18, 10, 20],
    });
  });

  test("MultiplyRunTask in task mode reactive run", async () => {
    const task = new MultiplyRunTask(
      {
        a: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        b: 10,
      },
      {
        id: "test",
      }
    );
    {
      // const results = await task.runReactive();
      // expect(results).toEqual({} as any);
    }
    {
      await task.run();
      const results = await task.runReactive();
      expect(results).toEqual({ result: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] });
    }
  });

  test("MultiplyRunReactiveTask in task mode reactive run", async () => {
    const task = new MultiplyRunReactiveTask({
      a: 2,
      b: 10,
    });
    const results = await task.runReactive();
    expect(results).toEqual({ result: 20 });
  });

  test("MultiplyRunReactiveTask in task mode reactive runReactive", async () => {
    const task = new MultiplyRunReactiveTask({
      a: 2,
      b: 10,
    });
    const results = await task.runReactive();
    expect(results).toEqual({ result: 20 });
  });

  test("MultiplyRunReactiveTask in task mode reactive runReactive array", async () => {
    const task = new MultiplyRunReactiveTask({
      a: [2],
      b: [10],
    });
    const results = await task.runReactive();
    expect(results).toEqual({ result: 20 });
  });

  test("MultiplyRunReactiveTask in task mode reactive runReactive", async () => {
    const task = new MultiplyRunReactiveTask({
      a: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      b: 10,
    });
    const results = await task.runReactive();
    expect(results).toEqual({ result: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] });
  });

  test("SquareRunTask in task mode run with single", async () => {
    const task = new SquareRunTask({ a: 5 });
    await task.run();
    const results = await task.runReactive();
    expect(results).toEqual({ result: 25 });
  });

  test("SquareRunTask in task mode reactive run with single", async () => {
    const task = new SquareRunTask({ a: 5 });
    const results = await task.runReactive();
    expect(results).toEqual({} as SquareOutput);
  });

  test("SquareRunReactiveTask in task mode run with single", async () => {
    const task = new SquareRunReactiveTask({ a: 5 });
    await task.run();
    const results = await task.runReactive();
    expect(results).toEqual({ result: 25 });
  });

  test("SquareRunReactiveTask in task mode reactive run with single", async () => {
    const task = new SquareRunReactiveTask({ a: 5 });
    const results = await task.runReactive();
    expect(results).toEqual({ result: 25 } as SquareOutput);
  });

  test("ArrayTask runReactive calls executeReactive in single task mode (no children)", async () => {
    // Create a task with non-array input - this puts it in single task mode (no subtasks)
    const task = new SquareRunReactiveTask({ a: 7 });

    // Verify it has no children (single task mode)
    expect(task.hasChildren()).toBe(false);

    // Spy on executeReactive to verify it's called
    const executeReactiveSpy = spyOn(task, "executeReactive");

    // Call runReactive without calling run() first
    const results = await task.runReactive();

    // Verify executeReactive was actually called
    expect(executeReactiveSpy).toHaveBeenCalledTimes(1);
    expect(executeReactiveSpy).toHaveBeenCalledWith(
      { a: 7 },
      {},
      expect.objectContaining({ own: expect.any(Function) })
    );

    // Verify the result is correct (executeReactive should have computed it)
    expect(results).toEqual({ result: 49 }); // 7 * 7 = 49
  });

  test("ArrayTask runReactive works in single task mode without prior run() call", async () => {
    // This test ensures runReactive works even when run() hasn't been called first
    const task = new MultiplyRunReactiveTask({
      a: 3,
      b: 4,
    });

    // Verify single task mode
    expect(task.hasChildren()).toBe(false);

    // Call runReactive without calling run() first
    const results = await task.runReactive();

    // Should compute the result using executeReactive
    expect(results).toEqual({ result: 12 }); // 3 * 4 = 12
    expect(task.runOutputData).toEqual({ result: 12 });
  });

  test("in task mode non-reactive run", async () => {
    const task = new SquareRunTask({
      a: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    const results = await task.run();
    expect(results).toEqual({ result: [0, 1, 4, 9, 16, 25, 36, 49, 64, 81, 100] });
  });

  test("in task mode non-reactive runReactive", async () => {
    const task = new SquareRunReactiveTask({
      a: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    const results = await task.runReactive();
    expect(results).toEqual({ result: [0, 1, 4, 9, 16, 25, 36, 49, 64, 81, 100] });
  });

  test("in task graph mode", async () => {
    const graph = new TaskGraph();
    graph.addTask(
      new MultiplyRunTask({
        a: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        b: 11,
      })
    );
    const results = await graph.run<MultiplyOutput>();
    const cleanResults = graph.mergeExecuteOutputsToRunOutput<
      MultiplyOutput,
      typeof PROPERTY_ARRAY
    >(results, PROPERTY_ARRAY);
    expect(cleanResults.result).toEqual([0, 11, 22, 33, 44, 55, 66, 77, 88, 99, 110]);
  });

  test("emits events correctly", async () => {
    // Create a task with a smaller array for testing events
    const task = new SquareRunTask({
      a: [1, 2, 3],
    });

    // Create event tracking variables
    const events: Record<string, number> = {
      start: 0,
      progress: 0,
      complete: 0,
    };

    // Set up event listeners
    task.on("start", () => {
      events.start++;
      expect(task.status).toBe(TaskStatus.PROCESSING);
    });

    task.on("progress", (progress: number) => {
      events.progress++;
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    });

    task.on("complete", () => {
      events.complete++;
      expect(task.status).toBe(TaskStatus.COMPLETED);
      expect(task.completedAt).toBeDefined();
    });

    // Manually trigger a progress event before running the task
    // @ts-expect-error - we are testing the protected method
    task.runner.handleStart();
    // @ts-expect-error - we are testing the protected method
    task.runner.handleProgress(0.5);

    // Run the task
    const results = await task.run();

    // Verify events were emitted
    expect(events.start).toBeGreaterThanOrEqual(1);
    expect(events.progress).toBeGreaterThanOrEqual(1);
    expect(events.complete).toBe(1);

    // Verify the task completed successfully
    expect(results).toEqual({ result: [1, 4, 9] });
    expect(task.runOutputData).toEqual({ result: [1, 4, 9] });
  });

  test("child tasks emit events that bubble up to parent", async () => {
    // Create a task with a smaller array for testing events
    const task = new SquareRunTask({
      a: [1, 2],
    });

    // Create event tracking variables for parent and children
    const parentEvents: Record<string, number> = {
      start: 0,
      progress: 0,
      complete: 0,
    };

    const childEvents: Record<string, number> = {
      start: 0,
      progress: 0,
      complete: 0,
    };

    // Set up event listeners on parent task
    task.on("start", () => {
      parentEvents.start++;
    });

    task.on("progress", () => {
      parentEvents.progress++;
    });

    task.on("complete", () => {
      parentEvents.complete++;
    });

    // After task is created, we can access its subGraph and child tasks
    task.regenerateGraph();

    // Set up event listeners on child tasks
    task.subGraph!.getTasks().forEach((childTask: ITask) => {
      childTask.on("start", () => {
        childEvents.start++;
      });

      childTask.on("progress", () => {
        childEvents.progress++;
      });

      childTask.on("complete", () => {
        childEvents.complete++;
      });
    });

    // Manually trigger progress events
    // @ts-expect-error - we are testing the protected method
    task.runner.handleStart();
    // @ts-expect-error - we are testing the protected method
    task.runner.handleProgress(0.5);

    // Manually trigger progress events on child tasks
    task.subGraph!.getTasks().forEach((childTask: ITask) => {
      // @ts-expect-error - we are testing the protected method
      childTask.runner.handleStart();
      // @ts-expect-error - we are testing the protected method
      childTask.runner.handleProgress(0.5);
    });

    // Run the task
    await task.run();

    // Verify parent events were emitted
    expect(parentEvents.start).toBeGreaterThanOrEqual(1);
    expect(parentEvents.progress).toBeGreaterThanOrEqual(1);
    expect(parentEvents.complete).toBe(1);

    // Verify child events were emitted
    expect(childEvents.start).toBeGreaterThanOrEqual(2); // At least one for each child task
    expect(childEvents.progress).toBeGreaterThanOrEqual(2); // At least one for each child task
    expect(childEvents.complete).toBe(2); // One for each child task
  });

  // test("handles errors correctly", async () => {
  //   // Create a task with inputs that will cause an error
  //   const task = new TestErrorMultiInputTask(
  //     {
  //       input: [1, 2, 3], // The value 2 will cause an error
  //     },
  //     {
  //       id: "error-test-task",
  //     }
  //   );

  //   // Create event tracking variables
  //   const events: Record<string, number> = {
  //     start: 0,
  //     progress: 0,
  //     error: 0,
  //     complete: 0,
  //   };

  //   // Set up event listeners
  //   task.on("start", () => {
  //     events.start++;
  //   });

  //   task.on("progress", () => {
  //     events.progress++;
  //   });

  //   task.on("error", (error: TaskError) => {
  //     events.error++;
  //     expect(error).toBeDefined();
  //     expect(error.message).toContain("Test error");
  //   });

  //   task.on("complete", () => {
  //     events.complete++;
  //   });

  //   // Manually trigger a progress event
  //   task.handleStart();
  //   task.handleProgress(0.5);

  //   // Run the task and catch the error
  //   try {
  //     await task.run();
  //   } catch (error) {
  //     // Expected error
  //     expect(error).toBeDefined();
  //   }

  //   // Verify events were emitted
  //   expect(events.start).toBeGreaterThanOrEqual(1);
  //   expect(events.progress).toBeGreaterThanOrEqual(1);
  //   expect(events.error).toBeGreaterThanOrEqual(1);

  //   // The complete event should not be emitted when there's an error
  //   expect(events.complete).toBe(0);

  //   // Verify the task status is ERROR
  //   expect(task.status).toBe(TaskStatus.FAILED);
  //   expect(task.error).toBeDefined();
  // });

  test("JobQueueTask runReactive calls executeReactive in single task mode (no children)", async () => {
    // Create a JobQueueTask with non-array input - this puts it in single task mode (no subtasks)
    // Set queue: false to run directly without a queue
    const task = new JobQueueReactiveTask({ value: 5 });

    // Verify it has no children (single task mode)
    expect(task.hasChildren()).toBe(false);

    // Spy on executeReactive to verify it's called
    const executeReactiveSpy = spyOn(task, "executeReactive");

    // Call runReactive without calling run() first
    const results = await task.runReactive();

    // Verify executeReactive was actually called
    expect(executeReactiveSpy).toHaveBeenCalledTimes(1);
    expect(executeReactiveSpy).toHaveBeenCalledWith(
      { value: 5 },
      {},
      expect.objectContaining({ own: expect.any(Function) })
    );

    // Verify the result is correct (executeReactive should have computed it)
    expect(results).toEqual({ result: 10 }); // 5 * 2 = 10
  });

  test("JobQueueTask runReactive works in single task mode without prior run() call", async () => {
    // This test ensures runReactive works even when run() hasn't been called first
    const task = new JobQueueReactiveTask({ value: 7 });

    // Verify single task mode
    expect(task.hasChildren()).toBe(false);

    // Call runReactive without calling run() first
    const results = await task.runReactive();

    // Should compute the result using executeReactive
    expect(results).toEqual({ result: 14 }); // 7 * 2 = 14
    expect(task.runOutputData).toEqual({ result: 14 });
  });

  test("JobQueueTask runReactive works task graph mode", async () => {
    const graph = new TaskGraph();
    const task1 = new JobQueueReactiveTask2({ value: 7 }, { id: "task1" });
    const task2 = new JobQueueReactiveTask2({ value: 8 }, { id: "task2" });
    graph.addTask(task1);
    graph.addTask(task2);
    graph.addDataflow(new Dataflow("task1", "result", "task2", "value"));
    const results = await graph.runReactive<JobQueueTestOutput>();
    expect(task1.runOutputData).toEqual({ result: 14 });
    expect(task2.runOutputData).toEqual({ result: 28 });
    expect(results[0].data).toEqual({ result: 28 });
  });

  test("QueryAppendTask with single string input run reactive", async () => {
    const task = new QueryAppendTask({
      query: "test",
      val: 1,
    });
    const results = await task.runReactive();
    expect(results).toEqual({ result: "test-reactive", val: 1 });
  });

  test("QueryAppendTask with array string input run reactive", async () => {
    const task = new QueryAppendTask({
      query: ["test1", "test2"],
      val: 2,
    });
    const results = await task.runReactive();
    expect(results).toEqual({ result: ["test1-reactive", "test2-reactive"], val: 2 });
  });

  test("QueryAppendTask with single string input", async () => {
    const task = new QueryAppendTask({
      query: "test",
      val: 1,
    });
    const results = await task.run();
    expect(results).toEqual({ result: "test-output-reactive", val: 1 });
  });

  test("QueryAppendTask with array string input", async () => {
    const task = new QueryAppendTask({
      query: ["test1", "test2"],
      val: 2,
    });
    const results = await task.run();
    expect(results).toEqual({ result: ["test1-output-reactive", "test2-output-reactive"], val: 2 });
  });
});
