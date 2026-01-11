/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceToken } from "@workglow/util";
import type { PrefixColumn } from "../queue/IQueueStorage";
import { IRateLimiterStorage, RateLimiterStorageOptions } from "./IRateLimiterStorage";

export const SUPABASE_RATE_LIMITER_STORAGE = createServiceToken<IRateLimiterStorage>(
  "ratelimiter.storage.supabase"
);

/**
 * Supabase implementation of rate limiter storage.
 * Manages execution records and next available times for rate limiting.
 */
export class SupabaseRateLimiterStorage implements IRateLimiterStorage {
  /** The prefix column definitions */
  protected readonly prefixes: readonly PrefixColumn[];
  /** The prefix values for filtering */
  protected readonly prefixValues: Readonly<Record<string, string | number>>;
  /** The table name for execution tracking */
  protected readonly executionTableName: string;
  /** The table name for next available times */
  protected readonly nextAvailableTableName: string;

  constructor(
    protected readonly client: SupabaseClient,
    options?: RateLimiterStorageOptions
  ) {
    this.prefixes = options?.prefixes ?? [];
    this.prefixValues = options?.prefixValues ?? {};

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
   * Gets the SQL column type for a prefix column (Supabase supports UUID natively).
   */
  private getPrefixColumnType(type: PrefixColumn["type"]): string {
    return type === "uuid" ? "UUID" : "INTEGER";
  }

  /**
   * Builds the prefix columns SQL for CREATE TABLE.
   */
  private buildPrefixColumnsSql(): string {
    if (this.prefixes.length === 0) return "";
    return (
      this.prefixes
        .map((p) => `${p.name} ${this.getPrefixColumnType(p.type)} NOT NULL`)
        .join(",\n        ") + ",\n        "
    );
  }

  /**
   * Builds prefix column names for use in queries.
   */
  private getPrefixColumnNames(): string[] {
    return this.prefixes.map((p) => p.name);
  }

  /**
   * Applies prefix filters to a Supabase query builder.
   */
  private applyPrefixFilters<T>(query: T): T {
    let result = query as any;
    for (const prefix of this.prefixes) {
      result = result.eq(prefix.name, this.prefixValues[prefix.name]);
    }
    return result as T;
  }

  /**
   * Gets prefix values as an object for inserts.
   */
  private getPrefixInsertValues(): Record<string, string | number> {
    const values: Record<string, string | number> = {};
    for (const prefix of this.prefixes) {
      values[prefix.name] = this.prefixValues[prefix.name];
    }
    return values;
  }

  public async setupDatabase(): Promise<void> {
    const prefixColumnsSql = this.buildPrefixColumnsSql();
    const prefixColumnNames = this.getPrefixColumnNames();
    const prefixIndexPrefix =
      prefixColumnNames.length > 0 ? prefixColumnNames.join(", ") + ", " : "";
    const indexSuffix = prefixColumnNames.length > 0 ? "_" + prefixColumnNames.join("_") : "";

    // Create execution tracking table
    const createExecTableSql = `
      CREATE TABLE IF NOT EXISTS ${this.executionTableName} (
        id SERIAL PRIMARY KEY,
        ${prefixColumnsSql}queue_name TEXT NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;

    const { error: execTableError } = await this.client.rpc("exec_sql", {
      query: createExecTableSql,
    });
    if (execTableError && execTableError.code !== "42P07") {
      throw execTableError;
    }

    // Create index on execution table
    const createExecIndexSql = `
      CREATE INDEX IF NOT EXISTS rate_limit_exec_queue${indexSuffix}_idx 
        ON ${this.executionTableName} (${prefixIndexPrefix}queue_name, executed_at)
    `;
    await this.client.rpc("exec_sql", { query: createExecIndexSql });

    // Build primary key columns
    const primaryKeyColumns =
      prefixColumnNames.length > 0 ? `${prefixColumnNames.join(", ")}, queue_name` : "queue_name";

    // Create next available table
    const createNextTableSql = `
      CREATE TABLE IF NOT EXISTS ${this.nextAvailableTableName} (
        ${prefixColumnsSql}queue_name TEXT NOT NULL,
        next_available_at TIMESTAMP WITH TIME ZONE,
        PRIMARY KEY (${primaryKeyColumns})
      )
    `;

    const { error: nextTableError } = await this.client.rpc("exec_sql", {
      query: createNextTableSql,
    });
    if (nextTableError && nextTableError.code !== "42P07") {
      throw nextTableError;
    }
  }

  public async recordExecution(queueName: string): Promise<void> {
    const prefixInsertValues = this.getPrefixInsertValues();

    const { error } = await this.client.from(this.executionTableName).insert({
      ...prefixInsertValues,
      queue_name: queueName,
    });

    if (error) throw error;
  }

  public async getExecutionCount(queueName: string, windowStartTime: string): Promise<number> {
    let query = this.client
      .from(this.executionTableName)
      .select("*", { count: "exact", head: true })
      .eq("queue_name", queueName)
      .gt("executed_at", windowStartTime);

    query = this.applyPrefixFilters(query);

    const { count, error } = await query;

    if (error) throw error;
    return count ?? 0;
  }

  public async getOldestExecutionAtOffset(
    queueName: string,
    offset: number
  ): Promise<string | undefined> {
    let query = this.client
      .from(this.executionTableName)
      .select("executed_at")
      .eq("queue_name", queueName);

    query = this.applyPrefixFilters(query);

    const { data, error } = await query
      .order("executed_at", { ascending: true })
      .range(offset, offset);

    if (error) throw error;
    if (!data || data.length === 0) return undefined;
    return new Date(data[0].executed_at).toISOString();
  }

  public async getNextAvailableTime(queueName: string): Promise<string | undefined> {
    let query = this.client
      .from(this.nextAvailableTableName)
      .select("next_available_at")
      .eq("queue_name", queueName);

    query = this.applyPrefixFilters(query);

    const { data, error } = await query.single();

    if (error) {
      if (error.code === "PGRST116") return undefined; // Not found
      throw error;
    }

    if (!data?.next_available_at) return undefined;
    return new Date(data.next_available_at).toISOString();
  }

  public async setNextAvailableTime(queueName: string, nextAvailableAt: string): Promise<void> {
    const prefixInsertValues = this.getPrefixInsertValues();

    const { error } = await this.client.from(this.nextAvailableTableName).upsert(
      {
        ...prefixInsertValues,
        queue_name: queueName,
        next_available_at: nextAvailableAt,
      },
      {
        onConflict:
          this.prefixes.length > 0
            ? `${this.getPrefixColumnNames().join(",")},queue_name`
            : "queue_name",
      }
    );

    if (error) throw error;
  }

  public async clear(queueName: string): Promise<void> {
    let execQuery = this.client.from(this.executionTableName).delete().eq("queue_name", queueName);
    execQuery = this.applyPrefixFilters(execQuery);
    const { error: execError } = await execQuery;
    if (execError) throw execError;

    let nextQuery = this.client
      .from(this.nextAvailableTableName)
      .delete()
      .eq("queue_name", queueName);
    nextQuery = this.applyPrefixFilters(nextQuery);
    const { error: nextError } = await nextQuery;
    if (nextError) throw nextError;
  }
}
