/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import { CpuImage } from "@workglow/util/media";

describe("previewScale defaults", () => {
  test("CpuImage.fromImageBinary defaults previewScale to 1.0", () => {
    const bin = { data: new Uint8ClampedArray(4), width: 1, height: 1, channels: 4 as const };
    const img = CpuImage.fromImageBinary(bin);
    expect(img.previewScale).toBe(1.0);
  });

  test("CpuImage.fromImageBinary accepts an explicit previewScale", () => {
    const bin = { data: new Uint8ClampedArray(4), width: 1, height: 1, channels: 4 as const };
    const img = CpuImage.fromImageBinary(bin, 0.25);
    expect(img.previewScale).toBe(0.25);
  });

  test("CpuImage._setPreviewScale mutates and returns this", () => {
    const bin = { data: new Uint8ClampedArray(4), width: 1, height: 1, channels: 4 as const };
    const img = CpuImage.fromImageBinary(bin);
    const ret = (img as unknown as { _setPreviewScale(s: number): typeof img })._setPreviewScale(0.4);
    expect(ret).toBe(img);
    expect(img.previewScale).toBe(0.4);
  });
});
