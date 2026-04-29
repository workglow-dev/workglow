/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimum surface a value must expose to be eligible for runner-level
 * fanout retain. Implementations: WebGpuImage (refcounts a GPU texture);
 * CpuImage / SharpImage (no-ops, but conform to the shape so the same
 * downstream code paths work without branching).
 */
export interface Refcountable {
  retain(n?: number): Refcountable;
  release(): void;
}

// Cross-bundle singleton — Vite/Rolldown can produce multiple bundle copies
// of this file. Without sharing through globalThis, predicates registered
// in one copy wouldn't be visible to runner code in another copy. Pattern
// matches the codec + factory registries (see commit b9e3e235).
const GLOBAL_KEY = Symbol.for("@workglow/task-graph/refcountable.predicates");
const _g = globalThis as Record<symbol, unknown>;
if (!Array.isArray(_g[GLOBAL_KEY])) {
  _g[GLOBAL_KEY] = [];
}
const predicates = _g[GLOBAL_KEY] as Array<(v: unknown) => v is Refcountable>;

/**
 * Register a predicate that identifies refcountable values. The runner
 * walks all registered predicates after task completion; the first match
 * wins. Order is the order of registration.
 */
export function registerRefcountablePredicate<T extends Refcountable>(
  p: (v: unknown) => v is T,
): void {
  predicates.push(p);
}

/**
 * Returns the value typed as Refcountable when any registered predicate
 * matches, otherwise null. Non-object values short-circuit to null.
 */
export function asRefcountable(v: unknown): Refcountable | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return null;
  for (const p of predicates) {
    if (p(v)) return v;
  }
  return null;
}

/** @internal — test affordance only. */
export function _resetRefcountablePredicatesForTests(): void {
  predicates.length = 0;
}
