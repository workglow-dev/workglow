/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage, resolveColor } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { TintParams } from "./tint.cpu";

registerFilterOp<TintParams>("webgpu", "tint", (image, { color, amount }) => {
  const c = resolveColor(color);
  const buf = new ArrayBuffer(32); // vec4f (16) + amount (4) padded to vec4 alignment
  const f = new Float32Array(buf);
  f[0] = c.r / 255;
  f[1] = c.g / 255;
  f[2] = c.b / 255;
  f[3] = 1.0;
  f[4] = amount;
  return (image as WebGpuImage).apply({ shader: "tint", uniforms: buf });
});
