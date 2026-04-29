/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { registerPortCodec } from "@workglow/util";
import { CpuImage } from "./cpuImage";
import type { GpuImage } from "./gpuImage";
import type { ImageBinary, ImageChannels } from "./imageTypes";

export interface CachedImage {
  kind: "image-binary";
  width: number;
  height: number;
  channels: ImageChannels;
  data: Uint8ClampedArray;
}

registerPortCodec<GpuImage, CachedImage>("image", {
  async serialize(value) {
    if (typeof (value as unknown as { materialize?: unknown }).materialize !== "function") {
      return value as unknown as CachedImage;
    }
    const bin: ImageBinary = await value.materialize();
    return {
      kind: "image-binary",
      width: bin.width,
      height: bin.height,
      channels: bin.channels,
      data: bin.data,
    };
  },
  async deserialize(cached) {
    if ((cached as unknown as { kind?: string }).kind !== "image-binary") {
      return cached as unknown as GpuImage;
    }
    return CpuImage.fromImageBinary({
      data: cached.data,
      width: cached.width,
      height: cached.height,
      channels: cached.channels,
    }) as unknown as GpuImage;
  },
});
