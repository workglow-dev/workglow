/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { PixelateParams } from "./pixelate.cpu";

registerFilterOp<PixelateParams>("webgpu", "pixelate", (image, { blockSize }) => {
  const w = (image as WebGpuImage).width;
  const h = (image as WebGpuImage).height;
  const buf = new ArrayBuffer(16);
  const u = new Uint32Array(buf);
  u[0] = Math.max(1, blockSize | 0);
  u[1] = w;
  u[2] = h;
  return (image as WebGpuImage).apply({ shader: "pixelate", uniforms: buf });
});
