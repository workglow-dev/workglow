/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/util/media";
import { CpuImage, type GpuImage } from "@workglow/util/media";
import { getPortCodec } from "@workglow/task-graph";

describe("image port codec", () => {
  test("serialize materializes a GpuImage to a CachedImage shape", async () => {
    const bin = { data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1, channels: 4 as const };
    const img = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
    const codec = getPortCodec("image");
    expect(codec).toBeDefined();
    const wire = (await codec!.serialize(img)) as { kind: string; width: number; height: number; channels: number; data: Uint8ClampedArray };
    expect(wire.kind).toBe("image-binary");
    expect(wire.width).toBe(1);
    expect(wire.height).toBe(1);
    expect(wire.channels).toBe(4);
    expect(Array.from(wire.data)).toEqual([1, 2, 3, 255]);
  });

  test("deserialize round-trips back to a GpuImage that materializes correctly", async () => {
    const codec = getPortCodec("image");
    const live = (await codec!.deserialize({
      kind: "image-binary",
      width: 1,
      height: 1,
      channels: 4,
      data: new Uint8ClampedArray([10, 20, 30, 255]),
    })) as GpuImage;
    expect(live.width).toBe(1);
    expect(live.backend).toBe("cpu");
    const out = await live.materialize();
    expect(Array.from(out.data)).toEqual([10, 20, 30, 255]);
  });
});
