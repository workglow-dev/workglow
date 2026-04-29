/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { ResizeParams } from "./resize.cpu";

registerFilterOp<ResizeParams>("webgpu", "resize", (image, { width, height }) => {
  return (image as WebGpuImage).apply({
    shader: "resize",
    uniforms: undefined,
    outSize: { width, height },
  });
});
