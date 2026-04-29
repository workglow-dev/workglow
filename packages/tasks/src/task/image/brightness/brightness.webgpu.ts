/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { BrightnessParams } from "./brightness.cpu";

registerFilterOp<BrightnessParams>("webgpu", "brightness", (image, _params) => {
  return (image as WebGpuImage).apply({ shader: "brightness", uniforms: undefined });
});
