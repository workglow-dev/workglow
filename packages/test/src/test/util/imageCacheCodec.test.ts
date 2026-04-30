/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/util/media";
import { imageValueFromBuffer, type ImageValue } from "@workglow/util/media";
import { getPortCodec } from "@workglow/task-graph";

/**
 * The image port codec now round-trips an `ImageValue` directly. Bitmaps
 * survive postMessage/transferList; Buffers survive structured-clone in
 * worker_threads. The codec no longer materializes to/from a CachedImage
 * shape — see `imageCacheCodec.ts` and the boundary refactor.
 */
describe("image port codec", () => {
  test("serialize is a passthrough for NodeImageValue", async () => {
    const buf = Buffer.from(new Uint8Array([1, 2, 3, 255]));
    const value = imageValueFromBuffer(buf, "raw-rgba", 1, 1);
    const codec = getPortCodec("image");
    expect(codec).toBeDefined();
    const wire = (await codec!.serialize(value)) as ImageValue;
    expect(wire.width).toBe(1);
    expect(wire.height).toBe(1);
    expect(wire.previewScale).toBe(1.0);
  });

  test("deserialize round-trips back to a usable ImageValue", async () => {
    const codec = getPortCodec("image");
    const buf = Buffer.from(new Uint8Array([10, 20, 30, 255]));
    const value = imageValueFromBuffer(buf, "raw-rgba", 1, 1, 0.25);
    const out = (await codec!.deserialize(value)) as ImageValue;
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.previewScale).toBe(0.25);
  });
});
