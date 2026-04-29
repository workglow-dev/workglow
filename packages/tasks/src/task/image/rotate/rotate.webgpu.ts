/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { RotateParams } from "./rotate.cpu";

registerFilterOp<RotateParams>("webgpu", "rotate", (image, { angle }) => {
  const w = (image as WebGpuImage).width;
  const h = (image as WebGpuImage).height;
  const swap = angle === 90 || angle === 270;
  const buf = new ArrayBuffer(16);
  new Uint32Array(buf, 0, 1)[0] = angle;
  return (image as WebGpuImage).apply({
    shader: "rotate",
    uniforms: buf,
    outSize: { width: swap ? h : w, height: swap ? w : h },
  });
});
