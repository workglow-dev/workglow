/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { registerFilterOp, SharpImage } from "@workglow/util/media";

registerFilterOp<undefined>("sharp", "grayscale", (image, _params) => {
  return (image as SharpImage).apply((p) => p.grayscale());
});
