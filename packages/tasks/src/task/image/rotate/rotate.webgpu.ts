/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { RotateParams } from "./rotate.cpu";

registerFilterOp<RotateParams>("webgpu", "rotate", (image, { angle }, opts) => {
  const gpu = image as WebGpuImage;
  const swap = angle === 90 || angle === 270;
  const outW = swap ? gpu.height : gpu.width;
  const outH = swap ? gpu.width : gpu.height;
  return gpu.apply({
    shader: "rotate",
    uniforms: new Float32Array([angle, 0, 0, 0]).buffer,
    outSize: { width: outW, height: outH },
    releaseSource: opts.releaseSource,
  });
});
