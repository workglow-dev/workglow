/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { CropParams } from "./crop.cpu";

registerFilterOp<CropParams>("webgpu", "crop", (image, { left, top, width, height }) => {
  const w = (image as WebGpuImage).width;
  const h = (image as WebGpuImage).height;
  const buf = new ArrayBuffer(32);
  const f = new Float32Array(buf);
  f[0] = left;
  f[1] = top;
  f[2] = w;
  f[3] = h;
  f[4] = width;
  f[5] = height;
  return (image as WebGpuImage).apply({
    shader: "crop",
    uniforms: buf,
    outSize: { width, height },
  });
});
