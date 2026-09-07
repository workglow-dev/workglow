/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyTabularStorage } from "@workglow/storage";
import { resolveJoinDelegate } from "@workglow/storage";
import { describe, expect, it } from "vitest";

/** A storage that nothing should look behind — a plain backend, or a scoping wrapper. */
function terminal(label: string): AnyTabularStorage {
  return { label } as unknown as AnyTabularStorage;
}

/** A wrapper whose `joinDelegate` returns whatever the caller wants it to. */
function delegating(label: string, to: () => unknown): AnyTabularStorage {
  return { label, joinDelegate: to } as unknown as AnyTabularStorage;
}

describe("resolveJoinDelegate", () => {
  it("returns a storage that does not delegate unchanged", () => {
    const durable = terminal("durable");
    expect(resolveJoinDelegate(durable)).toBe(durable);
  });

  it("follows one level of delegation", () => {
    const durable = terminal("durable");
    const cached = delegating("cached", () => durable);
    expect(resolveJoinDelegate(cached)).toBe(durable);
  });

  it("follows a nested chain to the innermost storage", () => {
    // The case the per-wrapper unwrapping missed: telemetry over a cache read
    // the cache for one half of the join and durable for the other.
    const durable = terminal("durable");
    const cached = delegating("cached", () => durable);
    const traced = delegating("traced", () => cached);
    expect(resolveJoinDelegate(traced)).toBe(durable);
  });

  it("stops at a wrapper that refuses to name a delegate", () => {
    // A scoping wrapper stays in the path by declining to delegate. Returning
    // nothing must stop the walk rather than resolve to a missing storage.
    const undefinedDelegate = delegating("scoped", () => undefined);
    expect(resolveJoinDelegate(undefinedDelegate)).toBe(undefinedDelegate);

    const nullDelegate = delegating("scoped", () => null);
    expect(resolveJoinDelegate(nullDelegate)).toBe(nullDelegate);
  });

  it("terminates on a wrapper that delegates to itself", () => {
    const selfish: AnyTabularStorage = delegating("selfish", () => selfish);
    expect(resolveJoinDelegate(selfish)).toBe(selfish);
  });

  it("terminates on a cycle between two wrappers", () => {
    const a: AnyTabularStorage = delegating("a", () => b);
    const b: AnyTabularStorage = delegating("b", () => a);
    // Stops where the walk first revisits a storage it has already seen.
    expect(resolveJoinDelegate(a)).toBe(b);
  });

  it("ignores a non-callable joinDelegate property", () => {
    const impostor = { label: "impostor", joinDelegate: "durable" } as unknown as AnyTabularStorage;
    expect(resolveJoinDelegate(impostor)).toBe(impostor);
  });
});
