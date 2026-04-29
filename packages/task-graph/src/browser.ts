/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./common";
export * from "./debug/console/ConsoleFormatters";

import { registerRefcountablePredicate, type Refcountable } from "./refcountable";

// Register the refcountable predicate so TaskGraphRunner applies fanout
// retain to GpuImage values flowing across dataflow edges. Lives here
// (rather than inside @workglow/util/media) because util cannot import
// from task-graph — that would invert the dependency graph.
//
// Duck-typed (rather than `instanceof CpuImage || v instanceof WebGpuImage`)
// because WebGpuImage is a value at runtime in the browser but a type-only
// re-export in node's media-node.ts; importing it as a value would fail the
// node-side typecheck. Duck-typing also survives bundle-split scenarios
// (Vite/Rolldown can produce multiple class copies) where instanceof would
// miss values minted by a different copy.
registerRefcountablePredicate(
  (v): v is Refcountable =>
    !!v &&
    typeof v === "object" &&
    "backend" in v &&
    "retain" in v &&
    "release" in v &&
    "materialize" in v,
);
