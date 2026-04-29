/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { ImageInvertTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImageInvertTask (cpu)", () => {
  test("inverts RGB channels and preserves alpha", async () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    const image = CpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 }) as unknown as GpuImage;
    const t = new ImageInvertTask();
    const out = await t.execute({ image } as never, {} as never);
    const bin = await (out!.image as GpuImage).materialize();
    expect(bin.data[0]).toBe(155);
    expect(bin.data[1]).toBe(105);
    expect(bin.data[2]).toBe(55);
    expect(bin.data[3]).toBe(255);
  });
});
