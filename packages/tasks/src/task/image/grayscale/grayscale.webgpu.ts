/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";

registerFilterOp<undefined>("webgpu", "grayscale", (image, _params) => {
  return (image as WebGpuImage).apply({ shader: "grayscale", uniforms: undefined });
});
