/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { FlipParams } from "./flip.cpu";

const DIRECTION_TO_CODE = { horizontal: 0, vertical: 1 } as const;

registerFilterOp<FlipParams>("webgpu", "flip", (image, { direction }) => {
  const buf = new ArrayBuffer(16);
  new Uint32Array(buf, 0, 1)[0] = DIRECTION_TO_CODE[direction];
  return (image as WebGpuImage).apply({ shader: "flip", uniforms: buf });
});
