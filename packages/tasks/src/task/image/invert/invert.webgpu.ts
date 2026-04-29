/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";

registerFilterOp<undefined>("webgpu", "invert", (image, _params, opts) => {
  return (image as WebGpuImage).apply({ shader: "invert", uniforms: undefined, releaseSource: opts.releaseSource });
});
