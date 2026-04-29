/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { ImageFlipTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImageFlipTask (cpu)", () => {
  test("flips 2x1 RGBA image horizontally", async () => {
    const data = new Uint8ClampedArray([10, 0, 0, 255, 20, 0, 0, 255]);
    const image = CpuImage.fromImageBinary({ data, width: 2, height: 1, channels: 4 }) as unknown as GpuImage;
    const t = new ImageFlipTask();
    const out = await t.execute({ image, direction: "horizontal" } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(Array.from(bin.data.slice(0, 4))).toEqual([20, 0, 0, 255]);
    expect(Array.from(bin.data.slice(4, 8))).toEqual([10, 0, 0, 255]);
  });

  test("flips 1x3 single-channel image vertically", async () => {
    const data = new Uint8ClampedArray([10, 20, 30]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 3, channels: 1 }) as unknown as GpuImage;
    const t = new ImageFlipTask();
    const out = await t.execute({ image, direction: "vertical" } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.data[0]).toBe(30);
    expect(bin.data[1]).toBe(20);
    expect(bin.data[2]).toBe(10);
  });

  test("horizontal flip preserves dimensions", async () => {
    const data = new Uint8ClampedArray(4 * 4 * 3).fill(128);
    const image = CpuImage.fromImageBinary({ data, width: 4, height: 4, channels: 3 }) as unknown as GpuImage;
    const t = new ImageFlipTask();
    const out = await t.execute({ image, direction: "horizontal" } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.width).toBe(4);
    expect(bin.height).toBe(4);
    expect(bin.channels).toBe(3);
  });
});
