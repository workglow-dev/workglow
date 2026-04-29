/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { registerFilterOp, SharpImage } from "@workglow/util/media";
import type { BrightnessParams } from "./brightness.cpu";

registerFilterOp<BrightnessParams>("sharp", "brightness", (image, { amount }) => {
  return (image as SharpImage).apply((p) => p.linear(1, amount));
});
