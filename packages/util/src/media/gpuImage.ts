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
  release(): void;
}

export interface GpuImageStatic {
  fromImageBinary(bin: ImageBinary): GpuImage;
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
