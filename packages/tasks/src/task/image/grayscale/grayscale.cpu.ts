/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, type ImageBinary } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";

function cpuGrayscale(bin: ImageBinary): ImageBinary {
  const { data: src, width, height, channels } = bin;

  if (channels === 1) {
    return { data: new Uint8ClampedArray(src), width, height, channels: 1 };
  }

  const pixelCount = width * height;
  const dst = new Uint8ClampedArray(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * channels;
    dst[i] = (src[idx]! * 77 + src[idx + 1]! * 150 + src[idx + 2]! * 29) >> 8;
  }

  return { data: dst, width, height, channels: 1 };
}

registerFilterOp<undefined>("cpu", "grayscale", (image, _params) => {
  return CpuImage.fromImageBinary(cpuGrayscale((image as CpuImage).getBinary()));
});
