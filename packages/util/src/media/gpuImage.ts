/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { ImageBinary, ImageChannels } from "./imageTypes";

export type GpuImageBackend = "webgpu" | "sharp" | "cpu";
export type GpuImageEncodeFormat = "png" | "jpeg" | "webp";

export interface GpuImage {
  readonly width: number;
  readonly height: number;
  readonly channels: ImageChannels;
  readonly backend: GpuImageBackend;
  materialize(): Promise<ImageBinary>;
  toCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void>;
  encode(format: GpuImageEncodeFormat, quality?: number): Promise<Uint8Array>;
  /**
   * Increment the refcount by `n` (default 1). Returns `this` for chaining.
   * No-op for backends without external resource lifetime (CpuImage, SharpImage).
   * Throws if the resource has already been reclaimed (count was already 0).
   */
  retain(n?: number): this;
  /**
   * Decrement the refcount by 1. When it hits 0, reclaim the underlying resource
   * (e.g., return the GPU texture to the pool). Throws on release-after-reclaim.
   * No-op for backends without external resource lifetime.
   */
  release(): void;
}

export interface GpuImageStatic {
  fromImageBinary(bin: ImageBinary): GpuImage;
  fromImageBinaryAsync?(bin: ImageBinary): Promise<GpuImage>;
  fromDataUri(dataUri: string): Promise<GpuImage>;
  fromBlob(blob: Blob): Promise<GpuImage>;
  fromImageBitmap?(bitmap: ImageBitmap): Promise<GpuImage>;
}

// Cross-bundle singleton — Vite/Rolldown can produce multiple bundle copies
// of this file. Without sharing through globalThis, registrations from
// media-browser.ts could land in one copy while the codec / hydrator query
// another and throw "GpuImage.fromDataUri is not registered".
const GLOBAL_FACTORY_KEY = Symbol.for("@workglow/util/media/gpuImageFactory");
const _g = globalThis as Record<symbol, unknown>;
if (!_g[GLOBAL_FACTORY_KEY]) {
  _g[GLOBAL_FACTORY_KEY] = {} as Record<string, unknown>;
}
const factory = _g[GLOBAL_FACTORY_KEY] as Record<string, unknown>;

export function registerGpuImageFactory<K extends keyof GpuImageStatic>(
  key: K,
  fn: GpuImageStatic[K],
): void {
  factory[key] = fn;
}

/**
 * Returns the registered factory function for `key`, or `undefined` if it
 * has not been registered. Prefer this over accessing `GpuImage[key]` directly
 * when the factory is optional — the Proxy throws on missing registrations.
 */
export function getGpuImageFactory<K extends keyof GpuImageStatic>(
  key: K,
): GpuImageStatic[K] | undefined {
  const fn = factory[key];
  return typeof fn === "function" ? (fn as GpuImageStatic[K]) : undefined;
}

export const GpuImage: GpuImageStatic = new Proxy({} as GpuImageStatic, {
  get(_t, prop) {
    if (typeof prop !== "string" || prop === "then") return undefined;
    const fn = factory[prop];
    if (typeof fn !== "function") {
      throw new Error(`GpuImage.${prop} is not registered. Import the platform entry point.`);
    }
    return fn;
  },
});
