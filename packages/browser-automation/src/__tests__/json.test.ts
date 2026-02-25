/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "bun:test";
import { assertJsonValue } from "../core/json";

describe("assertJsonValue", () => {
  it("accepts null", () => {
    expect(() => assertJsonValue(null)).not.toThrow();
  });

  it("accepts strings", () => {
    expect(() => assertJsonValue("hello")).not.toThrow();
    expect(() => assertJsonValue("")).not.toThrow();
  });

  it("accepts numbers", () => {
    expect(() => assertJsonValue(42)).not.toThrow();
    expect(() => assertJsonValue(0)).not.toThrow();
    expect(() => assertJsonValue(-1.5)).not.toThrow();
  });

  it("accepts booleans", () => {
    expect(() => assertJsonValue(true)).not.toThrow();
    expect(() => assertJsonValue(false)).not.toThrow();
  });

  it("accepts plain objects", () => {
    expect(() => assertJsonValue({})).not.toThrow();
    expect(() => assertJsonValue({ a: 1, b: "two", c: null })).not.toThrow();
  });

  it("accepts arrays", () => {
    expect(() => assertJsonValue([])).not.toThrow();
    expect(() => assertJsonValue([1, "two", null, true])).not.toThrow();
  });

  it("accepts nested structures", () => {
    expect(() =>
      assertJsonValue({
        a: [1, { b: [2, 3] }],
        c: { d: { e: null } },
      })
    ).not.toThrow();
  });

  it("rejects undefined", () => {
    expect(() => assertJsonValue(undefined)).toThrow("undefined");
  });

  it("rejects functions", () => {
    expect(() => assertJsonValue(() => {})).toThrow("function");
  });

  it("rejects symbols", () => {
    expect(() => assertJsonValue(Symbol("test"))).toThrow("symbol");
  });

  it("rejects bigint", () => {
    expect(() => assertJsonValue(BigInt(42))).toThrow("bigint");
  });

  it("rejects class instances", () => {
    expect(() => assertJsonValue(new Date())).toThrow("class instance");
    expect(() => assertJsonValue(new Map())).toThrow("class instance");
  });

  it("rejects nested non-JSON values", () => {
    expect(() => assertJsonValue({ a: undefined })).toThrow("root.a");
    expect(() => assertJsonValue([() => {}])).toThrow("root[0]");
  });
});
