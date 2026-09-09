/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { asText } from "../asText";

describe("asText", () => {
  it("passes a string through unquoted", () => {
    // A message must read the way its author wrote it, so this is the one case
    // that must not go through JSON.
    expect(asText("already text")).toBe("already text");
    expect(asText("")).toBe("");
  });

  it('renders null and undefined empty, as `String(v ?? "")` did', () => {
    expect(asText(null)).toBe("");
    expect(asText(undefined)).toBe("");
  });

  it("stringifies scalars", () => {
    expect(asText(42)).toBe("42");
    expect(asText(0)).toBe("0");
    expect(asText(false)).toBe("false");
    expect(asText(10n)).toBe("10");
    expect(asText(Number.NaN)).toBe("NaN");
  });

  it("keeps the content of an object instead of erasing it", () => {
    // The whole point: `String({a: 1})` is "[object Object]".
    expect(asText({ a: 1 })).toBe('{"a":1}');
    expect(asText([1, "two"])).toBe('[1,"two"]');
    expect(asText({})).toBe("{}");
  });

  it("tells two different objects apart", () => {
    // Under `String()` both are "[object Object]", so a comparison or a cache
    // key built from them matches the wrong thing rather than failing.
    expect(asText({ id: "a" })).not.toBe(asText({ id: "b" }));
  });

  it("does not throw on a cycle", () => {
    // A diagnostic must not fail while reporting a failure.
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(() => asText(cyclic)).not.toThrow();
    expect(asText(cyclic)).toContain("object");
  });

  it("does not throw on a BigInt nested in an object", () => {
    // JSON.stringify throws on these rather than returning undefined.
    expect(() => asText({ big: 1n })).not.toThrow();
  });

  it("falls back where JSON returns nothing", () => {
    // JSON.stringify(() => {}) is `undefined`, not a string.
    expect(typeof asText(() => {})).toBe("string");
    expect(asText(Symbol("s"))).toBe("Symbol(s)");
  });
});

describe("asText and a real toString", () => {
  it("keeps the familiar rendering of a type that defines one", () => {
    // JSON would quote these ('"http://x/"'), which is not what a caller
    // reading a URL or a date out of a message expects.
    expect(asText(new URL("http://localhost:8080/props"))).toBe("http://localhost:8080/props");
    expect(asText(/ab+c/gi)).toBe("/ab+c/gi");
    expect(asText(new Error("boom"))).toBe("Error: boom");
  });

  it("does not take an array's toString", () => {
    // `[{a:1}].toString()` is "[object Object]" — the exact rendering this
    // helper exists to avoid — so arrays go to JSON however custom that is.
    expect(asText([{ a: 1 }])).toBe('[{"a":1}]');
  });

  it("survives a throwing toString", () => {
    const hostile = {
      toString() {
        throw new Error("no");
      },
    };
    expect(() => asText(hostile)).not.toThrow();
    expect(asText(hostile)).toBe("{}");
  });
});
