/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { registerFilterOp, SharpImage } from "@workglow/util/media";
import type { ThresholdParams } from "./threshold.cpu";

registerFilterOp<ThresholdParams>("sharp", "threshold", (image, { value }) => {
  return (image as SharpImage).apply((p) => p.threshold(value));
});
