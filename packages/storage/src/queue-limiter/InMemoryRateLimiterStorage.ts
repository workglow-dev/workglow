/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, sleep } from "@workglow/util";
import { IRateLimiterStorage, RateLimiterStorageOptions } from "./IRateLimiterStorage";

export const IN_MEMORY_RATE_LIMITER_STORAGE = createServiceToken<IRateLimiterStorage>(
  "ratelimiter.storage.inMemory"
);

/**
 * Record of a job execution stored in memory.
 */
interface ExecutionEntry {
  readonly queueName: string;
  readonly executedAt: Date;
}

/**
 * In-memory implementation of rate limiter storage.
 * Manages execution records and next available times for rate limiting.
 */
export class InMemoryRateLimiterStorage implements IRateLimiterStorage {
  /** The prefix values for filtering */
  protected readonly prefixValues: Readonly<Record<string, string | number>>;

  /** Execution records keyed by a composite of prefix values and queue name */
  private readonly executions: Map<string, ExecutionEntry[]> = new Map();

  /** Next available times keyed by a composite of prefix values and queue name */
  private readonly nextAvailableTimes: Map<string, Date> = new Map();

  constructor(options?: RateLimiterStorageOptions) {
    this.prefixValues = options?.prefixValues ?? {};
  }

  /**
   * Creates a storage key from the queue name and prefix values.
   */
  private makeKey(queueName: string): string {
    const prefixPart = Object.entries(this.prefixValues)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join("|");
    return prefixPart ? `${prefixPart}|${queueName}` : queueName;
  }

  public async setupDatabase(): Promise<void> {
    // No-op for in-memory storage
  }

  public async recordExecution(queueName: string): Promise<void> {
    await sleep(0);
    const key = this.makeKey(queueName);
    const executions = this.executions.get(key) ?? [];
    executions.push({
      queueName,
      executedAt: new Date(),
    });
    this.executions.set(key, executions);
  }

  public async getExecutionCount(queueName: string, windowStartTime: string): Promise<number> {
    await sleep(0);
    const key = this.makeKey(queueName);
    const executions = this.executions.get(key) ?? [];
    const windowStart = new Date(windowStartTime);
    return executions.filter((e) => e.executedAt > windowStart).length;
  }

  public async getOldestExecutionAtOffset(
    queueName: string,
    offset: number
  ): Promise<string | undefined> {
    await sleep(0);
    const key = this.makeKey(queueName);
    const executions = this.executions.get(key) ?? [];
    const sorted = [...executions].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
    const execution = sorted[offset];
    return execution?.executedAt.toISOString();
  }

  public async getNextAvailableTime(queueName: string): Promise<string | undefined> {
    await sleep(0);
    const key = this.makeKey(queueName);
    const time = this.nextAvailableTimes.get(key);
    return time?.toISOString();
  }

  public async setNextAvailableTime(queueName: string, nextAvailableAt: string): Promise<void> {
    await sleep(0);
    const key = this.makeKey(queueName);
    this.nextAvailableTimes.set(key, new Date(nextAvailableAt));
  }

  public async clear(queueName: string): Promise<void> {
    await sleep(0);
    const key = this.makeKey(queueName);
    this.executions.delete(key);
    this.nextAvailableTimes.delete(key);
  }
}
