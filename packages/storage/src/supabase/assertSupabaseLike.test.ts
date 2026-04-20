/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { assertSupabaseLike } from "./assertSupabaseLike";

describe("assertSupabaseLike", () => {
  it("throws on null", () => {
    expect(() => assertSupabaseLike(null)).toThrow(TypeError);
  });

  it("throws on undefined", () => {
    expect(() => assertSupabaseLike(undefined)).toThrow(TypeError);
  });

  it("throws on empty object", () => {
    expect(() => assertSupabaseLike({})).toThrow(/Supabase client/);
  });

  it("throws when from is missing", () => {
    expect(() => assertSupabaseLike({ rpc: () => {} })).toThrow(TypeError);
  });

  it("throws when rpc is missing", () => {
    expect(() => assertSupabaseLike({ from: () => {} })).toThrow(TypeError);
  });

  it("throws when from/rpc are not functions", () => {
    expect(() => assertSupabaseLike({ from: "x", rpc: "y" })).toThrow(TypeError);
  });

  it("returns the same reference when both methods are functions", () => {
    const client = { from: () => {}, rpc: () => {} };
    expect(assertSupabaseLike(client)).toBe(client);
  });
});
