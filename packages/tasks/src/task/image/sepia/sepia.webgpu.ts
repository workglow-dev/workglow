/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";

registerFilterOp<undefined>("webgpu", "sepia", (image, _params, opts) => {
  return (image as WebGpuImage).apply({ shader: "sepia", uniforms: undefined, releaseSource: opts.releaseSource });
});
