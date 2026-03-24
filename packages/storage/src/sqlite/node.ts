/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from "node:module";

import type { SqliteApi } from "./canonical-api";

export type { SqliteApi };

const require = createRequire(import.meta.url);

/** better-sqlite3 default export: `Database` constructor (value loaded lazily via `require`). */
type BetterSqliteDatabaseCtor = typeof import("better-sqlite3");

let DatabaseCtor: BetterSqliteDatabaseCtor | undefined;

function loadBetterSqliteSync(): BetterSqliteDatabaseCtor {
  if (!DatabaseCtor) {
    try {
      const mod = require("better-sqlite3") as
        | BetterSqliteDatabaseCtor
        | { default: BetterSqliteDatabaseCtor };
      DatabaseCtor =
        (mod as { default?: BetterSqliteDatabaseCtor }).default ??
        (mod as BetterSqliteDatabaseCtor);
    } catch {
      throw new Error(
        "better-sqlite3 is required for @workglow/storage/sqlite on Node.js. Install it with: bun add better-sqlite3"
      );
    }
  }
  return DatabaseCtor;
}

export const Sqlite: {
  get Database(): BetterSqliteDatabaseCtor;
} = {
  get Database(): BetterSqliteDatabaseCtor {
    return loadBetterSqliteSync();
  },
};

/** Merged with {@link Sqlite} so `Sqlite.Database` works in type positions (not only as a value). */
export namespace Sqlite {
  export type Database = InstanceType<BetterSqliteDatabaseCtor>;
}
