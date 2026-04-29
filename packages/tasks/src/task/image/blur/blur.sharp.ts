/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { SharpImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { BlurParams } from "./blur.cpu";

registerFilterOp<BlurParams>("sharp", "blur", (image, { radius }) => {
  return (image as SharpImage).apply((p) => p.blur(radius * 0.5));
});
