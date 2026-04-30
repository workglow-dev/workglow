/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { ImageValue } from "@workglow/util/media";
import type { ModelConfig } from "@workglow/ai";
import { AiImageOutputTask } from "@workglow/ai";

// Test subclass: overrides the abstract bits with concrete schemas.
class _TestImageTask extends AiImageOutputTask<{
  prompt: string;
  model: ModelConfig | string;
  seed?: number;
  aspectRatio?: string;
}> {
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

function fakeImageValue(width = 8, height = 8, previewScale = 1): ImageValue {
  // Use a Node-shape ImageValue. Buffer + raw-rgba is the simplest construct
  // that survives `isImageValue`. The bytes are dummy — only structure matters.
  const buf = Buffer.alloc(width * height * 4);
  return { buffer: buf, format: "raw-rgba", width, height, previewScale } as ImageValue;
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

  describe("streaming accumulator (snapshot replacement)", () => {
    // Refcount-based retain/release on partials was deleted with the
    // ImageValue boundary refactor; ImageValue lifetime is JS GC. The
    // accumulator now just replaces `_latestPartial` on each ingest, and
    // `takeFinalPartial()` clears it without releasing. These tests verify
    // the new replacement semantics without referencing the deleted
    // retain/release API.
    it("replaces the prior partial when a new one is ingested", () => {
      const a = fakeImageValue();
      const b = fakeImageValue();
      const task = new _TestImageTask({});
      (task as any).ingestPartial(a);
      expect((task as any)._latestPartial).toBe(a);
      (task as any).ingestPartial(b);
      expect((task as any)._latestPartial).toBe(b);
    });

    it("clears the buffer on takeFinalPartial without retaining", () => {
      const a = fakeImageValue();
      const task = new _TestImageTask({});
      (task as any).ingestPartial(a);
      const out = (task as any).takeFinalPartial();
      expect(out).toBe(a);
      expect((task as any)._latestPartial).toBeUndefined();
    });
  });

  describe("placeholder preview", () => {
    it("returns a non-undefined ImageValue and never calls a provider", async () => {
      const task = new _TestImageTask({});
      task.runInputData = { prompt: "a sunset", model: "m" };
      const out = await task.executePreview(
        { prompt: "a sunset", model: "m" } as any,
        { own: ((x: any) => x) as any },
      );
      expect(out?.image).toBeDefined();
      expect((out!.image as ImageValue).width).toBeGreaterThan(0);
    });
  });
});
