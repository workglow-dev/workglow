/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import bettersqlite from "better-sqlite3";

export type { SqliteApi } from "./canonical-api";

export const Sqlite: { Database: typeof bettersqlite } = {
  Database: bettersqlite,
};

/** Merged with {@link Sqlite} so `Sqlite.Database` works in type positions (not only as a value). */
export namespace Sqlite {
  export type Database = InstanceType<typeof bettersqlite>;
}
