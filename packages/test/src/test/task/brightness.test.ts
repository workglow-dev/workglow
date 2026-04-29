/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { ImageBrightnessTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImageBrightnessTask (cpu)", () => {
  test("adds amount to each RGB channel", async () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 }) as unknown as GpuImage;
    const t = new ImageBrightnessTask();
    const out = await t.execute({ image, amount: 20 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.data[0]).toBe(120);
    expect(bin.data[1]).toBe(170);
    expect(bin.data[2]).toBe(220);
    expect(bin.data[3]).toBe(255);
  });

  test("clamps at 255", async () => {
    const data = new Uint8ClampedArray([250, 250, 250, 255]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 }) as unknown as GpuImage;
    const t = new ImageBrightnessTask();
    const out = await t.execute({ image, amount: 20 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.data[0]).toBe(255);
    expect(bin.data[1]).toBe(255);
    expect(bin.data[2]).toBe(255);
    expect(bin.data[3]).toBe(255);
  });

  test("clamps at 0", async () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 }) as unknown as GpuImage;
    const t = new ImageBrightnessTask();
    const out = await t.execute({ image, amount: -50 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.data[0]).toBe(0);
    expect(bin.data[1]).toBe(0);
    expect(bin.data[2]).toBe(0);
    expect(bin.data[3]).toBe(255);
  });
});
