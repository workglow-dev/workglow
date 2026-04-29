/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/util/media";  // side-effect: register the resolver
import "@workglow/tasks/codec";  // side-effect: register the raster codec (lean — no undici)
import { resolveSchemaInputs } from "@workglow/task-graph";
import { GpuImageSchema, type GpuImage } from "@workglow/util/media";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NgYGD4DwABBAEAAFGI6QAAAABJRU5ErkJggg==";

describe("format:'image' input resolver (string → GpuImage)", () => {
  test("hydrates a data URI string to a GpuImage when schema has format:'image'", async () => {
    const schema = {
      type: "object",
      properties: { image: GpuImageSchema() },
      required: ["image"],
    } as never;
    const out = (await resolveSchemaInputs({ image: TINY_PNG } as never, schema, { registry: {} as never })) as { image: GpuImage };
    expect(out.image).toBeDefined();
    expect(out.image.width).toBe(1);
    expect(out.image.height).toBe(1);
    expect(["webgpu", "sharp", "cpu"]).toContain(out.image.backend);
  });

  test("passes a GpuImage value through unchanged (Phase 2 spread guard)", async () => {
    const { CpuImage } = await import("@workglow/util/media");
    const cpu = CpuImage.fromImageBinary({ data: new Uint8ClampedArray(4), width: 1, height: 1, channels: 4 });
    const schema = {
      type: "object",
      properties: { image: GpuImageSchema() },
      required: ["image"],
    } as never;
    const out = (await resolveSchemaInputs({ image: cpu } as never, schema, { registry: {} as never })) as { image: GpuImage };
    expect(out.image).toBe(cpu);
  });

  test("ImageBinary shape (object) flows through unchanged (resolver only handles strings)", async () => {
    const bin = { data: new Uint8ClampedArray(16), width: 2, height: 2, channels: 4 as const };
    const schema = {
      type: "object",
      properties: { image: GpuImageSchema() },
      required: ["image"],
    } as never;
    const out = (await resolveSchemaInputs({ image: bin } as never, schema, { registry: {} as never })) as { image: unknown };
    // Resolver only invoked for strings; objects pass through untouched.
    expect(out.image).toBe(bin);
  });
});
