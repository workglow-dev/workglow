/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage, resolveColor } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { BorderParams } from "./border.cpu";

registerFilterOp<BorderParams>("webgpu", "border", (image, { borderWidth: bw, color }) => {
  const gpu = image as WebGpuImage;
  const resolved = resolveColor(color);
  const outW = gpu.width + bw * 2;
  const outH = gpu.height + bw * 2;
  return gpu.apply({
    shader: "border",
    uniforms: new Float32Array([bw, resolved.r / 255, resolved.g / 255, resolved.b / 255]).buffer,
    outSize: { width: outW, height: outH },
  });
});
