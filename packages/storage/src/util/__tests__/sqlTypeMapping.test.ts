/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mapPostgresType, TYPED_ARRAY_CTORS } from "@workglow/storage";
import type { JsonSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

// The real backends pass their null-stripping helper; for these schemas there
// is no nullable wrapper so an identity function is correct.
const options = { getNonNullType: (t: JsonSchema) => t };

describe("mapPostgresType integer range selection", () => {
  it("uses BIGINT for an unsigned maximum above INTEGER's range", () => {
    expect(mapPostgresType({ type: "integer", minimum: 0, maximum: 9999999999 }, options)).toBe(
      "BIGINT"
    );
  });

  it("uses BIGINT for a signed schema whose maximum exceeds INTEGER's range", () => {
    // Regression: a negative/absent minimum used to skip the maximum-based
    // range selection and fall through to INTEGER, overflowing at runtime.
    expect(mapPostgresType({ type: "integer", minimum: -1, maximum: 9999999999 }, options)).toBe(
      "BIGINT"
    );
  });

  it("uses BIGINT when only a large maximum is present (no minimum)", () => {
    expect(mapPostgresType({ type: "integer", maximum: 9999999999 }, options)).toBe("BIGINT");
  });

  it("uses BIGINT when the minimum is below INTEGER's lower bound", () => {
    expect(mapPostgresType({ type: "integer", minimum: -3000000000 }, options)).toBe("BIGINT");
  });

  it("keeps INTEGER for in-range signed schemas", () => {
    expect(mapPostgresType({ type: "integer", minimum: -100, maximum: 100 }, options)).toBe(
      "INTEGER"
    );
  });

  it("keeps SMALLINT / INTEGER for in-range unsigned schemas", () => {
    expect(mapPostgresType({ type: "integer", minimum: 0, maximum: 100 }, options)).toBe(
      "SMALLINT"
    );
    expect(mapPostgresType({ type: "integer", minimum: 0, maximum: 100000 }, options)).toBe(
      "INTEGER"
    );
  });
});

describe("mapPostgresType pgvector hook", () => {
  // What a backend that knows the width supplies; `undefined` is the base
  // class, which has no dimension to declare.
  const withVector = {
    ...options,
    vectorTypeFor: (t: Exclude<JsonSchema, boolean>) =>
      t.format === "TypedArray" ? "vector(4)" : undefined,
  };

  it("maps a TypedArray property to a vector column", () => {
    // The embedding schema every vector storage here is built on is an
    // *array*, not a string. While the hook was only consulted for
    // `type: "string"` these columns became `JSONB /* generic array */`, no
    // `vector_*_ops` index could be built over them, and every similarity
    // search fell back to scanning the table in memory.
    expect(mapPostgresType({ type: "array", format: "TypedArray" }, withVector)).toBe("vector(4)");
  });

  it("leaves the column JSONB when the backend declares no width", () => {
    expect(mapPostgresType({ type: "array", format: "TypedArray" }, options)).toBe(
      "JSONB /* generic array */"
    );
  });

  it("does not divert a column the hook declines", () => {
    expect(mapPostgresType({ type: "string" }, withVector)).toBe("TEXT");
    expect(mapPostgresType({ type: "object" }, withVector)).toBe("JSONB /* object */");
  });
});

describe("TYPED_ARRAY_CTORS", () => {
  it("includes Float16Array so documented quantized vectors decode", () => {
    // The util schema layer polyfills globalThis.Float16Array on older runtimes,
    // so this entry should be present in this test process.
    expect(TYPED_ARRAY_CTORS.Float16Array).toBeDefined();
    const arr = new TYPED_ARRAY_CTORS.Float16Array([1, 2, 3]) as ArrayBufferView & {
      length: number;
    };
    expect(arr.length).toBe(3);
  });

  it("includes the documented float/int constructors", () => {
    for (const name of [
      "Float32Array",
      "Float64Array",
      "Int8Array",
      "Uint8Array",
      "Int16Array",
      "Uint16Array",
    ]) {
      expect(TYPED_ARRAY_CTORS[name]).toBeDefined();
    }
  });
});
