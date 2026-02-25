/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * FIFO mutual-exclusion lock using promise chaining.
 *
 * Operations against a single resource are serialized in order,
 * but different resources (with different FifoMutex instances) can run concurrently.
 */
export class FifoMutex {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Execute `fn` exclusively. Callers are queued in FIFO order.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
