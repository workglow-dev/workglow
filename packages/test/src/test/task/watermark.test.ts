/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/tasks";
import { ImageWatermarkTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImageWatermarkTask (cpu)", () => {
  test("composites watermark pattern onto image at default position", async () => {
    const bgData = new Uint8ClampedArray(8 * 8 * 4).fill(0);
    for (let i = 3; i < bgData.length; i += 4) bgData[i] = 255;
    const bg = CpuImage.fromImageBinary({
      data: bgData,
      width: 8,
      height: 8,
      channels: 4,
    }) as unknown as GpuImage;

    const t = new ImageWatermarkTask();
    const out = await t.execute({ image: bg } as never, {} as never);
    expect(out).toBeDefined();
    const bin = await (out!.image as unknown as GpuImage).materialize();
    expect(bin.width).toBe(8);
    expect(bin.height).toBe(8);
  });

  test("applies diagonal-lines pattern with small spacing and modifies pixels", async () => {
    const bgData = new Uint8ClampedArray(32 * 32 * 3).fill(50);
    const bg = CpuImage.fromImageBinary({
      data: bgData,
      width: 32,
      height: 32,
      channels: 3,
    }) as unknown as GpuImage;

    const t = new ImageWatermarkTask();
    const out = await t.execute(
      { image: bg, spacing: 8, opacity: 0.5, pattern: "diagonal-lines" } as never,
      {} as never
    );
    expect(out).toBeDefined();
    const bin = await (out!.image as unknown as GpuImage).materialize();
    expect(bin.width).toBe(32);
    expect(bin.height).toBe(32);
    expect(bin.channels).toBe(4);
    let hasModified = false;
    for (let i = 0; i < bin.data.length; i += 4) {
      if (bin.data[i]! !== 50) {
        hasModified = true;
        break;
      }
    }
    expect(hasModified).toBe(true);
  });
});
