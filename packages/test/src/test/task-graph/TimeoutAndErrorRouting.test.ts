/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dataflow,
  DATAFLOW_ERROR_PORT,
  DATAFLOW_ALL_PORTS,
  IExecuteContext,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskStatus,
  TaskTimeoutError,
  TaskAbortedError,
  TaskFailedError,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, sleep } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";

// ========================================================================
// Test helper tasks
// ========================================================================

/**
 * A task that sleeps for a configurable duration, respecting abort signals.
 * Sleep duration is set via the sleepMs property (not config, to avoid schema validation).
 */
class SlowTask extends Task<{ input: number }, { output: number }> {
  static readonly type = "SlowTask";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: { type: "number", default: 0 },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public sleepMs = 200;

  async execute(input: { input: number }, context: IExecuteContext): Promise<{ output: number }> {
    const step = 10;
    for (let elapsed = 0; elapsed < this.sleepMs; elapsed += step) {
      if (context.signal.aborted) {
        throw new TaskAbortedError();
      }
      await sleep(step);
    }
    return { output: (input.input ?? 0) * 2 };
  }
}

/**
 * A task that always fails with a configurable message.
 */
class AlwaysFailTask extends Task<{ input: number }, { output: number }> {
  static readonly type = "AlwaysFailTask";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: { type: "number", default: 0 },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(): Promise<{ output: number }> {
    throw new TaskFailedError("Intentional failure");
  }
}

/**
 * A recovery task that receives error data and produces a fallback output.
 * Uses additionalProperties: true so it can receive any error shape.
 */
class ErrorRecoveryTask extends Task<Record<string, unknown>, { output: number }> {
  static readonly type = "ErrorRecoveryTask";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: Record<string, unknown>): Promise<{ output: number }> {
    // Return a fallback value; the error info is available in input
    return { output: -1 };
  }
}

/**
 * A simple pass-through task that doubles its input.
 */
class DoubleTask extends Task<{ input: number }, { output: number }> {
  static readonly type = "DoubleTask";
  static readonly cacheable = false;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        input: { type: "number", default: 0 },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        output: { type: "number" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { input: number }): Promise<{ output: number }> {
    return { output: (input.input ?? 0) * 2 };
  }
}

// ========================================================================
// Tests
// ========================================================================

describe("Task-Level Timeout", () => {
  it("should abort a slow task when timeout expires", async () => {
    const task = new SlowTask();
    task.sleepMs = 500;

    await expect(task.run({}, { timeout: 50 })).rejects.toThrow(TaskTimeoutError);
    expect(task.status).toBe(TaskStatus.ABORTING);
    expect(task.error).toBeInstanceOf(TaskTimeoutError);
    expect(task.error?.message).toContain("50ms");
  });

  it("should complete normally when task finishes before timeout", async () => {
    const task = new SlowTask({ input: 5 });
    task.sleepMs = 20;

    const output = await task.run({}, { timeout: 2000 });
    expect(output.output).toBe(10);
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });

  it("should not interfere when no timeout is set", async () => {
    const task = new SlowTask({ input: 3 });
    task.sleepMs = 20;

    const output = await task.run();
    expect(output.output).toBe(6);
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });

  it("should surface TaskTimeoutError (subclass of TaskAbortedError)", async () => {
    const task = new SlowTask();
    task.sleepMs = 500;

    try {
      await task.run({}, { timeout: 30 });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TaskTimeoutError);
      expect(err).toBeInstanceOf(TaskAbortedError);
    }
  });

  it("should emit abort event with TaskTimeoutError", async () => {
    const task = new SlowTask();
    task.sleepMs = 500;
    let receivedError: unknown = null;

    task.on("abort", (error) => {
      receivedError = error;
    });

    await task.run({}, { timeout: 30 }).catch(() => {});

    expect(receivedError).toBeInstanceOf(TaskTimeoutError);
  });

  it("should work with timeout in a graph runner context", async () => {
    const graph = new TaskGraph();
    const slow = new SlowTask({ input: 5 }, { id: "slow" });
    slow.sleepMs = 500;
    slow.runConfig = { timeout: 50 };

    graph.addTask(slow);
    const runner = new TaskGraphRunner(graph);

    await expect(runner.runGraph()).rejects.toThrow();
    expect(slow.status).toBe(TaskStatus.ABORTING);
    expect(slow.error).toBeInstanceOf(TaskTimeoutError);
  });
});

describe("Error Output Ports / Error Routing", () => {
  describe("Graph-level error routing", () => {
    it("should route errors through error-port dataflows instead of failing the graph", async () => {
      const graph = new TaskGraph();
      const failTask = new AlwaysFailTask({ input: 5 }, { id: "fail" });
      const recoveryTask = new ErrorRecoveryTask({}, { id: "recovery" });

      graph.addTasks([failTask, recoveryTask]);
      // Connect the error output port to the recovery task
      graph.addDataflow(new Dataflow("fail", DATAFLOW_ERROR_PORT, "recovery", DATAFLOW_ALL_PORTS));

      const runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph();

      // Graph should succeed because error was routed to recovery task
      expect(results.length).toBeGreaterThan(0);
      const recoveryResult = results.find((r) => r.id === "recovery");
      expect(recoveryResult).toBeDefined();
      expect(recoveryResult!.data).toEqual({ output: -1 });
    });

    it("should set error-port edges to COMPLETED and normal edges to DISABLED", async () => {
      const graph = new TaskGraph();
      const failTask = new AlwaysFailTask({ input: 5 }, { id: "fail" });
      const recoveryTask = new ErrorRecoveryTask({}, { id: "recovery" });
      const normalDownstream = new DoubleTask({ input: 0 }, { id: "normal" });

      graph.addTasks([failTask, recoveryTask, normalDownstream]);
      graph.addDataflow(new Dataflow("fail", DATAFLOW_ERROR_PORT, "recovery", DATAFLOW_ALL_PORTS));
      graph.addDataflow(new Dataflow("fail", "output", "normal", "input"));

      const runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph();

      // Error port edge should be COMPLETED
      const errorEdges = graph
        .getTargetDataflows("fail")
        .filter((df) => df.sourceTaskPortId === DATAFLOW_ERROR_PORT);
      expect(errorEdges.length).toBe(1);
      expect(errorEdges[0].status).toBe(TaskStatus.COMPLETED);

      // Normal output edge should be DISABLED
      const normalEdges = graph
        .getTargetDataflows("fail")
        .filter((df) => df.sourceTaskPortId !== DATAFLOW_ERROR_PORT);
      expect(normalEdges.length).toBe(1);
      expect(normalEdges[0].status).toBe(TaskStatus.DISABLED);

      // Normal downstream task should be DISABLED (all its inputs are disabled)
      expect(normalDownstream.status).toBe(TaskStatus.DISABLED);
    });

    it("should still fail the graph when no error-port edges exist (backward compat)", async () => {
      const graph = new TaskGraph();
      const failTask = new AlwaysFailTask({ input: 5 }, { id: "fail" });

      graph.addTask(failTask);
      const runner = new TaskGraphRunner(graph);

      await expect(runner.runGraph()).rejects.toThrow(TaskFailedError);
    });

    it("should pass error data to the recovery task", async () => {
      let receivedInput: Record<string, unknown> = {};

      class InspectingRecoveryTask extends Task<Record<string, unknown>, { output: number }> {
        static readonly type = "InspectingRecoveryTask";
        static readonly cacheable = false;

        static inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {},
            additionalProperties: true,
          } as const satisfies DataPortSchema;
        }

        static outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              output: { type: "number" },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        async execute(input: Record<string, unknown>): Promise<{ output: number }> {
          receivedInput = { ...input };
          return { output: 42 };
        }
      }

      const graph = new TaskGraph();
      const failTask = new AlwaysFailTask({ input: 5 }, { id: "fail" });
      const inspectTask = new InspectingRecoveryTask({}, { id: "inspect" });

      graph.addTasks([failTask, inspectTask]);
      graph.addDataflow(new Dataflow("fail", DATAFLOW_ERROR_PORT, "inspect", DATAFLOW_ALL_PORTS));

      const runner = new TaskGraphRunner(graph);
      await runner.runGraph();

      // The recovery task should have received error data
      expect(receivedInput).toHaveProperty("error");
      expect(receivedInput).toHaveProperty("errorType");
      expect(receivedInput.error).toBe("Intentional failure");
      expect(receivedInput.errorType).toBe("TaskFailedError");
    });

    it("should allow chaining after error recovery", async () => {
      const graph = new TaskGraph();
      const failTask = new AlwaysFailTask({ input: 5 }, { id: "fail" });
      const recoveryTask = new ErrorRecoveryTask({}, { id: "recovery" });
      const downstream = new DoubleTask({}, { id: "downstream" });

      graph.addTasks([failTask, recoveryTask, downstream]);
      graph.addDataflow(new Dataflow("fail", DATAFLOW_ERROR_PORT, "recovery", DATAFLOW_ALL_PORTS));
      graph.addDataflow(new Dataflow("recovery", "output", "downstream", "input"));

      const runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph();

      // Recovery task outputs -1, downstream doubles it to -2
      const downstreamResult = results.find((r) => r.id === "downstream");
      expect(downstreamResult).toBeDefined();
      expect(downstreamResult!.data).toEqual({ output: -2 });
    });
  });

  describe("Workflow.onError()", () => {
    it("should add error-port dataflow from previous task to handler", () => {
      const workflow = new Workflow();
      const failTask = new AlwaysFailTask({}, { id: "fail" });
      const recoveryTask = new ErrorRecoveryTask({}, { id: "recovery" });

      workflow.graph.addTask(failTask);
      workflow.onError(recoveryTask);

      const dataflows = workflow.graph.getTargetDataflows("fail");
      const errorDataflows = dataflows.filter((df) => df.sourceTaskPortId === DATAFLOW_ERROR_PORT);
      expect(errorDataflows.length).toBe(1);
      expect(errorDataflows[0].targetTaskId).toBe("recovery");
      expect(errorDataflows[0].targetTaskPortId).toBe(DATAFLOW_ALL_PORTS);
    });

    it("should throw if called without a preceding task", () => {
      const workflow = new Workflow();
      const recoveryTask = new ErrorRecoveryTask({}, { id: "recovery" });

      expect(() => workflow.onError(recoveryTask)).toThrow("onError() requires a preceding task");
    });
  });
});
