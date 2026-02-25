/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A handler that performs cleanup when a run completes.
 */
export type RunCleanupHandler = () => void | Promise<void>;

/**
 * Run-scoped cleanup registry.
 *
 * Handlers are deduplicated by key and execute at-most-once.
 * If a handler is registered after `runAll()` has been called,
 * it executes immediately to prevent resource leaks.
 */
export class RunCleanupRegistry {
  private handlers = new Map<string, RunCleanupHandler>();
  private completed = false;

  /**
   * Register a cleanup handler. If the registry has already completed,
   * the handler fires immediately (best-effort, errors swallowed).
   */
  add(key: string, handler: RunCleanupHandler): void {
    if (this.completed) {
      void Promise.resolve(handler()).catch(() => {});
      return;
    }
    this.handlers.set(key, handler);
  }

  /**
   * Remove a cleanup handler by key.
   */
  remove(key: string): void {
    this.handlers.delete(key);
  }

  /**
   * Execute all registered handlers.
   *
   * @param opts.mode - "parallel" (default) runs all concurrently; "lifo" runs in reverse registration order.
   * @param opts.concurrency - Maximum concurrent handlers (default Infinity).
   */
  async runAll(opts?: { mode?: "parallel" | "lifo"; concurrency?: number }): Promise<void> {
    if (this.completed) return;
    this.completed = true;

    const mode = opts?.mode ?? "parallel";
    const concurrency = opts?.concurrency ?? Infinity;

    const entries = Array.from(this.handlers.entries());
    this.handlers.clear();

    const ordered = mode === "lifo" ? entries.reverse() : entries;

    const queue = ordered.slice();
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const entry = queue.shift();
        if (!entry) break;
        const [, fn] = entry;
        try {
          await fn();
        } catch {
          // Registry cleanup is best-effort; errors are swallowed.
        }
      }
    });
    await Promise.all(workers);
  }

  /**
   * Whether cleanup has already run.
   */
  get isCompleted(): boolean {
    return this.completed;
  }
}
