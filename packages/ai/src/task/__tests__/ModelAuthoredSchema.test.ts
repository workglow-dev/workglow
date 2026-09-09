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

  it("freezes the default limits so the guard cannot be widened at run time", () => {
    expect(Object.isFrozen(DEFAULT_MODEL_AUTHORED_SCHEMA_LIMITS)).toBe(true);
  });
});
