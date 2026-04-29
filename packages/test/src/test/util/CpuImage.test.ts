/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/tasks";
import { CpuImage } from "@workglow/util/media";

function makeBinary(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4 + 0] = i & 0xff;
    data[i * 4 + 1] = (i >> 8) & 0xff;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h, channels: 4 as const };
}

describe("CpuImage", () => {
  test("backend tag is 'cpu'", () => {
    const img = CpuImage.fromImageBinary(makeBinary(2, 2));
    expect(img.backend).toBe("cpu");
  });

  test("width/height/channels expose the wrapped binary", () => {
    const img = CpuImage.fromImageBinary(makeBinary(4, 3));
    expect(img.width).toBe(4);
    expect(img.height).toBe(3);
    expect(img.channels).toBe(4);
  });

  test("materialize returns the wrapped ImageBinary by reference (no copy)", async () => {
    const bin = makeBinary(4, 4);
    const img = CpuImage.fromImageBinary(bin);
    const out = await img.materialize();
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect(out.channels).toBe(4);
    expect(out.data).toBe(bin.data); // same reference
  });

  test("encode round-trips through the registered raster codec (PNG)", async () => {
    const img = CpuImage.fromImageBinary(makeBinary(2, 2));
    const png = await img.encode("png");
    expect(png).toBeInstanceOf(Uint8Array);
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });

  test("getBinary() returns the wrapped binary directly (internal accessor)", () => {
    const bin = makeBinary(1, 1);
    const img = CpuImage.fromImageBinary(bin);
    expect(img.getBinary()).toBe(bin);
  });

  test("release is a no-op (does not throw)", () => {
    const img = CpuImage.fromImageBinary(makeBinary(1, 1));
    expect(() => img.release()).not.toThrow();
  });

  test("retain/release are no-ops and do not throw", () => {
    const cpu = CpuImage.fromImageBinary({
      data: new Uint8ClampedArray(4), width: 1, height: 1, channels: 4,
    });
    expect(() => { cpu.retain(); cpu.release(); cpu.release(); cpu.retain(); }).not.toThrow();
  });
});
