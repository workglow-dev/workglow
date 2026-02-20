/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BaseTabularStorage } from "@workglow/storage";
import { compress, DataPortSchemaObject, decompress } from "@workglow/util";
import { CheckpointSaver } from "./CheckpointSaver";
import type { CheckpointData, CheckpointId, ThreadId } from "./CheckpointTypes";

export const CheckpointSchema = {
  type: "object",
  properties: {
    checkpoint_id: { type: "string" },
    thread_id: { type: "string" },
    parent_checkpoint_id: { type: "string" },
    graph_json: { type: "string", contentEncoding: "blob" },
    task_states: { type: "string", contentEncoding: "blob" },
    dataflow_states: { type: "string", contentEncoding: "blob" },
    metadata: { type: "string" },
    created_at: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} satisfies DataPortSchemaObject;

export const CheckpointPrimaryKeyNames = ["checkpoint_id"] as const;

export type CheckpointStorage = BaseTabularStorage<
  typeof CheckpointSchema,
  typeof CheckpointPrimaryKeyNames
>;

export type TabularCheckpointSaverOptions = {
  tabularRepository: CheckpointStorage;
  compression?: boolean;
};

/**
 * Tabular storage implementation of CheckpointSaver.
 * Uses the existing ITabularStorage interface for persistence,
 * giving access to SQLite, Postgres, IndexedDB, Supabase, and
 * file-backed checkpoint storage via existing backends.
 */
export class TabularCheckpointSaver extends CheckpointSaver {
  tabularRepository: CheckpointStorage;
  compression: boolean;

  constructor({ tabularRepository, compression = true }: TabularCheckpointSaverOptions) {
    super();
    this.tabularRepository = tabularRepository;
    this.compression = compression;
  }

  async setupDatabase(): Promise<void> {
    await this.tabularRepository.setupDatabase?.();
  }

  private async compressJson(value: string): Promise<unknown> {
    if (this.compression) {
      return (await compress(value)) as unknown;
    }
    return Buffer.from(value) as unknown;
  }

  private async decompressJson(raw: unknown): Promise<string> {
    if (this.compression) {
      const bytes: Uint8Array =
        raw instanceof Uint8Array
          ? raw
          : Array.isArray(raw)
            ? new Uint8Array(raw as number[])
            : raw && typeof raw === "object"
              ? new Uint8Array(
                  Object.keys(raw as Record<string, number>)
                    .filter((k) => /^\d+$/.test(k))
                    .sort((a, b) => Number(a) - Number(b))
                    .map((k) => (raw as Record<string, number>)[k])
                )
              : new Uint8Array();
      return await decompress(bytes);
    }
    return (raw as Buffer).toString();
  }

  async saveCheckpoint(data: CheckpointData): Promise<void> {
    await this.tabularRepository.put({
      checkpoint_id: data.checkpointId,
      thread_id: data.threadId,
      parent_checkpoint_id: data.parentCheckpointId ?? "",
      graph_json: (await this.compressJson(JSON.stringify(data.graphJson))) as string,
      task_states: (await this.compressJson(JSON.stringify(data.taskStates))) as string,
      dataflow_states: (await this.compressJson(JSON.stringify(data.dataflowStates))) as string,
      metadata: JSON.stringify(data.metadata),
      created_at: data.metadata.createdAt,
    });
  }

  async getCheckpoint(checkpointId: CheckpointId): Promise<CheckpointData | undefined> {
    const row = await this.tabularRepository.get({ checkpoint_id: checkpointId });
    if (!row) return undefined;
    return this.rowToCheckpointData(row);
  }

  async getLatestCheckpoint(threadId: ThreadId): Promise<CheckpointData | undefined> {
    const rows = await this.tabularRepository.search({ thread_id: threadId });
    if (!rows || rows.length === 0) return undefined;

    // Sort by created_at descending and return the latest
    rows.sort((a, b) => {
      const aTime = a.created_at ?? "";
      const bTime = b.created_at ?? "";
      return bTime.localeCompare(aTime);
    });

    return this.rowToCheckpointData(rows[0]);
  }

  async getCheckpointHistory(threadId: ThreadId): Promise<CheckpointData[]> {
    const rows = await this.tabularRepository.search({ thread_id: threadId });
    if (!rows || rows.length === 0) return [];

    // Sort by created_at ascending
    rows.sort((a, b) => {
      const aTime = a.created_at ?? "";
      const bTime = b.created_at ?? "";
      return aTime.localeCompare(bTime);
    });

    const results: CheckpointData[] = [];
    for (const row of rows) {
      results.push(await this.rowToCheckpointData(row));
    }
    return results;
  }

  async getCheckpointsForIteration(
    threadId: ThreadId,
    iterationParentTaskId: unknown
  ): Promise<CheckpointData[]> {
    const history = await this.getCheckpointHistory(threadId);
    return history.filter((cp) => cp.metadata.iterationParentTaskId === iterationParentTaskId);
  }

  async deleteCheckpoints(threadId: ThreadId): Promise<void> {
    await this.tabularRepository.deleteSearch({ thread_id: threadId });
  }

  private async rowToCheckpointData(row: Record<string, unknown>): Promise<CheckpointData> {
    const graphJson = JSON.parse(await this.decompressJson(row.graph_json));
    const taskStates = JSON.parse(await this.decompressJson(row.task_states));
    const dataflowStates = JSON.parse(await this.decompressJson(row.dataflow_states));
    const metadata = JSON.parse(row.metadata as string);

    return {
      checkpointId: row.checkpoint_id as string,
      threadId: row.thread_id as string,
      parentCheckpointId:
        (row.parent_checkpoint_id as string) === ""
          ? undefined
          : (row.parent_checkpoint_id as string),
      graphJson,
      taskStates,
      dataflowStates,
      metadata,
    };
  }
}
