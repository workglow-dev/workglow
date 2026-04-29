/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { TransparencyParams } from "./transparency.cpu";

registerFilterOp<TransparencyParams>("webgpu", "transparency", (image, _params, opts) => {
  return (image as WebGpuImage).apply({ shader: "transparency", uniforms: undefined, releaseSource: opts.releaseSource });
});
