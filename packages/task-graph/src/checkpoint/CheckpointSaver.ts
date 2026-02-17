/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { CheckpointData, CheckpointId, ThreadId } from "./CheckpointTypes";

/**
 * Service token for CheckpointSaver
 */
export const CHECKPOINT_SAVER = createServiceToken<CheckpointSaver>("taskgraph.checkpointSaver");

/**
 * Abstract class for saving and retrieving execution checkpoints.
 * Implementations provide persistence for checkpoint data to enable
 * resume-from-failure and execution history features.
 */
export abstract class CheckpointSaver {
  abstract saveCheckpoint(data: CheckpointData): Promise<void>;
  abstract getCheckpoint(checkpointId: CheckpointId): Promise<CheckpointData | undefined>;
  abstract getLatestCheckpoint(threadId: ThreadId): Promise<CheckpointData | undefined>;
  abstract getCheckpointHistory(threadId: ThreadId): Promise<CheckpointData[]>;
  abstract getCheckpointsForIteration(
    threadId: ThreadId,
    iterationParentTaskId: unknown
  ): Promise<CheckpointData[]>;
  abstract deleteCheckpoints(threadId: ThreadId): Promise<void>;
}
