/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresVectorStorage } from "@workglow/postgres/storage";
import type { AnyVectorStorage } from "@workglow/storage";
import { uuid4 } from "@workglow/util";
import type { Pool } from "pg";
import { afterAll } from "vitest";
import { runVectorStorageContract } from "../../contract/vector-storage/runVectorStorageContract";
import {
  VECTOR_DIMENSIONS,
  VectorItemPrimaryKeyNames,
  VectorItemSchema,
} from "../../contract/vector-storage/types";

// Its own instance rather than the validation suite's: that file closes its
// handle in an `afterAll`, which fires before a second top-level describe in
// the same file would run.
const db = new PGlite() as unknown as Pool;

afterAll(async () => {
  await (db as unknown as PGlite).close();
});

/**
 * The search half of this backend's contract. Its sibling
 * `PostgresVectorStorage.validation.test.ts` keeps what is specific to it — the
 * finite-number checks on a vector's individual components, which are about the
 * values rather than about what a search does with them.
 *
 * Nothing here was checked on this backend before. The seven cases that found
 * the equivalent break on SQLite were written against SQLite alone.
 */
runVectorStorageContract({
  name: "PostgresVectorStorage",
  capabilities: {
    supportsMetadataFilter: true,
    supportsScoreThreshold: true,
    supportsDimensionValidation: true,
  },
  createStorage: async (): Promise<AnyVectorStorage> =>
    new PostgresVectorStorage(
      db,
      `vec_contract_${uuid4().replace(/-/g, "_")}`,
      VectorItemSchema,
      VectorItemPrimaryKeyNames,
      [],
      VECTOR_DIMENSIONS
    ) as unknown as AnyVectorStorage,
});
