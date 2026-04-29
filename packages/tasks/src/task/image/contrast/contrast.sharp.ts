/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { SharpImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { ContrastParams } from "./contrast.cpu";

registerFilterOp<ContrastParams>("sharp", "contrast", (image, { amount }) => {
  const slope = (259 * (amount + 255)) / (255 * (259 - amount));
  const intercept = 128 - slope * 128;
  return (image as SharpImage).apply((p) => p.linear(slope, intercept));
});
