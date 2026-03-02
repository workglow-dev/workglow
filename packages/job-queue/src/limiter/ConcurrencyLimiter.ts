/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import { ILimiter } from "./ILimiter";

export const CONCURRENT_JOB_LIMITER = createServiceToken<ILimiter>("jobqueue.limiter.concurrent");

/**
 * Concurrency limiter that limits the number of concurrent jobs.
 */
export class ConcurrencyLimiter implements ILimiter {
  private currentRunningJobs: number = 0;
  private readonly maxConcurrentJobs: number;
  private readonly pollIntervalMs: number;
  private nextAllowedStartTime: Date = new Date();

  constructor(maxConcurrentJobs: number, pollIntervalMs: number = 100) {
    this.maxConcurrentJobs = maxConcurrentJobs;
    this.pollIntervalMs = pollIntervalMs;
  }

  async canProceed(): Promise<boolean> {
    return (
      this.currentRunningJobs < this.maxConcurrentJobs &&
      Date.now() >= this.nextAllowedStartTime.getTime()
    );
  }

  async recordJobStart(): Promise<void> {
    this.currentRunningJobs++;
  }

  async recordJobCompletion(): Promise<void> {
    this.currentRunningJobs = Math.max(0, this.currentRunningJobs - 1);
  }

  async getNextAvailableTime(): Promise<Date> {
    return this.currentRunningJobs < this.maxConcurrentJobs
      ? new Date()
      : new Date(Date.now() + this.pollIntervalMs);
  }

  async setNextAvailableTime(date: Date): Promise<void> {
    if (date > this.nextAllowedStartTime) {
      this.nextAllowedStartTime = date;
    }
  }

  async clear(): Promise<void> {
    this.currentRunningJobs = 0;
    this.nextAllowedStartTime = new Date();
  }
}
