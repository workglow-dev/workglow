/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import * as SqliteNamespace from "bun:sqlite";
/** Re-export bun:sqlite as Sqlite for @workglow/sqlite API. */
const Sqlite = SqliteNamespace;
export { Sqlite };
