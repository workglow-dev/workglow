/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { registerFilterOp, SharpImage } from "@workglow/util/media";

registerFilterOp<undefined>("sharp", "invert", (image, _params) => {
  return (image as SharpImage).apply((p) => p.negate({ alpha: false }));
});
