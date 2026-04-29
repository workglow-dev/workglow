/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { ImageCropTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImageCropTask (cpu)", () => {
  test("crop top-left 1x1 from 2x2 returns top-left pixel", async () => {
    const data = new Uint8ClampedArray([
      10, 20, 30, 255,   50, 60, 70, 255,
      80, 90, 100, 255,  110, 120, 130, 255,
    ]);
    const image = CpuImage.fromImageBinary({ data, width: 2, height: 2, channels: 4 }) as unknown as GpuImage;
    const t = new ImageCropTask();
    const out = await t.execute({ image, left: 0, top: 0, width: 1, height: 1 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.width).toBe(1);
    expect(bin.height).toBe(1);
    expect(bin.data[0]).toBe(10);
    expect(bin.data[1]).toBe(20);
    expect(bin.data[2]).toBe(30);
  });

  test("crop clamps to image bounds", async () => {
    const data = new Uint8ClampedArray(4 * 4 * 3).fill(128);
    const image = CpuImage.fromImageBinary({ data, width: 4, height: 4, channels: 3 }) as unknown as GpuImage;
    const t = new ImageCropTask();
    const out = await t.execute({ image, left: 3, top: 3, width: 10, height: 10 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.width).toBe(1);
    expect(bin.height).toBe(1);
  });

  test("crop preserves channels", async () => {
    const data = new Uint8ClampedArray(4 * 4 * 1).fill(200);
    const image = CpuImage.fromImageBinary({ data, width: 4, height: 4, channels: 1 }) as unknown as GpuImage;
    const t = new ImageCropTask();
    const out = await t.execute({ image, left: 1, top: 1, width: 2, height: 2 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.width).toBe(2);
    expect(bin.height).toBe(2);
    expect(bin.channels).toBe(1);
  });
});
