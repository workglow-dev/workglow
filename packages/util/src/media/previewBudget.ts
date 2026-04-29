/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { GpuImage } from "./gpuImage";

/**
 * Cross-bundle singleton — the previewSource helper needs a backend-specific
 * resize op. Rather than importing from @workglow/tasks (a downstream
 * package, which would invert the dependency graph), the preview helper
 * accepts a resize-fn callback registered at startup by the consumer.
 *
 * The budget value is also held in a globalThis slot so multiple bundle
 * copies of this module (Vite/Rolldown can produce them) share a single
 * source of truth — without it, setPreviewBudget would silently no-op in
 * any bundle that didn't perform the call.
 */
const GLOBAL_RESIZE_KEY = Symbol.for("@workglow/util/media/previewResizeFn");
const GLOBAL_BUDGET_KEY = Symbol.for("@workglow/util/media/previewBudget");
const _g = globalThis as Record<symbol, unknown>;

export type PreviewResizeFn = (image: GpuImage, w: number, h: number) => GpuImage;

const DEFAULT_BUDGET = 512;

if (typeof _g[GLOBAL_BUDGET_KEY] !== "number") {
  _g[GLOBAL_BUDGET_KEY] = DEFAULT_BUDGET;
}

export function registerPreviewResizeFn(fn: PreviewResizeFn): void {
  _g[GLOBAL_RESIZE_KEY] = fn;
}

function getPreviewResizeFn(): PreviewResizeFn | undefined {
  return _g[GLOBAL_RESIZE_KEY] as PreviewResizeFn | undefined;
}

export function getPreviewBudget(): number {
  return _g[GLOBAL_BUDGET_KEY] as number;
}

export function setPreviewBudget(px: number): void {
  if (!Number.isFinite(px) || px <= 0) {
    throw new Error(`setPreviewBudget: invalid value ${px}; expected a positive finite number`);
  }
  _g[GLOBAL_BUDGET_KEY] = Math.floor(px);
}

/**
 * Scale-then-effect entry for `executePreview`. Returns a downscaled image
 * when the input's longer edge exceeds the budget AND the backend benefits
 * (webgpu only). Otherwise returns the input unchanged — referential
 * equality is the signal to callers that no transient was created.
 *
 * Calling code that wants downscale must call `registerPreviewResizeFn` at
 * startup with a callback that performs the resize (typically routed through
 * @workglow/tasks's applyFilter). Without registration, previewSource is
 * a no-op even on webgpu inputs.
 */
export function previewSource(image: GpuImage): GpuImage {
  if (image.backend !== "webgpu") return image;
  const budget = getPreviewBudget();
  const long = Math.max(image.width, image.height);
  if (long <= budget) return image;
  const ratio = budget / long;
  const resize = getPreviewResizeFn();
  if (!resize) return image;
  const result = resize(image, Math.round(image.width * ratio), Math.round(image.height * ratio));
  // Compose: newScale = inputScale × downscaleRatio. The resize op produces an
  // image whose previewScale equals input's (apply() propagation rule). We
  // override it here — previewSource is the only place that *changes* previewScale.
  const composed = image.previewScale * ratio;
  return (result as unknown as { _setPreviewScale(s: number): GpuImage })._setPreviewScale(composed);
}
