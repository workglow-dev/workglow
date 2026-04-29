/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import {
  CpuImage,
  previewSource,
  registerPreviewResizeFn,
  getPreviewBudget,
  setPreviewBudget,
} from "@workglow/util/media";
import type { GpuImage } from "@workglow/util/media";

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

describe("previewSource scale composition", () => {
  test("composes scale on downscale (input scale 1.0)", () => {
    const originalBudget = getPreviewBudget();
    setPreviewBudget(100);
    try {
      let stampedScale: number | undefined;
      const stubResult: GpuImage = {
        backend: "webgpu", width: 100, height: 100, channels: 4 as const, previewScale: 1.0,
        materialize: async () => ({ data: new Uint8ClampedArray(0), width: 100, height: 100, channels: 4 }),
        toCanvas: async () => {},
        encode: async () => new Uint8Array(0),
        retain() { return this; },
        release() {},
      };
      (stubResult as unknown as { _setPreviewScale(s: number): typeof stubResult })._setPreviewScale = (s) => {
        stampedScale = s;
        return stubResult;
      };
      registerPreviewResizeFn(() => stubResult);

      const input: GpuImage = {
        backend: "webgpu", width: 500, height: 500, channels: 4 as const, previewScale: 1.0,
        materialize: async () => ({ data: new Uint8ClampedArray(0), width: 500, height: 500, channels: 4 }),
        toCanvas: async () => {},
        encode: async () => new Uint8Array(0),
        retain() { return this; },
        release() {},
      };

      const result = previewSource(input);
      expect(result).toBe(stubResult);
      // ratio = 100/500 = 0.2; input.previewScale = 1.0; composed = 0.2.
      expect(stampedScale).toBeCloseTo(0.2, 5);
    } finally {
      setPreviewBudget(originalBudget);
    }
  });

  test("composes scale from non-1.0 input", () => {
    const originalBudget = getPreviewBudget();
    setPreviewBudget(100);
    try {
      let stampedScale: number | undefined;
      const stubResult: GpuImage = {
        backend: "webgpu", width: 100, height: 100, channels: 4 as const, previewScale: 1.0,
        materialize: async () => ({ data: new Uint8ClampedArray(0), width: 100, height: 100, channels: 4 }),
        toCanvas: async () => {},
        encode: async () => new Uint8Array(0),
        retain() { return this; },
        release() {},
      };
      (stubResult as unknown as { _setPreviewScale(s: number): typeof stubResult })._setPreviewScale = (s) => {
        stampedScale = s;
        return stubResult;
      };
      registerPreviewResizeFn(() => stubResult);

      const input: GpuImage = {
        backend: "webgpu", width: 500, height: 500, channels: 4 as const, previewScale: 0.5,
        materialize: async () => ({ data: new Uint8ClampedArray(0), width: 500, height: 500, channels: 4 }),
        toCanvas: async () => {},
        encode: async () => new Uint8Array(0),
        retain() { return this; },
        release() {},
      };

      previewSource(input);
      // ratio = 100/500 = 0.2; input.previewScale = 0.5; composed = 0.5*0.2 = 0.1.
      expect(stampedScale).toBeCloseTo(0.1, 5);
    } finally {
      setPreviewBudget(originalBudget);
    }
  });

  test("returns input unchanged when long edge ≤ budget", () => {
    const originalBudget = getPreviewBudget();
    setPreviewBudget(1000);
    try {
      const input: GpuImage = {
        backend: "webgpu", width: 500, height: 500, channels: 4 as const, previewScale: 0.4,
        materialize: async () => ({ data: new Uint8ClampedArray(0), width: 500, height: 500, channels: 4 }),
        toCanvas: async () => {},
        encode: async () => new Uint8Array(0),
        retain() { return this; },
        release() {},
      };
      const result = previewSource(input);
      expect(result).toBe(input);
      expect(result.previewScale).toBe(0.4);
    } finally {
      setPreviewBudget(originalBudget);
    }
  });
});
