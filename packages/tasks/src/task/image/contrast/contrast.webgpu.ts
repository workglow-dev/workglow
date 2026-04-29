/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { ContrastParams } from "./contrast.cpu";

registerFilterOp<ContrastParams>("webgpu", "contrast", (image, _params, opts) => {
  return (image as WebGpuImage).apply({ shader: "contrast", uniforms: undefined, releaseSource: opts.releaseSource });
});
