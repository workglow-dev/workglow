/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { ImagePixelateTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImagePixelateTask (cpu)", () => {
  test("each 2x2 block is uniform (average of block pixels)", async () => {
    // 4x4 image where each pixel value is its flat index * 16
    const src = new Uint8ClampedArray(16);
    for (let i = 0; i < 16; i++) src[i] = i * 16;
    const image = CpuImage.fromImageBinary({ data: src, width: 4, height: 4, channels: 1 }) as unknown as GpuImage;
    const t = new ImagePixelateTask();
    const out = await t.execute({ image, blockSize: 2 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    // top-left 2x2 block: pixels 0,1,4,5 → values 0,16,64,80 → avg = (0+16+64+80)/4 = 40
    expect(bin.data[0]).toBe(bin.data[1]);
    expect(bin.data[0]).toBe(bin.data[4]);
    expect(bin.data[0]).toBe(bin.data[5]);
  });

  test("preserves dimensions", async () => {
    const data = new Uint8ClampedArray(8 * 8 * 3).fill(100);
    const image = CpuImage.fromImageBinary({ data, width: 8, height: 8, channels: 3 }) as unknown as GpuImage;
    const t = new ImagePixelateTask();
    const out = await t.execute({ image, blockSize: 4 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.width).toBe(8);
    expect(bin.height).toBe(8);
    expect(bin.channels).toBe(3);
  });

  test("solid color image is unchanged", async () => {
    const data = new Uint8ClampedArray(4 * 4).fill(200);
    const image = CpuImage.fromImageBinary({ data, width: 4, height: 4, channels: 1 }) as unknown as GpuImage;
    const t = new ImagePixelateTask();
    const out = await t.execute({ image, blockSize: 2 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    for (let i = 0; i < bin.data.length; i++) {
      expect(bin.data[i]).toBe(200);
    }
  });
});
