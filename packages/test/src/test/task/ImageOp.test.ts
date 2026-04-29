/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test, vi } from "vitest";
import { registerFilterOp, applyFilter } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("applyFilter", () => {
  test("dispatches to the registered cpu fn for CpuImage", () => {
    const cpu = vi.fn((img: GpuImage, _params: unknown) => img);
    registerFilterOp<{ k: number }>("cpu", "__test_dispatch__", cpu);
    const img = CpuImage.fromImageBinary({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
      channels: 4,
    }) as unknown as GpuImage;
    applyFilter(img, "__test_dispatch__", { k: 1 });
    expect(cpu).toHaveBeenCalledOnce();
    expect(cpu.mock.calls[0]?.[1]).toEqual({ k: 1 });
  });

  test("returns the value produced by the registered fn", () => {
    const sentinel = {} as unknown as GpuImage;
    registerFilterOp<undefined>("cpu", "__test_return__", () => sentinel);
    const img = CpuImage.fromImageBinary({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
      channels: 4,
    }) as unknown as GpuImage;
    expect(applyFilter(img, "__test_return__", undefined)).toBe(sentinel);
  });

  test("throws when no fn registered for backend/filter combo", () => {
    const img = CpuImage.fromImageBinary({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
      channels: 4,
    }) as unknown as GpuImage;
    expect(() => applyFilter(img, "__nonexistent__", undefined)).toThrow(
      /No "cpu" implementation registered for filter "__nonexistent__"/,
    );
  });
});
