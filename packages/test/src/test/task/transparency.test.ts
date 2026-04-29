/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { ImageTransparencyTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImageTransparencyTask (cpu)", () => {
  test("multiplies alpha by amount", async () => {
    // alphaScale = round(0.5*255) = 128; srcAlpha=255
    // dst[3] = (255*128+127)/255 = 32767/255 ≈ 128.5 → 128
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 }) as unknown as GpuImage;
    const t = new ImageTransparencyTask();
    const out = await t.execute({ image, amount: 0.5 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.data[0]).toBe(100);
    expect(bin.data[1]).toBe(150);
    expect(bin.data[2]).toBe(200);
    expect(bin.data[3]).toBe(128);
  });

  test("amount 0 makes fully transparent", async () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 }) as unknown as GpuImage;
    const t = new ImageTransparencyTask();
    const out = await t.execute({ image, amount: 0 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.data[3]).toBe(0);
  });

  test("expands RGB to RGBA", async () => {
    const data = new Uint8ClampedArray([100, 150, 200]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 3 }) as unknown as GpuImage;
    const t = new ImageTransparencyTask();
    const out = await t.execute({ image, amount: 1 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.channels).toBe(4);
    expect(bin.data[0]).toBe(100);
    expect(bin.data[1]).toBe(150);
    expect(bin.data[2]).toBe(200);
  });
});
