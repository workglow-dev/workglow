/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import type { GpuImage } from "@workglow/util/media";
import type { ModelConfig } from "@workglow/ai";
import { AiImageOutputTask } from "@workglow/ai";

// Test subclass: overrides the abstract bits with concrete schemas.
class _TestImageTask extends AiImageOutputTask<{ prompt: string; model: ModelConfig | string; seed?: number; aspectRatio?: string }> {
  public static override type = "_TestImageTask";
  public static override category = "Test";
  public static override inputSchema() {
    return {
      type: "object",
      properties: {
        prompt: { type: "string" },
        model: { type: "string", format: "model:_TestImageTask" },
        seed: { type: "number" },
        aspectRatio: { type: "string" },
      },
      required: ["prompt", "model"],
      additionalProperties: false,
    } as any;
  }
}

function fakeGpuImage(label: string): GpuImage {
  let count = 1;
  let released = false;
  return {
    width: 8,
    height: 8,
    channels: 4,
    backend: "cpu",
    previewScale: 1,
    materialize: async () => ({ data: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8, channels: 4 }) as any,
    toCanvas: async () => {},
    encode: async () => new Uint8Array(),
    retain(n = 1) {
      if (released) throw new Error(`retain after release: ${label}`);
      count += n;
      return this;
    },
    release() {
      if (released) throw new Error(`double release: ${label}`);
      count -= 1;
      if (count === 0) released = true;
    },
  } as unknown as GpuImage;
}

describe("AiImageOutputTask", () => {
  describe("seed-aware cacheable", () => {
    it("is not cacheable when seed is undefined", () => {
      const task = new _TestImageTask({});
      task.runInputData = { prompt: "x", model: "m" };
      expect(task.cacheable).toBe(false);
    });

    it("is cacheable when seed is set", () => {
      const task = new _TestImageTask({});
      task.runInputData = { prompt: "x", model: "m", seed: 42 };
      expect(task.cacheable).toBe(true);
    });
  });

  describe("streaming accumulator (snapshot retain/release)", () => {
    it("retains each new partial and releases the previous one", async () => {
      const a = fakeGpuImage("a");
      const b = fakeGpuImage("b");
      const c = fakeGpuImage("c");
      const retainSpyA = vi.spyOn(a, "retain");
      const releaseSpyA = vi.spyOn(a, "release");
      const retainSpyB = vi.spyOn(b, "retain");
      const releaseSpyB = vi.spyOn(b, "release");
      const retainSpyC = vi.spyOn(c, "retain");

      const task = new _TestImageTask({});
      // Drive the accumulator directly via the protected hook (exposed for tests).
      // ingestPartial() is defined on AiImageOutputTask in Task 3.
      (task as any).ingestPartial(a);
      expect(retainSpyA).toHaveBeenCalledTimes(1);

      (task as any).ingestPartial(b);
      expect(retainSpyB).toHaveBeenCalledTimes(1);
      expect(releaseSpyA).toHaveBeenCalledTimes(1);

      (task as any).ingestPartial(c);
      expect(retainSpyC).toHaveBeenCalledTimes(1);
      expect(releaseSpyB).toHaveBeenCalledTimes(1);
    });

    it("clears the buffer on finalize", () => {
      const a = fakeGpuImage("a");
      const releaseSpy = vi.spyOn(a, "release");
      const task = new _TestImageTask({});
      (task as any).ingestPartial(a);
      // finalize() hands the partial out to the consumer (transfers retain), so no release.
      const out = (task as any).takeFinalPartial();
      expect(out).toBe(a);
      expect((task as any)._latestPartial).toBeUndefined();
      expect(releaseSpy).not.toHaveBeenCalled();
    });
  });

  describe("placeholder preview", () => {
    it("returns a non-undefined GpuImage and never calls a provider", async () => {
      const task = new _TestImageTask({});
      task.runInputData = { prompt: "a sunset", model: "m" };
      const out = await task.executePreview(
        { prompt: "a sunset", model: "m" } as any,
        { own: ((x: any) => x) as any },
      );
      expect(out?.image).toBeDefined();
      expect((out!.image as GpuImage).width).toBeGreaterThan(0);
    });
  });
});
