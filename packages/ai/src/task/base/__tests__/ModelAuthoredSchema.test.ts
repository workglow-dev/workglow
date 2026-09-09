/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_MODEL_AUTHORED_SCHEMA_LIMITS, validateModelAuthoredSchema } from "@workglow/ai";
import { describe, expect, it } from "vitest";

const objectSchema = (properties: Record<string, unknown>) => ({ type: "object", properties });

describe("validateModelAuthoredSchema", () => {
  it("accepts an ordinary object schema", () => {
    const result = validateModelAuthoredSchema(
      objectSchema({ name: { type: "string", title: "Name" } })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects anything that is not an object schema at the root", () => {
    for (const bad of [null, undefined, 42, "s", [], { type: "string" }, { type: "object" }]) {
      expect(validateModelAuthoredSchema(bad).ok).toBe(false);
    }
  });

  it("rejects a format that resolves a live resource", () => {
    // In this codebase `format` selects a runtime editor and resolves a real
    // resource, so an unbounded format is the model picking one.
    for (const format of ["storage:tabular", "knowledge-base", "credential"]) {
      const result = validateModelAuthoredSchema(objectSchema({ f: { type: "string", format } }));
      expect(result.ok, format).toBe(false);
      if (!result.ok) expect(result.reason).toContain(format);
    }
  });

  it("allows a presentation format and a prefixed model format", () => {
    expect(
      validateModelAuthoredSchema(objectSchema({ d: { type: "string", format: "date" } })).ok
    ).toBe(true);
    expect(
      validateModelAuthoredSchema(
        objectSchema({ m: { type: "string", format: "model:EmbeddingTask" } })
      ).ok
    ).toBe(true);
  });

  it("refuses a format nobody has allowed, rather than passing it through", () => {
    // The allowlist direction: a format added to the taxonomy later is refused
    // until someone names it, instead of being served to whoever asks first.
    const result = validateModelAuthoredSchema(
      objectSchema({ f: { type: "string", format: "future:thing" } })
    );
    expect(result.ok).toBe(false);
  });

  it("bounds property count", () => {
    const many = Object.fromEntries(
      Array.from({ length: DEFAULT_MODEL_AUTHORED_SCHEMA_LIMITS.maxProperties + 1 }, (_, i) => [
        `p${i}`,
        { type: "string" },
      ])
    );
    const result = validateModelAuthoredSchema(objectSchema(many));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("too many properties");
  });

  it("bounds nesting depth, including through arrays", () => {
    const deep = objectSchema({
      a: {
        type: "object",
        properties: {
          b: {
            type: "object",
            properties: { c: { type: "object", properties: { d: { type: "string" } } } },
          },
        },
      },
    });
    const result = validateModelAuthoredSchema(deep);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("nesting depth");

    const deepArray = objectSchema({
      a: {
        type: "array",
        items: {
          type: "array",
          items: { type: "array", items: { type: "object", properties: {} } },
        },
      },
    });
    expect(validateModelAuthoredSchema(deepArray).ok).toBe(false);
  });

  it("reports the path of the offending node so a model can fix it", () => {
    const result = validateModelAuthoredSchema(
      objectSchema({
        outer: { type: "object", properties: { inner: { type: "string", format: "credential" } } },
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("outer.inner");
  });

  it("honours caller-supplied limits", () => {
    const strict = { ...DEFAULT_MODEL_AUTHORED_SCHEMA_LIMITS, maxProperties: 1 };
    expect(validateModelAuthoredSchema(objectSchema({ a: { type: "string" } }), strict).ok).toBe(
      true
    );
    expect(
      validateModelAuthoredSchema(
        objectSchema({ a: { type: "string" }, b: { type: "string" } }),
        strict
      ).ok
    ).toBe(false);
  });

  it("refuses a resource format hidden under a branch keyword", () => {
    // A renderer that understands oneOf/allOf resolves the format on the branch
    // it picks, so checking only `properties` and `items` leaves the allowlist
    // bypassable by anything that can nest one level sideways.
    const branches = [
      { oneOf: [{ type: "string" }, { type: "string", format: "credential" }] },
      { anyOf: [{ type: "string", format: "knowledge-base" }] },
      { allOf: [{ type: "string", format: "storage:tabular" }] },
      { type: "string", if: { format: "credential" } },
      { type: "object", additionalProperties: { type: "string", format: "credential" } },
    ];
    for (const field of branches) {
      const result = validateModelAuthoredSchema(objectSchema({ f: field }));
      expect(result.ok, JSON.stringify(field)).toBe(false);
    }
  });

  it("refuses a resource format hidden under a child keyword the walk once skipped", () => {
    // Same hole as the branch keywords, one keyword over: a renderer that
    // understands tuples or pattern-keyed maps resolves the format on the
    // subschema it picks, so every keyword that can carry one is walked.
    const fields = [
      { type: "array", prefixItems: [{ type: "string", format: "credential" }] },
      { type: "object", patternProperties: { "^x": { type: "string", format: "credential" } } },
      { type: "object", propertyNames: { type: "string", format: "credential" } },
      { type: "array", contains: { type: "string", format: "knowledge-base" } },
      { type: "object", dependentSchemas: { a: { type: "string", format: "storage:tabular" } } },
      { type: "object", unevaluatedProperties: { type: "string", format: "credential" } },
    ];
    for (const field of fields) {
      expect(
        validateModelAuthoredSchema(objectSchema({ f: field })).ok,
        JSON.stringify(field)
      ).toBe(false);
    }
  });

  it("refuses a reference, which points somewhere this guard cannot follow", () => {
    const withRef = {
      type: "object",
      $defs: { secret: { type: "string", format: "credential" } },
      properties: { f: { $ref: "#/$defs/secret" } },
    };
    const result = validateModelAuthoredSchema(withRef);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("$defs");
  });

  it("returns a reason rather than overflowing on a chain of branch keywords", () => {
    // Branch keywords sit at their parent's depth on purpose, so `maxDepth`
    // does not bound them; without a ceiling of its own the walk throws a
    // RangeError, which is neither a reason nor something a model can act on.
    let node: unknown = { type: "string" };
    for (let i = 0; i < 5_000; i++) node = { oneOf: [node] };
    const result = validateModelAuthoredSchema(objectSchema({ f: node }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("too many keywords");
  });

  it("still accepts an allowed format inside a branch", () => {
    expect(
      validateModelAuthoredSchema(
        objectSchema({ f: { oneOf: [{ type: "null" }, { type: "string", format: "date" }] } })
      ).ok
    ).toBe(true);
  });

  it("freezes the default limits so the guard cannot be widened at run time", () => {
    expect(Object.isFrozen(DEFAULT_MODEL_AUTHORED_SCHEMA_LIMITS)).toBe(true);
    // Shallow freezing is not enough on its own: whatever holds the allowlist
    // has to be frozen too, or anything with a reference can add to it.
    expect(Object.isFrozen(DEFAULT_MODEL_AUTHORED_SCHEMA_LIMITS.allowedFormats)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MODEL_AUTHORED_SCHEMA_LIMITS.allowedFormatPrefixes)).toBe(true);
    expect(() =>
      (DEFAULT_MODEL_AUTHORED_SCHEMA_LIMITS.allowedFormats as string[]).push("credential")
    ).toThrow();
    expect(
      validateModelAuthoredSchema(objectSchema({ f: { type: "string", format: "credential" } })).ok
    ).toBe(false);
  });
});
