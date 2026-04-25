/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import type { ConditionFn } from "../task/ConditionalTask";
import { ConditionalTask } from "../task/ConditionalTask";
import type { ITask, ITaskConstructor } from "../task/ITask";
import { WorkflowError } from "../task/TaskError";
import type { DataPorts, TaskConfig, TaskInput } from "../task/TaskTypes";
import { Dataflow } from "./Dataflow";
import type { Workflow } from "./Workflow";

/**
 * Fluent builder for constructing a {@link ConditionalTask} with a
 * canonical then/else shape. Created by {@link Workflow.if} and closed via
 * {@link ConditionalBuilder.endIf}. Each arm accepts a single task class
 * (with optional input/config), which the builder instantiates and wires
 * from the conditional's matching output port.
 *
 * Usage:
 *
 * ```ts
 * workflow
 *   .if((input) => input.kind === "text")
 *   .then(TextTask)
 *   .else(ImageTask)
 *   .endIf();
 * ```
 */
export class ConditionalBuilder {
  private thenSpec: BranchTaskSpec | undefined;
  private elseSpec: BranchTaskSpec | undefined;

  constructor(
    private readonly workflow: Workflow,
    private readonly condition: ConditionFn<TaskInput>
  ) {}

  /**
   * Register the task that runs when the condition matches. Accepts the
   * same (taskClass, input?, config?) triple as {@link Workflow.addTask}.
   */
  public then<I extends DataPorts, O extends DataPorts, C extends TaskConfig<I> = TaskConfig<I>>(
    taskClass: ITaskConstructor<I, O, C>,
    input?: Partial<I>,
    config?: Partial<C>
  ): this {
    this.thenSpec = { taskClass, input, config };
    return this;
  }

  /**
   * Register the task that runs when the condition does not match. Optional.
   */
  public else<I extends DataPorts, O extends DataPorts, C extends TaskConfig<I> = TaskConfig<I>>(
    taskClass: ITaskConstructor<I, O, C>,
    input?: Partial<I>,
    config?: Partial<C>
  ): this {
    this.elseSpec = { taskClass, input, config };
    return this;
  }

  /**
   * Finalize the if/else arms into a {@link ConditionalTask} plus the
   * downstream branch tasks, wired via dataflows from the conditional's
   * matching output ports. Returns the parent workflow for continued chaining.
   */
  public endIf(): Workflow {
    if (!this.thenSpec) {
      throw new WorkflowError(".endIf() called without a prior .then(...) call");
    }

    const thenPort = "then";
    const elsePort = "else";

    const branches = [
      {
        id: thenPort,
        condition: this.condition,
        outputPort: thenPort,
      },
    ];

    if (this.elseSpec) {
      // Inverse condition so the "else" branch is mutually exclusive with "then".
      // If the user's condition throws, ConditionalTask's own error handling
      // treats both branches as not-matched; `defaultBranch: elsePort` below
      // then routes to else — matching ConditionalTask's error-as-false semantics.
      branches.push({
        id: elsePort,
        condition: (input: TaskInput) => !this.condition(input),
        outputPort: elsePort,
      });
    }

    const conditionalTask = new ConditionalTask({
      id: uuid4(),
      branches,
      exclusive: true,
      defaultBranch: this.elseSpec ? elsePort : undefined,
    });
    this.workflow.graph.addTask(conditionalTask);

    const thenTask = instantiate(this.thenSpec);
    this.workflow.graph.addTask(thenTask);
    this.workflow.graph.addDataflow(new Dataflow(conditionalTask.id, thenPort, thenTask.id, "*"));

    if (this.elseSpec) {
      const elseTask = instantiate(this.elseSpec);
      this.workflow.graph.addTask(elseTask);
      this.workflow.graph.addDataflow(new Dataflow(conditionalTask.id, elsePort, elseTask.id, "*"));
    }

    return this.workflow;
  }
}

interface BranchTaskSpec {
  readonly taskClass: ITaskConstructor<any, any, any>;
  readonly input?: unknown;
  readonly config?: unknown;
}

function instantiate(spec: BranchTaskSpec): ITask<any, any, any> {
  const config = {
    id: uuid4(),
    ...(spec.config as Record<string, unknown> | undefined),
    defaults: spec.input,
  };
  return new spec.taskClass(config as any);
}
