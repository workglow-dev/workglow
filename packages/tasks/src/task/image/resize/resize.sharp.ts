/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { SharpImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { ResizeParams } from "./resize.cpu";

registerFilterOp<ResizeParams>("sharp", "resize", (image, { width, height, fit, kernel }) => {
  return (image as SharpImage).apply(
    (p) => p.resize(width, height, { fit, kernel }),
    { width, height },
  );
});
