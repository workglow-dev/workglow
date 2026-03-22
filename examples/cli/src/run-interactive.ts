/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask, IWorkflow, WorkflowRunConfig } from "@workglow/task-graph";
import { detectCliTheme, setCliTheme } from "./terminal/detectTerminalTheme";
import { renderTaskInstanceRun, renderWorkflowRun } from "./ui/render";

function taskStaticType(task: ITask): string {
  const ctor = task.constructor as { type?: string };
  return typeof ctor.type === "string" ? ctor.type : "Task";
}

/**
 * Runs an {@link IWorkflow} (including values returned from {@link pipe}) with an Ink progress UI
 * when stdout is a TTY; otherwise `workflow.run()`.
 */
export async function runWorkflow(
  workflow: IWorkflow,
  input: Record<string, unknown> = {},
  config?: WorkflowRunConfig
): Promise<unknown> {
  if (!process.stdout.isTTY) {
    return workflow.run(input, config);
  }

  setCliTheme(await detectCliTheme());

  return renderWorkflowRun(workflow.graph, input, {
    config: config as Record<string, unknown> | undefined,
    runExecutor: () => workflow.run(input, config),
    suppressResultOutput: true,
  });
}

/**
 * Runs a task instance with an Ink progress UI when stdout is a TTY; otherwise `task.run()`.
 */
export async function runTasks(task: ITask): Promise<unknown> {
  if (!process.stdout.isTTY) {
    return task.run();
  }

  setCliTheme(await detectCliTheme());

  const taskType = taskStaticType(task);

  return renderTaskInstanceRun(
    {
      run: (overrides) => task.run(overrides),
      events: task.events,
    },
    taskType,
    { suppressResultOutput: true }
  );
}
