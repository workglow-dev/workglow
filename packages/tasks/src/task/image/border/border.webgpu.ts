/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage, resolveColor } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { BorderParams } from "./border.cpu";

registerFilterOp<BorderParams>("webgpu", "border", (image, { borderWidth, color }) => {
  const w = (image as WebGpuImage).width;
  const h = (image as WebGpuImage).height;
  const c = resolveColor(color);
  const buf = new ArrayBuffer(32);
  const f = new Float32Array(buf);
  f[0] = c.r / 255;
  f[1] = c.g / 255;
  f[2] = c.b / 255;
  f[3] = c.a / 255;
  f[4] = borderWidth;
  f[5] = w;
  f[6] = h;
  return (image as WebGpuImage).apply({
    shader: "border",
    uniforms: buf,
    outSize: { width: w + 2 * borderWidth, height: h + 2 * borderWidth },
  });
});
