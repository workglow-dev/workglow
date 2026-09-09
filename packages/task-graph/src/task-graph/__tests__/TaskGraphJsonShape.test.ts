/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { taskGraphJsonShapeError, validateTaskGraphJsonShape } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

const flow = {
  sourceTaskId: "a",
  sourceTaskPortId: "out",
  targetTaskId: "b",
  targetTaskPortId: "in",
};

describe("taskGraphJsonShapeError", () => {
  it("accepts a well-formed graph", () => {
    expect(
      taskGraphJsonShapeError({
        tasks: [
          { id: "a", type: "InputTask" },
          { id: "b", type: "OutputTask", defaults: { x: 1 } },
        ],
        dataflows: [flow],
      })
    ).toBeUndefined();
  });

  it("accepts an empty graph", () => {
    expect(taskGraphJsonShapeError({ tasks: [], dataflows: [] })).toBeUndefined();
  });

  it("rejects a non-object graph", () => {
    for (const bad of [null, undefined, 1, "g", []]) {
      expect(taskGraphJsonShapeError(bad)).toBeDefined();
    }
  });

  it("requires both arrays", () => {
    expect(taskGraphJsonShapeError({ dataflows: [] })).toContain("tasks must be an array");
    expect(taskGraphJsonShapeError({ tasks: [] })).toContain("dataflows must be an array");
  });

  it("names the duplicate id rather than reporting that something is wrong", () => {
    const reason = taskGraphJsonShapeError({
      tasks: [
        { id: "a", type: "InputTask" },
        { id: "a", type: "OutputTask" },
      ],
      dataflows: [],
    });
    expect(reason).toContain('duplicate task id "a"');
  });

  it("requires a string id and type on every task", () => {
    expect(taskGraphJsonShapeError({ tasks: [{ type: "InputTask" }], dataflows: [] })).toContain(
      "string id"
    );
    expect(taskGraphJsonShapeError({ tasks: [{ id: "a" }], dataflows: [] })).toContain(
      "string type"
    );
    expect(taskGraphJsonShapeError({ tasks: [{ id: "", type: "T" }], dataflows: [] })).toContain(
      "string id"
    );
  });

  it("rejects defaults that are not a plain object", () => {
    for (const defaults of [[], "x", 1]) {
      expect(
        taskGraphJsonShapeError({ tasks: [{ id: "a", type: "T", defaults }], dataflows: [] })
      ).toContain("defaults must be an object");
    }
  });

  it("catches a dataflow pointing at a task that does not exist", () => {
    const reason = taskGraphJsonShapeError({
      tasks: [{ id: "a", type: "InputTask" }],
      dataflows: [flow],
    });
    expect(reason).toContain('dataflow target "b" is not a task id');
  });

  it("checks a nested subgraph, naming the task that holds it", () => {
    const reason = taskGraphJsonShapeError({
      tasks: [
        {
          id: "outer",
          type: "GraphAsTask",
          subgraph: {
            tasks: [
              { id: "a", type: "InputTask" },
              { id: "a", type: "OutputTask" },
            ],
            dataflows: [],
          },
        },
      ],
      dataflows: [],
    });
    expect(reason).toContain('task "outer" subgraph');
    expect(reason).toContain('duplicate task id "a"');
  });

  it("accepts a well-formed subgraph", () => {
    expect(
      taskGraphJsonShapeError({
        tasks: [
          {
            id: "outer",
            type: "GraphAsTask",
            subgraph: { tasks: [{ id: "a", type: "InputTask" }], dataflows: [] },
          },
        ],
        dataflows: [],
      })
    ).toBeUndefined();
  });

  it("reports a reason rather than overflowing on nested subgraphs", () => {
    let graph: unknown = { tasks: [], dataflows: [] };
    for (let i = 0; i < 5_000; i++) {
      graph = { tasks: [{ id: "g", type: "GraphAsTask", subgraph: graph }], dataflows: [] };
    }
    expect(taskGraphJsonShapeError(graph)).toContain("nest deeper than");
  });

  it("catches a dataflow missing an endpoint field", () => {
    const reason = taskGraphJsonShapeError({
      tasks: [{ id: "a", type: "InputTask" }],
      dataflows: [{ sourceTaskId: "a", targetTaskId: "a", targetTaskPortId: "in" }],
    });
    expect(reason).toContain("sourceTaskPortId");
  });
});

describe("validateTaskGraphJsonShape", () => {
  it("narrows on success", () => {
    const result = validateTaskGraphJsonShape({ tasks: [], dataflows: [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.graph.tasks).toEqual([]);
  });

  it("carries the reason on failure", () => {
    const result = validateTaskGraphJsonShape({ tasks: "no", dataflows: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("tasks must be an array");
  });
});
