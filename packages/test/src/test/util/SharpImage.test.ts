/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { SharpImage } from "@workglow/util/media";

// Skip in browser environments — sharp is server-only.
const isBrowser = typeof window !== "undefined";

describe.skipIf(isBrowser)("SharpImage", () => {
  test("backend tag is 'sharp'", async () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255]);
    const img = await SharpImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 });
    expect(img.backend).toBe("sharp");
  });

  test("fromImageBinary -> materialize round-trips pixels", async () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,   0, 255, 0, 255,
        0, 0, 255, 255, 128, 128, 128, 255,
    ]);
    const img = await SharpImage.fromImageBinary({ data, width: 2, height: 2, channels: 4 });
    const out = await img.materialize();
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.channels).toBe(4);
    expect(Array.from(out.data)).toEqual(Array.from(data));
  });

  test("encode('png') returns PNG-magic bytes", async () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(200);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const img = await SharpImage.fromImageBinary({ data, width: 4, height: 4, channels: 4 });
    const png = await img.encode("png");
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });

  test("apply forks the pipeline; original is unchanged after materialize", async () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255]);
    const img = await SharpImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 });
    const flipped = img.apply((p) => p.flip());
    expect(flipped).not.toBe(img);
    const orig = await img.materialize();
    expect(Array.from(orig.data)).toEqual([10, 20, 30, 255]);
    const out = await flipped.materialize();
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
  });

  test("toCanvas throws (server-only)", async () => {
    const data = new Uint8ClampedArray([1, 2, 3, 255]);
    const img = await SharpImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 });
    await expect(img.toCanvas({} as unknown as HTMLCanvasElement)).rejects.toThrow(/server|node|bun/i);
  });

  test("release does not throw (no-op; sharp manages buffers via libuv)", async () => {
    const data = new Uint8ClampedArray([1, 2, 3, 255]);
    const img = await SharpImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 });
    expect(() => img.release()).not.toThrow();
  });
});
