/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { registerFilterOp, SharpImage } from "@workglow/util/media";
import type { BlurParams } from "./blur.cpu";

registerFilterOp<BlurParams>("sharp", "blur", (image, { radius }) => {
  return (image as SharpImage).apply((p) => p.blur(radius * 0.5));
});
