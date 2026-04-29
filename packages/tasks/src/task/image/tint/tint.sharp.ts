/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { SharpImage, registerFilterOp, resolveColor } from "@workglow/util/media";
import type { TintParams } from "./tint.cpu";

registerFilterOp<TintParams>("sharp", "tint", (image, { color }) => {
  const { r, g, b } = resolveColor(color);
  return (image as SharpImage).apply((p) => p.tint({ r, g, b }));
});
