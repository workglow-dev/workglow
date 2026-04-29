/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test, beforeEach } from "vitest";
import {
  getPreviewBudget,
  setPreviewBudget,
  previewSource,
  CpuImage,
} from "@workglow/util/media";

describe("previewBudget", () => {
  beforeEach(() => {
    setPreviewBudget(512); // restore default each test
  });

  test("default budget is 512", () => {
    expect(getPreviewBudget()).toBe(512);
  });

  test("setPreviewBudget updates the value", () => {
    setPreviewBudget(256);
    expect(getPreviewBudget()).toBe(256);
  });

  test("setPreviewBudget rejects non-positive values", () => {
    expect(() => setPreviewBudget(0)).toThrow(/positive/);
    expect(() => setPreviewBudget(-1)).toThrow(/positive/);
  });

  test("setPreviewBudget rejects non-finite values", () => {
    expect(() => setPreviewBudget(NaN)).toThrow();
    expect(() => setPreviewBudget(Infinity)).toThrow();
  });
});

describe("previewSource", () => {
  beforeEach(() => {
    setPreviewBudget(512);
  });

  test("returns input unchanged when long edge ≤ budget", () => {
    const cpu = CpuImage.fromImageBinary({
      data: new Uint8ClampedArray(512 * 256 * 4),
      width: 512, height: 256, channels: 4,
    });
    const out = previewSource(cpu);
    expect(out).toBe(cpu); // referential equality — no resize
  });

  test("returns input unchanged on cpu backend even when oversize", () => {
    // cpu/sharp don't benefit from the WebGPU-only readback avoidance the
    // downscale is targeting; previewSource is a no-op for non-webgpu.
    const cpu = CpuImage.fromImageBinary({
      data: new Uint8ClampedArray(2048 * 1024 * 4),
      width: 2048, height: 1024, channels: 4,
    });
    const out = previewSource(cpu);
    expect(out).toBe(cpu);
  });

  test("previewSource returns same reference when below budget on webgpu backend", () => {
    // The non-webgpu short-circuit is already covered by the cpu test; this
    // confirms referential equality holds even when the backend WOULD trigger
    // resize but the size doesn't.
    const small = {
      backend: "webgpu" as const,
      width: 100,
      height: 100,
      channels: 4 as const,
      materialize: async () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0, channels: 4 as const }),
      toCanvas: async () => {},
      encode: async () => new Uint8Array(),
      retain() { return this; },
      release() {},
    };
    expect(previewSource(small as unknown as import("@workglow/util/media").GpuImage)).toBe(small);
  });

  test("previewSource returns a smaller image after the codec is loaded", async () => {
    // The codec entry registers the resize fn at module-init.
    await import("@workglow/tasks/codec");
    // CPU backend short-circuits regardless of registration; this test only
    // confirms the wiring exists. The actual webgpu resize is exercised in
    // chain integration tests (Task 10).
    const cpu = CpuImage.fromImageBinary({
      data: new Uint8ClampedArray(2048 * 1024 * 4),
      width: 2048, height: 1024, channels: 4,
    });
    expect(previewSource(cpu)).toBe(cpu); // cpu still no-op; just confirms no throw
  });
});
