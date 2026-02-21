/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";

export type RunCleanupHandler = () => void | Promise<void>;

/**
 * Service token for run-scoped cleanup registry.
 * A fresh registry instance is created per TaskGraph run.
 */
export const RUN_CLEANUP_REGISTRY = createServiceToken<RunCleanupRegistry>(
  "taskgraph.runCleanupRegistry"
);

/**
 * Registry of cleanup callbacks to run when a graph execution ends.
 * Callbacks are deduplicated by key and executed at most once per run.
 */
export class RunCleanupRegistry {
  private handlers = new Map<string, RunCleanupHandler>();
  private completed = false;

  public add(key: string, handler: RunCleanupHandler): void {
    if (this.completed) {
      // If cleanup already ran, execute immediately so callers don't leak resources.
      void Promise.resolve(handler()).catch(() => {});
      return;
    }
    this.handlers.set(key, handler);
  }

  public async runAll(): Promise<void> {
    if (this.completed) return;
    this.completed = true;

    const handlers = Array.from(this.handlers.values());
    this.handlers.clear();
    await Promise.allSettled(handlers.map(async (handler) => await handler()));
  }
}

