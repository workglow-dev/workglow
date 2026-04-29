/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { CropParams } from "./crop.cpu";

registerFilterOp<CropParams>("webgpu", "crop", (image, { left, top, width, height }, opts) => {
  return (image as WebGpuImage).apply({
    shader: "crop",
    uniforms: new Float32Array([left, top, width, height]).buffer,
    outSize: { width, height },
    releaseSource: opts.releaseSource,
  });
});
