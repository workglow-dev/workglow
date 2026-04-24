/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { parseHexColor, toHexColor } from "@workglow/util/media";

describe("parseHexColor", () => {
  it("parses #RRGGBB", () => {
    expect(parseHexColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseHexColor("#00FF00")).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    expect(parseHexColor("#0000ff")).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  });

  it("parses #RRGGBBAA with alpha", () => {
    expect(parseHexColor("#ff000080")).toEqual({ r: 255, g: 0, b: 0, a: 128 });
    expect(parseHexColor("#00000000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseHexColor("#ffffffff")).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it("expands #RGB shorthand by doubling each nibble", () => {
    expect(parseHexColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseHexColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 255 });
  });

  it("expands #RGBA shorthand", () => {
    expect(parseHexColor("#f008")).toEqual({ r: 255, g: 0, b: 0, a: 0x88 });
    expect(parseHexColor("#0000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("is case-insensitive on input", () => {
    expect(parseHexColor("#AbCdEf")).toEqual(parseHexColor("#abcdef"));
    expect(parseHexColor("#AbCdEf12")).toEqual(parseHexColor("#abcdef12"));
  });

  it("throws on missing leading #", () => {
    expect(() => parseHexColor("ff0000")).toThrow();
  });

  it("throws on non-hex characters", () => {
    expect(() => parseHexColor("#gg0000")).toThrow();
    expect(() => parseHexColor("#ff00zz")).toThrow();
  });

  it("throws on invalid lengths", () => {
    expect(() => parseHexColor("#")).toThrow();
    expect(() => parseHexColor("#f")).toThrow();
    expect(() => parseHexColor("#ff")).toThrow();
    expect(() => parseHexColor("#fffff")).toThrow();
    expect(() => parseHexColor("#fffffff")).toThrow();
    expect(() => parseHexColor("#fffffffff")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => parseHexColor("")).toThrow();
  });

  it("throws on whitespace-padded input (no trim)", () => {
    expect(() => parseHexColor(" #ff0000")).toThrow();
    expect(() => parseHexColor("#ff0000 ")).toThrow();
  });

  it("throws on non-string input", () => {
    expect(() => parseHexColor(null as unknown as string)).toThrow();
    expect(() => parseHexColor(undefined as unknown as string)).toThrow();
    expect(() => parseHexColor(123 as unknown as string)).toThrow();
  });
});

describe("toHexColor", () => {
  it("emits #RRGGBB when alpha is 255", () => {
    expect(toHexColor({ r: 255, g: 0, b: 0, a: 255 })).toBe("#ff0000");
    expect(toHexColor({ r: 0, g: 255, b: 0, a: 255 })).toBe("#00ff00");
    expect(toHexColor({ r: 0, g: 0, b: 255, a: 255 })).toBe("#0000ff");
  });

  it("emits #RRGGBBAA when alpha < 255", () => {
    expect(toHexColor({ r: 255, g: 0, b: 0, a: 128 })).toBe("#ff000080");
    expect(toHexColor({ r: 0, g: 0, b: 0, a: 0 })).toBe("#00000000");
    expect(toHexColor({ r: 170, g: 187, b: 204, a: 136 })).toBe("#aabbcc88");
  });

  it("emits lowercase only", () => {
    expect(toHexColor({ r: 0xab, g: 0xcd, b: 0xef, a: 255 })).toBe("#abcdef");
  });

  it("never emits 3/4-digit shorthand", () => {
    expect(toHexColor({ r: 255, g: 0, b: 0, a: 255 })).toBe("#ff0000");
    expect(toHexColor({ r: 255, g: 0, b: 0, a: 0 })).toBe("#ff000000");
  });

  it("round-trips 6-digit and 8-digit hex", () => {
    for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#123456", "#abcdef12", "#00000080"]) {
      expect(toHexColor(parseHexColor(hex))).toBe(hex);
    }
  });

  it("expands 3/4-digit shorthand to long lowercase form after round trip", () => {
    expect(toHexColor(parseHexColor("#f00"))).toBe("#ff0000");
    expect(toHexColor(parseHexColor("#ABC"))).toBe("#aabbcc");
    expect(toHexColor(parseHexColor("#f008"))).toBe("#ff000088");
  });

  it("throws on non-integer channels", () => {
    expect(() => toHexColor({ r: 1.5, g: 0, b: 0, a: 255 })).toThrow();
    expect(() => toHexColor({ r: 0, g: NaN, b: 0, a: 255 })).toThrow();
  });

  it("throws on out-of-range channels", () => {
    expect(() => toHexColor({ r: -1, g: 0, b: 0, a: 255 })).toThrow();
    expect(() => toHexColor({ r: 256, g: 0, b: 0, a: 255 })).toThrow();
    expect(() => toHexColor({ r: 0, g: 0, b: 0, a: 300 })).toThrow();
  });
});
