/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./common";

import { registerRefcountablePredicate, type Refcountable } from "./refcountable";

// Register the refcountable predicate so TaskGraphRunner applies fanout
// retain to GpuImage values flowing across dataflow edges. Lives here
// (rather than inside @workglow/util/media) because util cannot import
// from task-graph.
//
// Duck-typed for cross-bundle safety and to keep the typecheck off the
// WebGpuImage value (which is a type-only re-export here).
registerRefcountablePredicate(
  (v): v is Refcountable =>
    !!v &&
    typeof v === "object" &&
    "backend" in v &&
    "retain" in v &&
    "release" in v &&
    "materialize" in v,
);
