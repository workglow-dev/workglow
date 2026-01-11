/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { PrefixColumn } from "../queue/IQueueStorage";

export const RATE_LIMITER_STORAGE = createServiceToken<IRateLimiterStorage>("ratelimiter.storage");

/**
 * Options for configuring rate limiter storage with prefix filters.
 */
export interface RateLimiterStorageOptions {
  /** The prefix column definitions for this storage */
  readonly prefixes?: readonly PrefixColumn[];
  /** The values for each prefix column */
  readonly prefixValues?: Readonly<Record<string, string | number>>;
}

/**
 * Record of a job execution for rate limiting tracking.
 */
export interface ExecutionRecord {
  readonly id?: unknown;
  readonly queue_name: string;
  readonly executed_at: string;
}

/**
 * Record of the next available time for a queue.
 */
export interface NextAvailableRecord {
  readonly queue_name: string;
  readonly next_available_at: string;
}

/**
 * Interface defining the storage operations for a rate limiter.
 * This separates the storage concerns from the rate limiting logic.
 */
export interface IRateLimiterStorage {
  /**
   * Sets up the database schema and tables.
   * This method should be called before using the storage.
   * For production use, database setup should be done via migrations.
   */
  setupDatabase(): Promise<void>;

  /**
   * Records a job execution for rate limiting tracking.
   * @param queueName - The name of the queue
   */
  recordExecution(queueName: string): Promise<void>;

  /**
   * Gets the count of executions within a time window.
   * @param queueName - The name of the queue
   * @param windowStartTime - The start of the time window (ISO string)
   * @returns The count of executions within the window
   */
  getExecutionCount(queueName: string, windowStartTime: string): Promise<number>;

  /**
   * Gets the oldest execution time within the window, offset by a count.
   * Used to calculate when the rate limit will allow the next execution.
   * @param queueName - The name of the queue
   * @param offset - The offset (typically maxExecutions - 1)
   * @returns The execution time or undefined if not enough executions
   */
  getOldestExecutionAtOffset(queueName: string, offset: number): Promise<string | undefined>;

  /**
   * Gets the next available time for a queue.
   * @param queueName - The name of the queue
   * @returns The next available time or undefined if not set
   */
  getNextAvailableTime(queueName: string): Promise<string | undefined>;

  /**
   * Sets the next available time for a queue.
   * @param queueName - The name of the queue
   * @param nextAvailableAt - The next available time (ISO string)
   */
  setNextAvailableTime(queueName: string, nextAvailableAt: string): Promise<void>;

  /**
   * Clears all rate limit entries for a queue.
   * @param queueName - The name of the queue
   */
  clear(queueName: string): Promise<void>;
}
