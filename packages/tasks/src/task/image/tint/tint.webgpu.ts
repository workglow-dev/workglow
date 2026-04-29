/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { TintParams } from "./tint.cpu";

registerFilterOp<TintParams>("webgpu", "tint", (image, _params, opts) => {
  return (image as WebGpuImage).apply({ shader: "tint", uniforms: undefined, releaseSource: opts.releaseSource });
});
