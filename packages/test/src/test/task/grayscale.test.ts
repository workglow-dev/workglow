/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { ImageGrayscaleTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImageGrayscaleTask (cpu)", () => {
  test("converts RGBA pixel to 4-channel grayscale with replicated luma", async () => {
    const data = new Uint8ClampedArray([200, 100, 50, 255]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 }) as unknown as GpuImage;
    const t = new ImageGrayscaleTask();
    const out = await t.execute({ image } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    // BT.601-style: (200*77 + 100*150 + 50*29) >> 8 = (15400 + 15000 + 1450) >> 8 = 31850 >> 8 = 124
    expect(bin.channels).toBe(4);
    expect(Array.from(bin.data.slice(0, 4))).toEqual([124, 124, 124, 255]);
  });
});
