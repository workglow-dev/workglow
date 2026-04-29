/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { ImageThresholdTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImageThresholdTask (cpu)", () => {
  test("channel >= threshold becomes 255", async () => {
    const data = new Uint8ClampedArray([200, 50, 128, 255]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 }) as unknown as GpuImage;
    const t = new ImageThresholdTask();
    const out = await t.execute({ image, value: 128 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.data[0]).toBe(255);
    expect(bin.data[1]).toBe(0);
    expect(bin.data[2]).toBe(255);
    expect(bin.data[3]).toBe(255);
  });

  test("preserves channels count", async () => {
    const data = new Uint8ClampedArray([200, 50, 255]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 3 }) as unknown as GpuImage;
    const t = new ImageThresholdTask();
    const out = await t.execute({ image, value: 128 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.channels).toBe(3);
    expect(bin.data[0]).toBe(255);
    expect(bin.data[1]).toBe(0);
    expect(bin.data[2]).toBe(255);
  });
});
