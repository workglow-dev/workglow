/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { GpuImage, GpuImageBackend } from "@workglow/util/media";

// A backend-specific implementation of one filter, keyed by (backend, filterName).
// The Map's value type is intentionally loose; the registerFilterOp<P> generic
// restores per-filter type safety at registration.
export type FilterOpFn<P = unknown> = (image: GpuImage, params: P) => GpuImage;

const registry = new Map<string, FilterOpFn<unknown>>();

const key = (backend: GpuImageBackend, filter: string) => `${backend}:${filter}`;

export function registerFilterOp<P>(
  backend: GpuImageBackend,
  filter: string,
  fn: FilterOpFn<P>,
): void {
  registry.set(key(backend, filter), fn as FilterOpFn<unknown>);
}

export function applyFilter<P>(image: GpuImage, filter: string, params: P): GpuImage {
  const fn = registry.get(key(image.backend, filter));
  if (!fn) {
    throw new Error(
      `No "${image.backend}" implementation registered for filter "${filter}". ` +
        `Ensure the codec side-effect entry is imported via \`import "@workglow/tasks/codec"\`.`,
    );
  }
  return fn(image, params);
}

/** @internal — test affordance only. */
export function _resetFilterRegistryForTests(): void {
  registry.clear();
}
