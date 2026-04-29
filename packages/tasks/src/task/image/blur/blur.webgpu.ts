/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { BlurParams } from "./blur.cpu";

function makeUniforms(
  radius: number,
  direction: 0 | 1,
  width: number,
  height: number
): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const u = new Uint32Array(buf, 0, 2);
  u[0] = Math.max(1, radius | 0);
  u[1] = direction;
  const f = new Float32Array(buf, 8, 2);
  f[0] = width;
  f[1] = height;
  return buf;
}

registerFilterOp<BlurParams>("webgpu", "blur", (image, { radius }) => {
  const w = (image as WebGpuImage).width;
  const h = (image as WebGpuImage).height;
  const horiz = (image as WebGpuImage).apply({
    shader: "blur",
    uniforms: makeUniforms(radius, 0, w, h),
  });
  const vert = horiz.apply({ shader: "blur", uniforms: makeUniforms(radius, 1, w, h) });
  horiz.release();
  return vert;
});
