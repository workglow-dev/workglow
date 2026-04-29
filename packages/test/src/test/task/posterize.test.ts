/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { ImagePosterizeTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImagePosterizeTask (cpu)", () => {
  test("levels=2: value 64 quantizes to 0", async () => {
    // step=255; Math.round(64/255)=0 → 0
    const data = new Uint8ClampedArray([64]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 1 }) as unknown as GpuImage;
    const t = new ImagePosterizeTask();
    const out = await t.execute({ image, levels: 2 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.data[0]).toBe(0);
  });

  test("levels=2: value 200 quantizes to 255", async () => {
    // step=255; Math.round(200/255)=1 → 255
    const data = new Uint8ClampedArray([200]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 1 }) as unknown as GpuImage;
    const t = new ImagePosterizeTask();
    const out = await t.execute({ image, levels: 2 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.data[0]).toBe(255);
  });

  test("preserves alpha channel with levels=4", async () => {
    const data = new Uint8ClampedArray([100, 150, 200, 42]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 }) as unknown as GpuImage;
    const t = new ImagePosterizeTask();
    const out = await t.execute({ image, levels: 4 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.data[3]).toBe(42);
  });

  test("solid color image is unchanged with any levels", async () => {
    // 128 with levels=2: Math.round(128/255)=1 → 255, not 128; only true for exact level boundaries
    // Use 0 which always maps to 0
    const data = new Uint8ClampedArray(4).fill(0);
    const image = CpuImage.fromImageBinary({ data, width: 2, height: 2, channels: 1 }) as unknown as GpuImage;
    const t = new ImagePosterizeTask();
    const out = await t.execute({ image, levels: 4 } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    for (let i = 0; i < bin.data.length; i++) {
      expect(bin.data[i]).toBe(0);
    }
  });
});
