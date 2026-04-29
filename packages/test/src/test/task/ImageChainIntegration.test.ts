/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/util/media";
import "@workglow/tasks";
import {
  ImageBlurTask, ImageBorderTask, ImageFlipTask, ImagePixelateTask,
  ImagePosterizeTask, ImageSepiaTask, ImageTextTask,
} from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

async function runChain(start: GpuImage): Promise<GpuImage> {
  let img = start;
  img = (await new ImageTextTask().executePreview({
    image: img, text: "GO", font: "sans-serif", fontSize: 12, bold: false, italic: false,
    color: "#ffffff", position: "middle-center",
  } as never, {} as never))!.image as GpuImage;
  img = (await new ImageFlipTask().executePreview({ image: img, direction: "horizontal" } as never, {} as never))!.image as GpuImage;
  img = (await new ImageSepiaTask().executePreview({ image: img } as never, {} as never))!.image as GpuImage;
  img = (await new ImageBlurTask().executePreview({ image: img, radius: 1 } as never, {} as never))!.image as GpuImage;
  img = (await new ImagePosterizeTask().executePreview({ image: img, levels: 4 } as never, {} as never))!.image as GpuImage;
  img = (await new ImageBorderTask().executePreview({ image: img, borderWidth: 2, color: "#000000" } as never, {} as never))!.image as GpuImage;
  img = (await new ImagePixelateTask().executePreview({ image: img, blockSize: 2 } as never, {} as never))!.image as GpuImage;
  return img;
}

describe("7-stage chain integration (CPU)", () => {
  test("chain runs without error and produces deterministic dimensions", async () => {
    const bin = { data: new Uint8ClampedArray(64 * 64 * 4).fill(100), width: 64, height: 64, channels: 4 as const };
    for (let i = 3; i < bin.data.length; i += 4) bin.data[i] = 255;
    const start = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
    const end = await runChain(start);
    const out = await end.materialize();
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
    // Smoke test: there's actual content, not all zeros.
    let nonZero = 0;
    for (let i = 0; i < out.data.length; i++) if (out.data[i]! > 0) nonZero++;
    expect(nonZero).toBeGreaterThan(out.data.length / 4);
  });
});
