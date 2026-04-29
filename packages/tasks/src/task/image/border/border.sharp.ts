/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { SharpImage, resolveColor } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";
import type { BorderParams } from "./border.cpu";

registerFilterOp<BorderParams>("sharp", "border", (image, { borderWidth: bw, color }) => {
  const sharp = image as SharpImage;
  const resolved = resolveColor(color);
  const outW = sharp.width + bw * 2;
  const outH = sharp.height + bw * 2;
  return sharp.apply(
    (p) => p.extend({
      top: bw,
      bottom: bw,
      left: bw,
      right: bw,
      background: { r: resolved.r, g: resolved.g, b: resolved.b, alpha: resolved.a / 255 },
    }),
    { width: outW, height: outH },
  );
});
