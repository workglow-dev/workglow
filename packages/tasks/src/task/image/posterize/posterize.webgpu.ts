/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { PosterizeParams } from "./posterize.cpu";

registerFilterOp<PosterizeParams>("webgpu", "posterize", (image, { levels }) => {
  const buf = new ArrayBuffer(16);
  new Float32Array(buf, 0, 1)[0] = levels;
  return (image as WebGpuImage).apply({ shader: "posterize", uniforms: buf });
});
