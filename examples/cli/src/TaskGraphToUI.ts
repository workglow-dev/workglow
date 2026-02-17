/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ITaskGraph, IWorkflow, Task, TaskGraph, Taskish, Workflow } from "@workglow/task-graph";
import { sleep } from "@workglow/util";
import React from "react";
import { render } from "ink";
import App from "./components/App";

export async function runTasks(taskish: Taskish): Promise<any> {
  if (taskish instanceof Workflow) {
    return await runWorkflow(taskish);
  } else if (taskish instanceof Task) {
    return await runSingleTask(taskish);
  } else if (taskish instanceof TaskGraph) {
    return await runGraph(taskish);
  } else {
    throw new Error("Unknown taskish type");
  }
}

export async function runWorkflow(workflow: IWorkflow): Promise<any> {
  return await runGraph(workflow.graph);
}

export async function runSingleTask(task: Task): Promise<any> {
  if (process.stdout.isTTY === true || (process.stdout.isTTY === undefined && !process.env.CI)) {
    const graph = new TaskGraph();
    graph.addTask(task);
    return await runTaskGraphToInk(graph);
  } else {
    const result = await task.run();
    return result;
  }
}

export async function runGraph(graph: ITaskGraph): Promise<any> {
  if (process.stdout.isTTY === true || (process.stdout.isTTY === undefined && !process.env.CI)) {
    return await runTaskGraphToInk(graph);
  } else {
    const result = await graph.run();
    return result;
  }
}

const runTaskGraphToInk = async (graph: ITaskGraph): Promise<any> => {
  // preserveScreen();
  const { unmount } = render(React.createElement(App, { graph }));
  let results: any;
  try {
    await sleep(150);
    results = await graph.run();
  } catch (e: any) {}
  await sleep(150);
  unmount();
  return results;
};
