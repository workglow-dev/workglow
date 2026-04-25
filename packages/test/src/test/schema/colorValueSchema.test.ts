/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ColorSchema, ColorValueSchema, HexColorSchema } from "@workglow/tasks";
import { compileSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

function validate(schema: ReturnType<typeof ColorValueSchema>, value: unknown) {
  return compileSchema(schema).validate(value);
}

describe("HexColorSchema", () => {
  const schema = HexColorSchema();

  it("accepts 3/4/6/8-digit hex strings", () => {
    for (const x of ["#f00", "#f008", "#ff0000", "#ff000080", "#AbCdEf"]) {
      expect(compileSchema(schema).validate(x).valid).toBe(true);
    }
  });

  it("rejects strings without leading #", () => {
    expect(compileSchema(schema).validate("ff0000").valid).toBe(false);
  });

  it("rejects non-hex characters and wrong lengths", () => {
    for (const x of ["#gg0000", "#fffff", "#fffffff", "#"]) {
      expect(compileSchema(schema).validate(x).valid).toBe(false);
    }
  });

  it("carries format: color", () => {
    expect(schema.format).toBe("color");
  });
});

describe("ColorValueSchema", () => {
  const schema = ColorValueSchema();

  it("accepts a valid RGBA object", () => {
    expect(validate(schema, { r: 255, g: 0, b: 0, a: 255 }).valid).toBe(true);
  });

  it("accepts an object with omitted alpha", () => {
    expect(validate(schema, { r: 0, g: 0, b: 0 }).valid).toBe(true);
  });

  it("accepts a hex string", () => {
    expect(validate(schema, "#ff0000").valid).toBe(true);
    expect(validate(schema, "#f00").valid).toBe(true);
    expect(validate(schema, "#ff000080").valid).toBe(true);
  });

  it("rejects a hex string without leading #", () => {
    expect(validate(schema, "ff0000").valid).toBe(false);
  });

  it("rejects an out-of-range object channel", () => {
    expect(validate(schema, { r: 256, g: 0, b: 0 }).valid).toBe(false);
  });

  it("rejects arbitrary other shapes", () => {
    expect(validate(schema, 42).valid).toBe(false);
    expect(validate(schema, null).valid).toBe(false);
    expect(validate(schema, { foo: "bar" }).valid).toBe(false);
  });
});

describe("ColorSchema (regression)", () => {
  it("still validates object-only color inputs", () => {
    expect(compileSchema(ColorSchema()).validate({ r: 1, g: 2, b: 3, a: 4 }).valid).toBe(true);
    expect(compileSchema(ColorSchema()).validate("#ff0000").valid).toBe(false);
  });
});
