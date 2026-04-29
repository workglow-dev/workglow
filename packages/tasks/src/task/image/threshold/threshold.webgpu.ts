/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { ThresholdParams } from "./threshold.cpu";

registerFilterOp<ThresholdParams>("webgpu", "threshold", (image, _params, opts) => {
  return (image as WebGpuImage).apply({ shader: "threshold", uniforms: undefined, releaseSource: opts.releaseSource });
});
