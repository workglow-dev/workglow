/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { GpuImage, GpuImageBackend } from "@workglow/util/media";

/**
 * Per-call hints passed from `applyFilter` to the backend op. The op decides
 * how to honor them (e.g. WebGpuImage.apply releases its source texture
 * when `releaseSource` is set; CpuImage and SharpImage ops typically
 * ignore the flag because their sources are JS-managed).
 */
export interface FilterOpOptions {
  /**
   * If true, the op may release the source image's resources (GPU texture,
   * etc.) after the operation. Set in production `execute()` chains; never
   * set in `executePreview()` because the builder UI keeps references to
   * intermediate task outputs for debug-display.
   */
  releaseSource?: boolean;
}

// A backend-specific implementation of one filter, keyed by (backend, filterName).
// The Map's value type is intentionally loose; per-filter typed wrappers
// (see ImageFilterTask.runFilter) restore type safety at the call site.
export type FilterOpFn<P = unknown> = (
  image: GpuImage,
  params: P,
  opts: FilterOpOptions,
) => GpuImage;

const registry = new Map<string, FilterOpFn<unknown>>();

const key = (backend: GpuImageBackend, filter: string) => `${backend}:${filter}`;

export function registerFilterOp<P>(
  backend: GpuImageBackend,
  filter: string,
  fn: FilterOpFn<P>,
): void {
  registry.set(key(backend, filter), fn as FilterOpFn<unknown>);
}

export function applyFilter<P>(
  image: GpuImage,
  filter: string,
  params: P,
  opts: FilterOpOptions = {},
): GpuImage {
  const fn = registry.get(key(image.backend, filter));
  if (!fn) {
    throw new Error(
      `No "${image.backend}" implementation registered for filter "${filter}". ` +
        `Ensure the codec side-effect entry is imported via \`import "@workglow/tasks/codec"\`.`,
    );
  }
  return fn(image, params, opts);
}

/** @internal — test affordance only. */
export function _resetFilterRegistryForTests(): void {
  registry.clear();
}
