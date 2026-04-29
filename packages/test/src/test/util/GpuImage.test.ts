/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/tasks/codec";
import type { GpuImage, GpuImageBackend } from "@workglow/util/media";
import { GpuImageFactory } from "@workglow/util/media";

describe("GpuImage interface", () => {
  test("backend tag is one of the three allowed strings", () => {
    const backends: GpuImageBackend[] = ["webgpu", "sharp", "cpu"];
    expect(backends).toHaveLength(3);
  });

  test("interface shape exists at type level", () => {
    const _stub = (img: GpuImage) =>
      [img.width, img.height, img.channels, img.backend, img.materialize, img.toCanvas, img.encode, img.release] as const;
    expect(typeof _stub).toBe("function");
  });
});

describe("GpuImageFactory Proxy guards", () => {
  test("symbol property access returns undefined (not throw)", () => {
    expect(() => (GpuImageFactory as any)[Symbol.toPrimitive]).not.toThrow();
    expect((GpuImageFactory as any)[Symbol.toPrimitive]).toBeUndefined();
  });

  test("'then' property returns undefined so the value is not thenable", async () => {
    expect((GpuImageFactory as any).then).toBeUndefined();
    // Promise.resolve checks .then on its argument; this must not throw.
    await expect(Promise.resolve(GpuImageFactory)).resolves.toBe(GpuImageFactory);
  });

  test("unregistered string key throws with a helpful message", () => {
    expect(() => (GpuImageFactory as any).somethingBogus()).toThrow(/somethingBogus is not registered/);
  });
});

import { GpuImageSchema } from "@workglow/util/media";

describe("GpuImageSchema", () => {
  test("declares format:'image' so the input resolver hydrates it", () => {
    const schema = GpuImageSchema({ title: "Image" }) as Record<string, unknown>;
    expect(schema.format).toBe("image");
    expect(schema.title).toBe("Image");
  });

  test("accepts annotation overrides", () => {
    const schema = GpuImageSchema({ title: "Source", description: "Input image" }) as Record<string, unknown>;
    expect(schema.title).toBe("Source");
    expect(schema.description).toBe("Input image");
  });

  test("works with no annotations (defaults)", () => {
    const schema = GpuImageSchema() as Record<string, unknown>;
    expect(schema.format).toBe("image");
    expect(schema.title).toBe("Image");
    expect(schema.description).toBe("Image (hydrated to GpuImage by the runner)");
  });
});

describe("GpuImageFactory async factories", () => {
  test("fromDataUri produces a backed image (1x1 PNG)", async () => {
    const tinyPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NgYGD4DwABBAEAAFGI6QAAAABJRU5ErkJggg==";
    const img = await GpuImageFactory.fromDataUri(tinyPng);
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
    expect(["webgpu", "sharp", "cpu"]).toContain(img.backend);
  });

  test("fromBlob produces a backed image (PNG bytes)", async () => {
    const tinyPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NgYGD4DwABBAEAAFGI6QAAAABJRU5ErkJggg==";
    const b64 = tinyPng.slice(tinyPng.indexOf(",") + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/png" });
    const img = await GpuImageFactory.fromBlob(blob);
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
    expect(["webgpu", "sharp", "cpu"]).toContain(img.backend);
  });

  test("fromImageBitmap throws in node (factory unavailable)", async () => {
    if (typeof ImageBitmap !== "undefined") return; // skip in browser env
    expect(() => (GpuImageFactory as unknown as { fromImageBitmap: () => unknown }).fromImageBitmap()).toThrow(
      /not registered/,
    );
  });
});
