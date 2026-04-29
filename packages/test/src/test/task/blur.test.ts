/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { ImageBlurTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImageBlurTask (cpu)", () => {
  test("blurs center white pixel on 3x3 black image", async () => {
    // 3x3 single-channel: center=255, rest=0
    const data = new Uint8ClampedArray(9);
    data[4] = 255; // center pixel
    const image = CpuImage.fromImageBinary({ data, width: 3, height: 3, channels: 1 }) as unknown as GpuImage;
    const t = new ImageBlurTask();
    const out = await t.execute({ image, radius: 1 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    // center: horizontal pass tmp[1,1]=(255/3+0.5)|0=85; vertical pass (85/3+0.5)|0=28
    expect(bin.data[4]).toBe(28);
  });

  test("preserves dimensions", async () => {
    const data = new Uint8ClampedArray(8 * 8 * 3).fill(100);
    const image = CpuImage.fromImageBinary({ data, width: 8, height: 8, channels: 3 }) as unknown as GpuImage;
    const t = new ImageBlurTask();
    const out = await t.execute({ image, radius: 1 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.width).toBe(8);
    expect(bin.height).toBe(8);
    expect(bin.channels).toBe(3);
  });

  test("solid color image is unchanged", async () => {
    const data = new Uint8ClampedArray(4 * 4).fill(128);
    const image = CpuImage.fromImageBinary({ data, width: 4, height: 4, channels: 1 }) as unknown as GpuImage;
    const t = new ImageBlurTask();
    const out = await t.execute({ image, radius: 2 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    for (let i = 0; i < bin.data.length; i++) {
      expect(bin.data[i]).toBe(128);
    }
  });
});
