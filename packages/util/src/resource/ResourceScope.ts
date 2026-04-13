/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A keyed collection of async disposer functions for heavyweight resources.
 *
 * Task authors register disposers during execution. The caller who created
 * the scope decides when (or whether) to invoke them.
 *
 * First-registration-wins: if a key is already present, subsequent
 * registrations for that key are silently ignored.
 */
export class ResourceScope {
  private readonly disposers = new Map<string, () => Promise<void>>();

  /**
   * Register a disposer under the given key.
   * If the key already exists, the call is a no-op (first registration wins).
   */
  register(key: string, disposer: () => Promise<void>): void {
    if (!this.disposers.has(key)) {
      this.disposers.set(key, disposer);
    }
  }

  /**
   * Call and remove the disposer for the given key.
   * No-op if the key does not exist. Errors propagate to the caller.
   */
  async dispose(key: string): Promise<void> {
    const disposer = this.disposers.get(key);
    if (disposer) {
      this.disposers.delete(key);
      await disposer();
    }
  }

  /**
   * Call all disposers via Promise.allSettled (best-effort), then clear.
   * Individual disposer errors are silently swallowed.
   */
  async disposeAll(): Promise<void> {
    const fns = [...this.disposers.values()];
    this.disposers.clear();
    await Promise.allSettled(fns.map((fn) => fn()));
  }

  /** Check if a key is registered. */
  has(key: string): boolean {
    return this.disposers.has(key);
  }

  /** Iterate registered keys. */
  keys(): IterableIterator<string> {
    return this.disposers.keys();
  }

  /** Number of registered disposers. */
  get size(): number {
    return this.disposers.size;
  }

  /** Support `await using scope = new ResourceScope()`. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.disposeAll();
  }
}
