/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { PosterizeParams } from "./posterize.cpu";

registerFilterOp<PosterizeParams>("webgpu", "posterize", (image, _params) => {
  return (image as WebGpuImage).apply({ shader: "posterize", uniforms: undefined });
});
