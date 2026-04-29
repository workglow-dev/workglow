/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test, beforeEach } from "vitest";
import {
  getGpuDevice,
  resetGpuDeviceForTests,
  resetTexturePoolForTests,
  type ApplyParams,
  type WebGpuImage as WebGpuImageType,
} from "@workglow/util/media";

const isBrowser = typeof window !== "undefined";

// WebGpuImage is browser-only at runtime; dynamic import resolves correctly
// in browser context. In node, only the type is available.
async function getWebGpuImage(): Promise<typeof WebGpuImageType> {
  const media = await import("@workglow/util/media");
  return (media as unknown as { WebGpuImage: typeof WebGpuImageType }).WebGpuImage;
}

describe("WebGpuImage (API surface)", () => {
  test.skipIf(!isBrowser)("module exports WebGpuImage class in browser", async () => {
    const WebGpuImage = await getWebGpuImage();
    expect(typeof WebGpuImage).toBe("function");
    expect(typeof WebGpuImage.fromImageBinary).toBe("function");
  });

  test("ApplyParams type is structurally exported (compile-time)", () => {
    const p: ApplyParams = { shader: "passthrough", uniforms: undefined };
    expect(p.shader).toBe("passthrough");
  });
});

describe.skipIf(typeof navigator === "undefined" || !("gpu" in navigator))("WebGpuImage (browser)", () => {
  beforeEach(() => {
    resetGpuDeviceForTests();
    resetTexturePoolForTests();
  });

  test("fromImageBinary materialize round-trips pixels exactly", async () => {
    const WebGpuImage = await getWebGpuImage();
    const dev = await getGpuDevice();
    if (!dev) return;
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,   0, 255, 0, 255,
        0, 0, 255, 255, 255, 255, 0, 255,
    ]);
    const img = await WebGpuImage.fromImageBinary({ data, width: 2, height: 2, channels: 4 });
    expect(img.backend).toBe("webgpu");
    const out = await img.materialize();
    expect(Array.from(out.data)).toEqual(Array.from(data));
    img.release();
  });

  test("apply(passthrough) returns a new texture and releases the source", async () => {
    const WebGpuImage = await getWebGpuImage();
    const dev = await getGpuDevice();
    if (!dev) return;
    const data = new Uint8ClampedArray([10, 20, 30, 255]);
    const img = await WebGpuImage.fromImageBinary({ data, width: 1, height: 1, channels: 4 });
    const out = img.apply({ shader: "passthrough", uniforms: undefined });
    expect(out).not.toBe(img);
    const bin = await out.materialize();
    expect(Array.from(bin.data)).toEqual([10, 20, 30, 255]);
    out.release();
  });

  test("encode('png') returns PNG-magic bytes", async () => {
    const WebGpuImage = await getWebGpuImage();
    const dev = await getGpuDevice();
    if (!dev) return;
    const data = new Uint8ClampedArray(2 * 2 * 4).fill(128);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const img = await WebGpuImage.fromImageBinary({ data, width: 2, height: 2, channels: 4 });
    const bytes = await img.encode("png");
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    img.release();
  });
});
