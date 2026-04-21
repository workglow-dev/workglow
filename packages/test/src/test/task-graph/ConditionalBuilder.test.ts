/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConditionalTask, Workflow, WorkflowError } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { describe, expect, it } from "vitest";

import { getTestingLogger } from "../../binding/TestingLogger";
import { DoubleToDoubledTask, HalveTask } from "../task/TestTasks";

describe("ConditionalBuilder (Workflow.if)", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  it("creates a ConditionalTask + then-only branch with a wired dataflow", () => {
    const workflow = new Workflow();
    workflow
      .if((input: any) => input.value > 5)
      .then(DoubleToDoubledTask)
      .endIf();

    const tasks = workflow.graph.getTasks();
    expect(tasks.some((t) => t instanceof ConditionalTask)).toBe(true);
    expect(tasks.some((t) => t instanceof DoubleToDoubledTask)).toBe(true);

    const conditional = tasks.find((t) => t instanceof ConditionalTask) as ConditionalTask;
    const thenTask = tasks.find((t) => t instanceof DoubleToDoubledTask)!;

    const dataflows = workflow.graph.getDataflows();
    const thenEdge = dataflows.find(
      (df) => df.sourceTaskId === conditional.id && df.targetTaskId === thenTask.id
    );
    expect(thenEdge).toBeDefined();
    expect(thenEdge!.sourceTaskPortId).toBe("then");
  });

  it("creates then + else branches with both dataflows wired", () => {
    const workflow = new Workflow();
    workflow
      .if((input: any) => input.value > 5)
      .then(DoubleToDoubledTask)
      .else(HalveTask)
      .endIf();

    const tasks = workflow.graph.getTasks();
    const conditional = tasks.find((t) => t instanceof ConditionalTask) as ConditionalTask;
    const thenTask = tasks.find((t) => t instanceof DoubleToDoubledTask)!;
    const elseTask = tasks.find((t) => t instanceof HalveTask)!;

    const dataflows = workflow.graph.getDataflows();
    const thenEdge = dataflows.find(
      (df) => df.sourceTaskId === conditional.id && df.targetTaskId === thenTask.id
    );
    const elseEdge = dataflows.find(
      (df) => df.sourceTaskId === conditional.id && df.targetTaskId === elseTask.id
    );

    expect(thenEdge?.sourceTaskPortId).toBe("then");
    expect(elseEdge?.sourceTaskPortId).toBe("else");
  });

  it("throws WorkflowError when endIf() is called without then()", () => {
    const workflow = new Workflow();
    const builder = workflow.if((input: any) => input.value > 5);

    expect(() => builder.endIf()).toThrow(WorkflowError);
  });

  it("activates only the then branch when condition matches", async () => {
    const workflow = new Workflow();
    workflow
      .if((input: any) => input.value > 5)
      .then(DoubleToDoubledTask)
      .else(HalveTask)
      .endIf();

    const tasks = workflow.graph.getTasks();
    const conditional = tasks.find((t) => t instanceof ConditionalTask) as ConditionalTask;

    await conditional.run({ value: 10 });

    expect(conditional.isBranchActive("then")).toBe(true);
    expect(conditional.isBranchActive("else")).toBe(false);
  });

  it("activates only the else branch when condition does not match", async () => {
    const workflow = new Workflow();
    workflow
      .if((input: any) => input.value > 5)
      .then(DoubleToDoubledTask)
      .else(HalveTask)
      .endIf();

    const tasks = workflow.graph.getTasks();
    const conditional = tasks.find((t) => t instanceof ConditionalTask) as ConditionalTask;

    await conditional.run({ value: 3 });

    expect(conditional.isBranchActive("then")).toBe(false);
    expect(conditional.isBranchActive("else")).toBe(true);
  });

  it("routes a throwing condition consistently with ConditionalTask error-as-false semantics", async () => {
    // If the primary condition throws, it should be treated as false
    // (matching ConditionalTask.ts:339-343). With an else arm defined,
    // the else branch runs via defaultBranch — NOT because the inverted
    // condition's own try/catch forces it true. The observable outcome is
    // the same (else runs), but the internals must not rely on a wrapper
    // that diverges from the documented error-as-false behavior.
    const workflow = new Workflow();
    workflow
      .if(() => {
        throw new Error("boom");
      })
      .then(DoubleToDoubledTask)
      .else(HalveTask)
      .endIf();

    const tasks = workflow.graph.getTasks();
    const conditional = tasks.find((t) => t instanceof ConditionalTask) as ConditionalTask;

    // The else-branch condition, when invoked directly, must propagate
    // the underlying error (or return false) — not silently return true.
    // ConditionalTask itself is responsible for catching and treating-as-false.
    const branches = conditional.config.branches!;
    const elseBranch = branches.find((b) => b.id === "else")!;
    expect(() => elseBranch.condition({})).toThrow("boom");

    // End-to-end behavior: condition throws → then inactive → defaultBranch (else) fires.
    await conditional.run({});
    expect(conditional.isBranchActive("then")).toBe(false);
    expect(conditional.isBranchActive("else")).toBe(true);
  });

  it("with no else arm, a throwing condition leaves all branches inactive", async () => {
    const workflow = new Workflow();
    workflow
      .if(() => {
        throw new Error("boom");
      })
      .then(DoubleToDoubledTask)
      .endIf();

    const tasks = workflow.graph.getTasks();
    const conditional = tasks.find((t) => t instanceof ConditionalTask) as ConditionalTask;

    await conditional.run({});
    expect(conditional.isBranchActive("then")).toBe(false);
    expect(conditional.getActiveBranches().size).toBe(0);
  });
});
