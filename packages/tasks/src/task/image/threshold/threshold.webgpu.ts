/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { ThresholdParams } from "./threshold.cpu";

registerFilterOp<ThresholdParams>("webgpu", "threshold", (image, { value }) => {
  const buf = new ArrayBuffer(16); // std140 alignment: scalar in 16-byte slot
  new Float32Array(buf, 0, 1)[0] = value;
  return (image as WebGpuImage).apply({ shader: "threshold", uniforms: buf });
});
