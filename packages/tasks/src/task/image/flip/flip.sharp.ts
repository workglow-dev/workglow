/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { SharpImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { FlipParams } from "./flip.cpu";

registerFilterOp<FlipParams>("sharp", "flip", (image, { direction }) => {
  const sharp = image as SharpImage;
  return direction === "horizontal"
    ? sharp.apply((p) => p.flop())
    : sharp.apply((p) => p.flip());
});
