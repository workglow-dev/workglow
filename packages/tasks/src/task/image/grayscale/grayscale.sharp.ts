/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { SharpImage } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";

registerFilterOp<undefined>("sharp", "grayscale", (image, _params) => {
  return (image as SharpImage).apply((p) => p.grayscale());
});
