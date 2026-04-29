/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test, beforeEach } from "vitest";
import { registerPortCodec, getPortCodec, _resetPortCodecsForTests } from "@workglow/task-graph";

describe("PortCodecRegistry", () => {
  beforeEach(() => {
    _resetPortCodecsForTests();
  });

  test("register + get round-trip by exact format", () => {
    const codec = {
      serialize: async (v: unknown) => ({ wrapped: v }),
      deserialize: async (v: unknown) => (v as { wrapped: unknown }).wrapped,
    };
    registerPortCodec("test-codec", codec);
    expect(getPortCodec("test-codec")).toBe(codec);
  });

  test("get falls back to format prefix (before colon)", () => {
    const codec = {
      serialize: async (v: unknown) => v,
      deserialize: async (v: unknown) => v,
    };
    registerPortCodec("image", codec);
    expect(getPortCodec("image")).toBe(codec);
    expect(getPortCodec("image:data-uri")).toBe(codec);
    expect(getPortCodec("image:bitmap")).toBe(codec);
  });

  test("unknown format returns undefined", () => {
    expect(getPortCodec("nope")).toBeUndefined();
    expect(getPortCodec("nope:variant")).toBeUndefined();
  });
});
