/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util";
import { GraphAsTask } from "../task/GraphAsTask";
import type { IExecuteContext, ITask } from "../task/ITask";
import { Task } from "../task/Task";
import type { DataPorts } from "../task/TaskTypes";
import { Dataflow, DATAFLOW_ALL_PORTS } from "./Dataflow";
import type { ITaskGraph } from "./ITaskGraph";
import type { IWorkflow } from "./IWorkflow";
import { TaskGraph } from "./TaskGraph";
import { PROPERTY_ARRAY, type CompoundMergeStrategy } from "./TaskGraphRunner";
import { Workflow } from "./Workflow";

class ListeningGraphAsTask extends GraphAsTask<any, any> {
  constructor(input: any, config: any) {
    super(input, config);
    this.subGraph.on("start", () => {
      this.emit("start");
    });
    this.subGraph.on("complete", () => {
      this.emit("complete");
    });
    this.subGraph.on("error", (e) => {
      this.emit("error", e);
    });
  }
}

class OwnGraphTask extends ListeningGraphAsTask {
  public static readonly type = "Own[Graph]";
}

class OwnWorkflowTask extends ListeningGraphAsTask {
  public static readonly type = "Own[Workflow]";
}
class GraphTask extends GraphAsTask {
  public static readonly type = "Graph";
}

class WorkflowTask extends GraphAsTask {
  public static readonly type = "Workflow";
}

// Update PipeFunction type to be more specific about input/output types
export type PipeFunction<I extends DataPorts = any, O extends DataPorts = any> = (
  input: I,
  context: IExecuteContext
) => O | Promise<O>;

export type Taskish<A extends DataPorts = DataPorts, B extends DataPorts = DataPorts> =
  | PipeFunction<A, B>
  | ITask<A, B>
  | ITaskGraph
  | IWorkflow<A, B>;

function convertPipeFunctionToTask<I extends DataPorts, O extends DataPorts>(
  fn: PipeFunction<I, O>,
  config?: any
): ITask<I, O> {
  class QuickTask extends Task<I, O> {
    public static type = fn.name ? `𝑓 ${fn.name}` : "𝑓";
    public static inputSchema = () => {
      return {
        type: "object",
        properties: {
          [DATAFLOW_ALL_PORTS]: {},
        },
        additionalProperties: false,
      } as const satisfies DataPortSchema;
    };
    public static outputSchema = () => {
      return {
        type: "object",
        properties: {
          [DATAFLOW_ALL_PORTS]: {},
        },
        additionalProperties: false,
      } as const satisfies DataPortSchema;
    };
    public static cacheable = false;
    public async execute(input: I, context: IExecuteContext) {
      return fn(input, context);
    }
  }
  return new QuickTask({}, config);
}

export function ensureTask<I extends DataPorts, O extends DataPorts>(
  arg: Taskish<I, O>,
  config: any = {}
): ITask<any, any, any> {
  if (arg instanceof Task) {
    return arg;
  }
  if (arg instanceof TaskGraph) {
    const { isOwned, ...cleanConfig } = config;
    if (isOwned) {
      return new OwnGraphTask({}, { ...cleanConfig, subGraph: arg });
    } else {
      return new GraphTask({}, { ...cleanConfig, subGraph: arg });
    }
  }
  if (arg instanceof Workflow) {
    const { isOwned, ...cleanConfig } = config;
    if (isOwned) {
      return new OwnWorkflowTask({}, { ...cleanConfig, subGraph: arg.graph });
    } else {
      return new WorkflowTask({}, { ...cleanConfig, subGraph: arg.graph });
    }
  }
  return convertPipeFunctionToTask(arg as PipeFunction<I, O>, config);
}

export function getLastTask(workflow: IWorkflow): ITask<any, any, any> | undefined {
  const tasks = workflow.graph.getTasks();
  return tasks.length > 0 ? tasks[tasks.length - 1] : undefined;
}

export function connect(
  source: ITask<any, any, any>,
  target: ITask<any, any, any>,
  workflow: IWorkflow<any, any>
): void {
  workflow.graph.addDataflow(new Dataflow(source.config.id, "*", target.config.id, "*"));
}

export function pipe<A extends DataPorts, B extends DataPorts>(
  [fn1]: [Taskish<A, B>],
  workflow?: IWorkflow<A, B>
): IWorkflow<A, B>;

export function pipe<A extends DataPorts, B extends DataPorts, C extends DataPorts>(
  [fn1, fn2]: [Taskish<A, B>, Taskish<B, C>],
  workflow?: IWorkflow<A, C>
): IWorkflow<A, C>;

export function pipe<
  A extends DataPorts,
  B extends DataPorts,
  C extends DataPorts,
  D extends DataPorts,
>(
  [fn1, fn2, fn3]: [Taskish<A, B>, Taskish<B, C>, Taskish<C, D>],
  workflow?: IWorkflow<A, D>
): IWorkflow<A, D>;

export function pipe<
  A extends DataPorts,
  B extends DataPorts,
  C extends DataPorts,
  D extends DataPorts,
  E extends DataPorts,
>(
  [fn1, fn2, fn3, fn4]: [Taskish<A, B>, Taskish<B, C>, Taskish<C, D>, Taskish<D, E>],
  workflow?: IWorkflow<A, E>
): IWorkflow<A, E>;

export function pipe<
  A extends DataPorts,
  B extends DataPorts,
  C extends DataPorts,
  D extends DataPorts,
  E extends DataPorts,
  F extends DataPorts,
>(
  [fn1, fn2, fn3, fn4, fn5]: [
    Taskish<A, B>,
    Taskish<B, C>,
    Taskish<C, D>,
    Taskish<D, E>,
    Taskish<E, F>,
  ],
  workflow?: IWorkflow<A, F>
): IWorkflow<A, F>;

export function pipe<I extends DataPorts, O extends DataPorts>(
  args: Taskish<I, O>[],
  workflow: IWorkflow<I, O> = new Workflow<I, O>()
): IWorkflow<I, O> {
  let previousTask = getLastTask(workflow);
  const tasks = args.map((arg) => ensureTask(arg));
  tasks.forEach((task) => {
    workflow.graph.addTask(task);
    if (previousTask) {
      connect(previousTask, task, workflow);
    }
    previousTask = task;
  });
  return workflow;
}

export function parallel<I extends DataPorts = DataPorts, O extends DataPorts = DataPorts>(
  args: (PipeFunction<I, O> | ITask<I, O> | IWorkflow<I, O> | ITaskGraph)[],
  mergeFn: CompoundMergeStrategy = PROPERTY_ARRAY,
  workflow: IWorkflow<I, O> = new Workflow<I, O>()
): IWorkflow<I, O> {
  let previousTask = getLastTask(workflow);
  const tasks = args.map((arg) => ensureTask(arg));
  const input = {};
  const config = {
    compoundMerge: mergeFn,
  };
  const name = `‖${args.map((arg) => "𝑓").join("‖")}‖`;
  class ParallelTask extends GraphAsTask<I, O> {
    public static type = name;
  }
  const mergeTask = new ParallelTask(input, config);
  mergeTask.subGraph!.addTasks(tasks);
  workflow.graph.addTask(mergeTask);
  if (previousTask) {
    connect(previousTask, mergeTask, workflow);
  }
  return workflow;
}
