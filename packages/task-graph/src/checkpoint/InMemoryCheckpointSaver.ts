/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CheckpointSaver } from "./CheckpointSaver";
import type { CheckpointData, CheckpointId, ThreadId } from "./CheckpointTypes";

/**
 * In-memory implementation of CheckpointSaver.
 * Uses a Map with a secondary index on threadId for efficient lookups.
 */
export class InMemoryCheckpointSaver extends CheckpointSaver {
  private checkpoints: Map<CheckpointId, CheckpointData> = new Map();
  private threadIndex: Map<ThreadId, CheckpointId[]> = new Map();
  private readonly maxCheckpointsPerThread: number;

  constructor(maxCheckpointsPerThread: number = 1000) {
    super();
    this.maxCheckpointsPerThread = maxCheckpointsPerThread;
  }

  async saveCheckpoint(data: CheckpointData): Promise<void> {
    this.checkpoints.set(data.checkpointId, data);

    const threadCheckpoints = this.threadIndex.get(data.threadId) ?? [];
    threadCheckpoints.push(data.checkpointId);

    if (threadCheckpoints.length > this.maxCheckpointsPerThread) {
      const excess = threadCheckpoints.length - this.maxCheckpointsPerThread;
      const removedIds = threadCheckpoints.splice(0, excess);
      for (const id of removedIds) {
        this.checkpoints.delete(id);
      }
    }

    this.threadIndex.set(data.threadId, threadCheckpoints);
  }

  async getCheckpoint(checkpointId: CheckpointId): Promise<CheckpointData | undefined> {
    return this.checkpoints.get(checkpointId);
  }

  async getLatestCheckpoint(threadId: ThreadId): Promise<CheckpointData | undefined> {
    const ids = this.threadIndex.get(threadId);
    if (!ids || ids.length === 0) return undefined;
    return this.checkpoints.get(ids[ids.length - 1]);
  }

  async getCheckpointHistory(threadId: ThreadId): Promise<CheckpointData[]> {
    const ids = this.threadIndex.get(threadId);
    if (!ids) return [];
    return ids
      .map((id) => this.checkpoints.get(id))
      .filter((cp): cp is CheckpointData => cp !== undefined);
  }

  async getCheckpointsForIteration(
    threadId: ThreadId,
    iterationParentTaskId: unknown
  ): Promise<CheckpointData[]> {
    const history = await this.getCheckpointHistory(threadId);
    return history.filter((cp) => cp.metadata.iterationParentTaskId === iterationParentTaskId);
  }

  async deleteCheckpoints(threadId: ThreadId): Promise<void> {
    const ids = this.threadIndex.get(threadId);
    if (ids) {
      for (const id of ids) {
        this.checkpoints.delete(id);
      }
      this.threadIndex.delete(threadId);
    }
  }
}
