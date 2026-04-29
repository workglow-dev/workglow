/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./common";

import { registerRefcountablePredicate } from "./refcountable";
import { CpuImage, SharpImage } from "@workglow/util/media";

// Register the refcountable predicate so TaskGraphRunner applies fanout
// retain to GpuImage values flowing across dataflow edges. Lives here
// (rather than inside @workglow/util/media) because util cannot import
// from task-graph. SharpImage and CpuImage have no-op retain/release
// (their resources are JS-managed); registering them keeps the predicate
// symmetric across backends so future code paths don't have to branch.
registerRefcountablePredicate(
  (v): v is CpuImage | SharpImage =>
    v instanceof CpuImage || v instanceof SharpImage,
);
