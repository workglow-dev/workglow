/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

// Lean side-effect entry: registers the image raster codec AND every
// filter op available on this platform (cpu + webgpu). Use this from
// tests and other contexts that need full filter dispatch but don't
// want the full @workglow/tasks barrel.
import "./task/image/registerImageRasterCodec.browser";

// CPU arms — cross-platform.
import "./task/image/blur/blur.cpu";
import "./task/image/border/border.cpu";
import "./task/image/brightness/brightness.cpu";
import "./task/image/contrast/contrast.cpu";
import "./task/image/crop/crop.cpu";
import "./task/image/flip/flip.cpu";
import "./task/image/grayscale/grayscale.cpu";
import "./task/image/invert/invert.cpu";
import "./task/image/pixelate/pixelate.cpu";
import "./task/image/posterize/posterize.cpu";
import "./task/image/resize/resize.cpu";
import "./task/image/rotate/rotate.cpu";
import "./task/image/sepia/sepia.cpu";
import "./task/image/threshold/threshold.cpu";
import "./task/image/tint/tint.cpu";
import "./task/image/transparency/transparency.cpu";

// WebGPU arms — browser-only.
import "./task/image/blur/blur.webgpu";
import "./task/image/border/border.webgpu";
import "./task/image/brightness/brightness.webgpu";
import "./task/image/contrast/contrast.webgpu";
import "./task/image/crop/crop.webgpu";
import "./task/image/flip/flip.webgpu";
import "./task/image/grayscale/grayscale.webgpu";
import "./task/image/invert/invert.webgpu";
import "./task/image/pixelate/pixelate.webgpu";
import "./task/image/posterize/posterize.webgpu";
import "./task/image/resize/resize.webgpu";
import "./task/image/rotate/rotate.webgpu";
import "./task/image/sepia/sepia.webgpu";
import "./task/image/threshold/threshold.webgpu";
import "./task/image/tint/tint.webgpu";
import "./task/image/transparency/transparency.webgpu";

// Wire previewSource (in @workglow/util/media) to the local applyFilter so
// preview-mode chains can downscale at the head. Registered here rather than
// inside util/media to avoid the cycle (tasks → util only). previewSource
// short-circuits non-webgpu inputs, so this callback is only invoked when a
// WebGpuImage exceeds the budget.
import { registerPreviewResizeFn } from "@workglow/util/media";
import { applyFilter } from "./task/image/imageOp";

registerPreviewResizeFn((image, width, height) =>
  applyFilter(image, "resize", { width, height })
);
