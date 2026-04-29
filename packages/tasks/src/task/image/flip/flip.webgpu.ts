/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { FlipParams } from "./flip.cpu";

registerFilterOp<FlipParams>("webgpu", "flip", (image, { direction }) => {
  return (image as WebGpuImage).apply({
    shader: "flip",
    uniforms: new Float32Array([direction === "horizontal" ? 1 : 0, 0, 0, 0]).buffer });
});
