/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import type { AnyTaskConstructor } from "../taskTools";
import {
  buildTaskToolIndex,
  describeTaskTool,
  isToolWorthyTask,
  listTaskTools,
  toolNameForTaskType,
  toolResultForError,
  toolResultForOutput,
  toToolInputSchema,
} from "../taskTools";

class GreetTask extends Task<{ name: string }, { greeting: string }> {
  public static override type = "GreetTask";
  public static override category = "Utility";
  public static override title = "Greet";
  public static override description = "Says hello";

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { greeting: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
}

class LoopTask extends Task {
  public static override type = "LoopTask";
  public static override category = "Flow Control";
}

class AlsoGreetTask extends Task {
  // The dot is the interesting part: a downstream host is free to namespace its
  // task types, and MCP tool names have no room for a dot.
  public static override type = "greet.task";
  public static override category = "Utility";
}

const asCtor = (value: unknown): AnyTaskConstructor => value as AnyTaskConstructor;

describe("toolNameForTaskType", () => {
  it("keeps a legal type verbatim, so one vocabulary serves tool call and terminal", () => {
    expect(toolNameForTaskType("GreetTask")).toBe("GreetTask");
    expect(toolNameForTaskType("text_generation-2")).toBe("text_generation-2");
  });

  it("folds anything a client would reject into an underscore", () => {
    expect(toolNameForTaskType("greet.task")).toBe("greet_task");
    expect(toolNameForTaskType("sec:fetch filing")).toBe("sec_fetch_filing");
  });

  it("trims the separators a fold can leave at the edges", () => {
    expect(toolNameForTaskType(".greet.")).toBe("greet");
  });

  it("still returns a usable name for a type made entirely of illegal characters", () => {
    expect(toolNameForTaskType("...")).toBe("task");
  });
});

describe("isToolWorthyTask", () => {
  it("drops flow control, which means nothing without a graph around it", () => {
    expect(isToolWorthyTask(asCtor(LoopTask))).toBe(false);
    expect(isToolWorthyTask(asCtor(GreetTask))).toBe(true);
  });
});

describe("buildTaskToolIndex", () => {
  it("offers the selected tasks under their tool names", () => {
    const index = buildTaskToolIndex({ tasks: [asCtor(GreetTask)] });
    expect([...index.keys()]).toEqual(["GreetTask"]);
    expect(index.get("GreetTask")).toBe(GreetTask);
  });

  it("applies the flow-control default", () => {
    const index = buildTaskToolIndex({ tasks: [asCtor(GreetTask), asCtor(LoopTask)] });
    expect([...index.keys()]).toEqual(["GreetTask"]);
  });

  it("honours an explicit predicate over the default", () => {
    const index = buildTaskToolIndex({
      tasks: [asCtor(GreetTask), asCtor(LoopTask)],
      include: () => true,
    });
    expect([...index.keys()].sort()).toEqual(["GreetTask", "LoopTask"]);
  });

  it("orders by task type, so a client's cached list does not reshuffle", () => {
    const forwards = buildTaskToolIndex({ tasks: [asCtor(GreetTask), asCtor(AlsoGreetTask)] });
    const backwards = buildTaskToolIndex({ tasks: [asCtor(AlsoGreetTask), asCtor(GreetTask)] });
    expect([...forwards.keys()]).toEqual([...backwards.keys()]);
  });

  it("keeps both tasks callable when sanitizing folds two types together", () => {
    class GreetUnderscoreTask extends Task {
      public static override type = "greet_task";
      public static override category = "Utility";
    }
    const index = buildTaskToolIndex({
      tasks: [asCtor(AlsoGreetTask), asCtor(GreetUnderscoreTask)],
    });
    expect([...index.keys()].sort()).toEqual(["greet_task", "greet_task_2"]);
    expect(new Set(index.values()).size).toBe(2);
  });
});

describe("toToolInputSchema", () => {
  it("passes an object schema through, required list included", () => {
    expect(toToolInputSchema(GreetTask.inputSchema())).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    });
  });

  it("copies `required` rather than sharing the task's own array", () => {
    const schema = GreetTask.inputSchema();
    const converted = toToolInputSchema(schema);
    expect(converted.required).not.toBe((schema as { required?: readonly string[] }).required);
  });

  it("falls back to an argument-less object for a schema MCP cannot express", () => {
    // A client rejects the whole tool list over one schema it cannot parse, so
    // a task declaring something else is offered as taking no arguments rather
    // than as a tool nobody can see.
    expect(toToolInputSchema(true)).toEqual({ type: "object" });
    expect(toToolInputSchema({ type: "string" } as unknown as DataPortSchema)).toEqual({
      type: "object",
    });
  });
});

describe("describeTaskTool", () => {
  it("carries the task's title and puts its category in front of the description", () => {
    expect(describeTaskTool("GreetTask", asCtor(GreetTask))).toMatchObject({
      name: "GreetTask",
      title: "Greet",
      description: "[Utility] Says hello",
    });
  });

  it("falls back to the type when a task describes itself with nothing else", () => {
    class BareTask extends Task {
      public static override type = "BareTask";
    }
    // `Task` leaves `title` and `description` as `""` and `category` as
    // `"Hidden"`, none of which is worth showing a model.
    expect(describeTaskTool("BareTask", asCtor(BareTask))).toEqual({
      name: "BareTask",
      description: "BareTask",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    });
  });
});

describe("listTaskTools", () => {
  it("describes every selected task", () => {
    expect(listTaskTools({ tasks: [asCtor(GreetTask)] })).toEqual([
      describeTaskTool("GreetTask", asCtor(GreetTask)),
    ]);
  });
});

describe("toolResultForOutput", () => {
  it("renders the output as text and repeats it as structured content", () => {
    const result = toolResultForOutput({ greeting: "hi" });
    expect(result.content).toEqual([{ type: "text", text: '{\n  "greeting": "hi"\n}' }]);
    expect(result.structuredContent).toEqual({ greeting: "hi" });
  });

  it("omits structured content for an output that is not an object", () => {
    expect(toolResultForOutput(undefined).structuredContent).toBeUndefined();
  });

  it("still reports a result whose output cannot be serialized", () => {
    // The call has already done its work by this point, and possibly spent
    // money doing it; failing to render it is not a reason to lose it.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = toolResultForOutput(cyclic);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: "text" });
  });
});

describe("toolResultForError", () => {
  it("reports a failed run as a result a model can read, not a protocol error", () => {
    expect(toolResultForError(new Error("boom"))).toEqual({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    });
  });
});
