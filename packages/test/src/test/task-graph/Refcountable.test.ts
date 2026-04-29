/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, test, beforeEach } from "vitest";
import {
  registerRefcountablePredicate,
  asRefcountable,
  _resetRefcountablePredicatesForTests,
  type Refcountable,
} from "@workglow/task-graph";

// Test fake matching the Refcountable contract (retain returns Refcountable).
class FakeRefcounted implements Refcountable {
  marker = true;
  retain(_n: number = 1): Refcountable { return this; }
  release(): void {}
}

describe("refcountable registry", () => {
  beforeEach(() => {
    _resetRefcountablePredicatesForTests();
  });

  test("asRefcountable returns null when no predicates are registered", () => {
    const v = new FakeRefcounted();
    expect(asRefcountable(v)).toBeNull();
  });

  test("asRefcountable returns the value when a registered predicate matches", () => {
    registerRefcountablePredicate(
      (v): v is FakeRefcounted => v instanceof FakeRefcounted,
    );
    const v = new FakeRefcounted();
    expect(asRefcountable(v)).toBe(v);
  });

  test("asRefcountable returns null when the predicate rejects", () => {
    registerRefcountablePredicate((_v): _v is FakeRefcounted => false);
    expect(asRefcountable({})).toBeNull();
  });

  test("asRefcountable handles non-object values without throwing", () => {
    registerRefcountablePredicate((_v): _v is FakeRefcounted => false);
    expect(asRefcountable(null)).toBeNull();
    expect(asRefcountable(undefined)).toBeNull();
    expect(asRefcountable("string")).toBeNull();
    expect(asRefcountable(42)).toBeNull();
  });

  test("multiple predicates short-circuit on first match", () => {
    let firstCalled = 0;
    let secondCalled = 0;
    registerRefcountablePredicate((_v): _v is FakeRefcounted => {
      firstCalled++;
      return true;
    });
    registerRefcountablePredicate((_v): _v is FakeRefcounted => {
      secondCalled++;
      return true;
    });
    asRefcountable({});
    expect(firstCalled).toBe(1);
    expect(secondCalled).toBe(0);
  });
});
