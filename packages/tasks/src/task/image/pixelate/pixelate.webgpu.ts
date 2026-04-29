/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { PixelateParams } from "./pixelate.cpu";

registerFilterOp<PixelateParams>("webgpu", "pixelate", (image, _params) => {
  return (image as WebGpuImage).apply({ shader: "pixelate", uniforms: undefined });
});
