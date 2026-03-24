/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Database as BunNativeDatabase, type Statement as BunStatement } from "bun:sqlite";

import type { SqliteApi } from "./canonical-api";

export type { SqliteApi };

function toRunResult(changes: number, lastInsertRowid: number | bigint): SqliteApi.RunResult {
  return { changes, lastInsertRowid };
}

class BunStatementAdapter<
  BindParameters extends unknown[] | Record<string, unknown> = unknown[],
  Result = unknown,
> implements SqliteApi.Statement<BindParameters, Result> {
  readonly #stmt: BunStatement<Result, any>;

  constructor(stmt: BunStatement<Result, any>) {
    this.#stmt = stmt;
  }

  run(...params: unknown[]): SqliteApi.RunResult {
    const meta = this.#stmt.run(...(params as never[]));
    return toRunResult(meta.changes, meta.lastInsertRowid);
  }

  get(...params: unknown[]): Result | undefined {
    const row = this.#stmt.get(...(params as never[]));
    return row === null ? undefined : row;
  }

  all(...params: unknown[]): Result[] {
    return this.#stmt.all(...(params as never[]));
  }

  finalize(): void {
    this.#stmt.finalize();
  }
}

/**
 * Bun `bun:sqlite` database wrapped to match {@link SqliteApi.Database}:
 * `prepare<Bind, Result>` uses bindings-first generics; `get()` maps `null` → `undefined`.
 */
export class BunSqliteDatabase implements SqliteApi.Database {
  readonly #db: InstanceType<typeof BunNativeDatabase>;

  constructor(filename?: string, options?: number | import("bun:sqlite").DatabaseOptions) {
    this.#db = new BunNativeDatabase(filename, options);
  }

  exec(sql: string): void {
    this.#db.run(sql);
  }

  prepare<BindParameters extends unknown[] | Record<string, unknown> = unknown[], Result = unknown>(
    sql: string
  ): SqliteApi.Statement<BindParameters, Result> {
    // bun:sqlite uses prepare<ReturnType, ParamsType> — flip at the boundary only.
    const stmt = this.#db.prepare<Result, any>(sql);
    return new BunStatementAdapter<BindParameters, Result>(stmt);
  }

  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
    const tx = this.#db.transaction(fn);
    return (...args: T) => {
      tx(...args);
    };
  }

  close(): void {
    this.#db.close();
  }

  loadExtension(path: string, entryPoint?: string): void {
    this.#db.loadExtension(path, entryPoint);
  }
}

export const Sqlite = {
  Database: BunSqliteDatabase,
};

export namespace Sqlite {
  export type Database = BunSqliteDatabase;
}
