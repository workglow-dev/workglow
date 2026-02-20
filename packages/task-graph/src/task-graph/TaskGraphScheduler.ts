/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ITask } from "../task/ITask";
import { TaskStatus } from "../task/TaskTypes";
import { TaskGraph } from "./TaskGraph";

/**
 * Interface for task graph schedulers
 */
export interface ITaskGraphScheduler {
  /**
   * Gets an async iterator of tasks that can be executed
   * @returns AsyncIterator of tasks that resolves to each task when it's ready
   */
  tasks(): AsyncIterableIterator<ITask>;

  /**
   * Notifies the scheduler that a task has completed
   * @param taskId The ID of the completed task
   */
  onTaskCompleted(taskId: unknown): void;

  /**
   * Resets the scheduler state
   */
  reset(): void;
}

/**
 * Sequential scheduler that executes one task at a time in topological order
 * Useful for debugging and understanding task execution flow
 */
export class TopologicalScheduler implements ITaskGraphScheduler {
  private sortedNodes: ITask[];
  private currentIndex: number;

  constructor(private dag: TaskGraph) {
    this.sortedNodes = [];
    this.currentIndex = 0;
    this.reset();
  }

  async *tasks(): AsyncIterableIterator<ITask> {
    while (this.currentIndex < this.sortedNodes.length) {
      yield this.sortedNodes[this.currentIndex++];
    }
  }

  onTaskCompleted(taskId: unknown): void {
    // Topological scheduler doesn't need to track individual task completion
  }

  reset(): void {
    this.sortedNodes = this.dag.topologicallySortedNodes();
    this.currentIndex = 0;
  }
}

/**
 * Event-driven scheduler that executes tasks as soon as their dependencies are satisfied
 * Most efficient for parallel execution but requires completion notifications
 */
export class DependencyBasedScheduler implements ITaskGraphScheduler {
  private completedTasks: Set<unknown>;
  private pendingTasks: Set<ITask>;
  private nextResolver: ((task: ITask | null) => void) | null = null;

  constructor(private dag: TaskGraph) {
    this.completedTasks = new Set();
    this.pendingTasks = new Set();
    this.reset();
  }

  private isTaskReady(task: ITask): boolean {
    // DISABLED tasks are never ready - they should be skipped
    if (task.status === TaskStatus.DISABLED) {
      return false;
    }

    const sourceDataflows = this.dag.getSourceDataflows(task.config.id);

    // If task has incoming dataflows, check if all are DISABLED
    // (In that case, task will be disabled by propagateDisabledStatus, not ready to run)
    if (sourceDataflows.length > 0) {
      const allIncomingDisabled = sourceDataflows.every(
        (df) => df.status === TaskStatus.DISABLED
      );
      if (allIncomingDisabled) {
        return false;
      }
    }

    // A task is ready if all its non-disabled dependencies are completed
    // DISABLED dataflows are considered "satisfied" (their branch was not taken)
    const dependencies = sourceDataflows
      .filter((df) => df.status !== TaskStatus.DISABLED)
      .map((dataflow) => dataflow.sourceTaskId);

    return dependencies.every((dep) => this.completedTasks.has(dep));
  }

  private async waitForNextTask(): Promise<ITask | null> {
    if (this.pendingTasks.size === 0) return null;

    // Remove any disabled tasks from pending (they were disabled by propagateDisabledStatus)
    for (const task of Array.from(this.pendingTasks)) {
      if (task.status === TaskStatus.DISABLED) {
        this.pendingTasks.delete(task);
      }
    }

    if (this.pendingTasks.size === 0) return null;

    const readyTask = Array.from(this.pendingTasks).find((task) => this.isTaskReady(task));
    if (readyTask) {
      this.pendingTasks.delete(readyTask);
      return readyTask;
    }

    // If there are pending tasks but none are ready, wait for task completion
    if (this.pendingTasks.size > 0) {
      return new Promise((resolve) => {
        this.nextResolver = resolve;
      });
    }

    return null;
  }

  async *tasks(): AsyncIterableIterator<ITask> {
    while (this.pendingTasks.size > 0) {
      const task = await this.waitForNextTask();
      if (task) {
        yield task;
      } else {
        break;
      }
    }
  }

  onTaskCompleted(taskId: unknown): void {
    this.completedTasks.add(taskId);

    // Remove the completed task and any disabled tasks from pending.
    // This handles both normal completion (task was already removed when picked up,
    // so this is a no-op) and checkpoint-restore completion (task is still pending
    // and must be removed so it isn't re-scheduled).
    for (const task of Array.from(this.pendingTasks)) {
      if (task.config.id === taskId || task.status === TaskStatus.DISABLED) {
        this.pendingTasks.delete(task);
      }
    }

    // Check if any pending tasks are now ready
    if (this.nextResolver) {
      const readyTask = Array.from(this.pendingTasks).find((task) => this.isTaskReady(task));
      if (readyTask) {
        this.pendingTasks.delete(readyTask);
        const resolver = this.nextResolver;
        this.nextResolver = null;
        resolver(readyTask);
      } else if (this.pendingTasks.size === 0) {
        // No more pending tasks - resolve with null to signal completion
        const resolver = this.nextResolver;
        this.nextResolver = null;
        resolver(null);
      }
    }
  }

  reset(): void {
    this.completedTasks.clear();
    this.pendingTasks = new Set(this.dag.topologicallySortedNodes());
    this.nextResolver = null;
  }
}
