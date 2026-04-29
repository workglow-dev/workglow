/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { BlurParams } from "./blur.cpu";

registerFilterOp<BlurParams>("webgpu", "blur", (image, _params) => {
  return (image as WebGpuImage).apply({ shader: "blur", uniforms: undefined });
});
