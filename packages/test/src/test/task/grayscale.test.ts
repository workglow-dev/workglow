/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { ImageGrayscaleTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImageGrayscaleTask (cpu)", () => {
  test("converts RGBA pixel to single-channel grayscale using luminance weights", async () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 }) as unknown as GpuImage;
    const t = new ImageGrayscaleTask();
    const out = await t.execute({ image } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    // (100*77 + 150*150 + 200*29) >> 8 = (7700 + 22500 + 5800) >> 8 = 36000 >> 8 = 140
    expect(bin.channels).toBe(1);
    expect(bin.data[0]).toBeGreaterThanOrEqual(138);
    expect(bin.data[0]).toBeLessThanOrEqual(142);
  });
});
