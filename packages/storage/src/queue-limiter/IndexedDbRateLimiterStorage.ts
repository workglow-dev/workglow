/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import {
  ensureIndexedDbTable,
  ExpectedIndexDefinition,
  MigrationOptions,
} from "../util/IndexedDbTable";
import type { PrefixColumn } from "../queue/IQueueStorage";
import { IRateLimiterStorage, RateLimiterStorageOptions } from "./IRateLimiterStorage";

export const INDEXED_DB_RATE_LIMITER_STORAGE = createServiceToken<IRateLimiterStorage>(
  "ratelimiter.storage.indexedDb"
);

/**
 * Extended options for IndexedDB rate limiter storage including prefix support.
 */
export interface IndexedDbRateLimiterStorageOptions
  extends RateLimiterStorageOptions, MigrationOptions {}

/**
 * Execution record stored in IndexedDB.
 */
interface ExecutionRecord {
  readonly id?: string;
  readonly queue_name: string;
  readonly executed_at: string;
  readonly [key: string]: unknown;
}

/**
 * Next available record stored in IndexedDB.
 */
interface NextAvailableRecord {
  readonly queue_name: string;
  readonly next_available_at: string;
  readonly [key: string]: unknown;
}

/**
 * IndexedDB implementation of rate limiter storage.
 * Manages execution records and next available times for rate limiting.
 */
export class IndexedDbRateLimiterStorage implements IRateLimiterStorage {
  private executionDb: IDBDatabase | undefined;
  private nextAvailableDb: IDBDatabase | undefined;
  private readonly executionTableName: string;
  private readonly nextAvailableTableName: string;
  private readonly migrationOptions: MigrationOptions;
  /** The prefix column definitions */
  protected readonly prefixes: readonly PrefixColumn[];
  /** The prefix values for filtering */
  protected readonly prefixValues: Readonly<Record<string, string | number>>;

  constructor(options: IndexedDbRateLimiterStorageOptions = {}) {
    this.migrationOptions = options;
    this.prefixes = options.prefixes ?? [];
    this.prefixValues = options.prefixValues ?? {};

    // Generate table names based on prefix configuration
    if (this.prefixes.length > 0) {
      const prefixNames = this.prefixes.map((p) => p.name).join("_");
      this.executionTableName = `rate_limit_executions_${prefixNames}`;
      this.nextAvailableTableName = `rate_limit_next_available_${prefixNames}`;
    } else {
      this.executionTableName = "rate_limit_executions";
      this.nextAvailableTableName = "rate_limit_next_available";
    }
  }

  /**
   * Gets prefix column names for use in indexes.
   */
  private getPrefixColumnNames(): string[] {
    return this.prefixes.map((p) => p.name);
  }

  /**
   * Checks if a record matches the current prefix values.
   */
  private matchesPrefixes(record: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(this.prefixValues)) {
      if (record[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Gets prefix values as an array in column order for index key construction.
   */
  private getPrefixKeyValues(): Array<string | number> {
    return this.prefixes.map((p) => this.prefixValues[p.name]);
  }

  private async getExecutionDb(): Promise<IDBDatabase> {
    if (this.executionDb) return this.executionDb;
    await this.setupDatabase();
    return this.executionDb!;
  }

  private async getNextAvailableDb(): Promise<IDBDatabase> {
    if (this.nextAvailableDb) return this.nextAvailableDb;
    await this.setupDatabase();
    return this.nextAvailableDb!;
  }

  public async setupDatabase(): Promise<void> {
    const prefixColumnNames = this.getPrefixColumnNames();

    // Build index key paths with prefixes prepended
    const buildKeyPath = (basePath: string[]): string[] => {
      return [...prefixColumnNames, ...basePath];
    };

    // Set up execution tracking table
    const executionIndexes: ExpectedIndexDefinition[] = [
      {
        name: "queue_executed_at",
        keyPath: buildKeyPath(["queue_name", "executed_at"]),
        options: { unique: false },
      },
    ];

    this.executionDb = await ensureIndexedDbTable(
      this.executionTableName,
      "id",
      executionIndexes,
      this.migrationOptions
    );

    // Set up next available table
    const nextAvailableIndexes: ExpectedIndexDefinition[] = [
      {
        name: "queue_name",
        keyPath: buildKeyPath(["queue_name"]),
        options: { unique: true },
      },
    ];

    this.nextAvailableDb = await ensureIndexedDbTable(
      this.nextAvailableTableName,
      buildKeyPath(["queue_name"]).join("_"),
      nextAvailableIndexes,
      this.migrationOptions
    );
  }

  public async recordExecution(queueName: string): Promise<void> {
    const db = await this.getExecutionDb();
    const tx = db.transaction(this.executionTableName, "readwrite");
    const store = tx.objectStore(this.executionTableName);

    const record: ExecutionRecord = {
      id: crypto.randomUUID(),
      queue_name: queueName,
      executed_at: new Date().toISOString(),
    };

    // Add prefix values to the record
    for (const [key, value] of Object.entries(this.prefixValues)) {
      (record as Record<string, unknown>)[key] = value;
    }

    return new Promise((resolve, reject) => {
      const request = store.add(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    });
  }

  public async getExecutionCount(queueName: string, windowStartTime: string): Promise<number> {
    const db = await this.getExecutionDb();
    const tx = db.transaction(this.executionTableName, "readonly");
    const store = tx.objectStore(this.executionTableName);
    const index = store.index("queue_executed_at");
    const prefixKeyValues = this.getPrefixKeyValues();

    return new Promise((resolve, reject) => {
      let count = 0;
      const keyRange = IDBKeyRange.bound(
        [...prefixKeyValues, queueName, windowStartTime],
        [...prefixKeyValues, queueName, "\uffff"],
        true, // exclude lower bound (windowStartTime)
        false
      );
      const request = index.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const record = cursor.value as ExecutionRecord;
          if (this.matchesPrefixes(record)) {
            count++;
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(count);
      tx.onerror = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    });
  }

  public async getOldestExecutionAtOffset(
    queueName: string,
    offset: number
  ): Promise<string | undefined> {
    const db = await this.getExecutionDb();
    const tx = db.transaction(this.executionTableName, "readonly");
    const store = tx.objectStore(this.executionTableName);
    const index = store.index("queue_executed_at");
    const prefixKeyValues = this.getPrefixKeyValues();

    return new Promise((resolve, reject) => {
      const executions: string[] = [];
      const keyRange = IDBKeyRange.bound(
        [...prefixKeyValues, queueName, ""],
        [...prefixKeyValues, queueName, "\uffff"]
      );
      const request = index.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const record = cursor.value as ExecutionRecord;
          if (this.matchesPrefixes(record)) {
            executions.push(record.executed_at);
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        // Sort by executed_at ascending
        executions.sort();
        resolve(executions[offset]);
      };
      tx.onerror = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    });
  }

  public async getNextAvailableTime(queueName: string): Promise<string | undefined> {
    const db = await this.getNextAvailableDb();
    const tx = db.transaction(this.nextAvailableTableName, "readonly");
    const store = tx.objectStore(this.nextAvailableTableName);
    const prefixKeyValues = this.getPrefixKeyValues();
    const key = [...prefixKeyValues, queueName].join("_");

    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const record = request.result as NextAvailableRecord | undefined;
        if (record && this.matchesPrefixes(record)) {
          resolve(record.next_available_at);
        } else {
          resolve(undefined);
        }
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  public async setNextAvailableTime(queueName: string, nextAvailableAt: string): Promise<void> {
    const db = await this.getNextAvailableDb();
    const tx = db.transaction(this.nextAvailableTableName, "readwrite");
    const store = tx.objectStore(this.nextAvailableTableName);
    const prefixKeyValues = this.getPrefixKeyValues();
    const key = [...prefixKeyValues, queueName].join("_");

    const record: NextAvailableRecord & { [key: string]: unknown } = {
      queue_name: queueName,
      next_available_at: nextAvailableAt,
    };

    // Add prefix values to the record
    for (const [k, value] of Object.entries(this.prefixValues)) {
      record[k] = value;
    }

    // Set the key field
    (record as Record<string, unknown>)[
      this.getPrefixColumnNames().concat(["queue_name"]).join("_")
    ] = key;

    return new Promise((resolve, reject) => {
      const request = store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    });
  }

  public async clear(queueName: string): Promise<void> {
    // Clear executions
    const execDb = await this.getExecutionDb();
    const execTx = execDb.transaction(this.executionTableName, "readwrite");
    const execStore = execTx.objectStore(this.executionTableName);
    const execIndex = execStore.index("queue_executed_at");
    const prefixKeyValues = this.getPrefixKeyValues();

    await new Promise<void>((resolve, reject) => {
      const keyRange = IDBKeyRange.bound(
        [...prefixKeyValues, queueName, ""],
        [...prefixKeyValues, queueName, "\uffff"]
      );
      const request = execIndex.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const record = cursor.value as ExecutionRecord;
          if (this.matchesPrefixes(record)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };

      execTx.oncomplete = () => resolve();
      execTx.onerror = () => reject(execTx.error);
      request.onerror = () => reject(request.error);
    });

    // Clear next available
    const nextDb = await this.getNextAvailableDb();
    const nextTx = nextDb.transaction(this.nextAvailableTableName, "readwrite");
    const nextStore = nextTx.objectStore(this.nextAvailableTableName);
    const key = [...prefixKeyValues, queueName].join("_");

    await new Promise<void>((resolve, reject) => {
      const request = nextStore.delete(key);
      nextTx.oncomplete = () => resolve();
      nextTx.onerror = () => reject(nextTx.error);
      request.onerror = () => reject(request.error);
    });
  }
}
