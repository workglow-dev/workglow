/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./common";
export * from "./debug/console/ConsoleFormatters";

import { registerRefcountablePredicate } from "./refcountable";
import { CpuImage, WebGpuImage } from "@workglow/util/media";

// Register the refcountable predicate so TaskGraphRunner applies fanout
// retain to GpuImage values flowing across dataflow edges. Lives here
// (rather than inside @workglow/util/media) because util cannot import
// from task-graph — that would invert the dependency graph. WebGpuImage
// is the only GpuImage backend with an actual texture-pool refcount;
// CpuImage's retain/release are no-ops, but registering it keeps the
// predicate symmetric across backends so future code paths don't have
// to branch on backend.
registerRefcountablePredicate(
  (v): v is CpuImage | WebGpuImage =>
    v instanceof CpuImage || v instanceof WebGpuImage,
);
