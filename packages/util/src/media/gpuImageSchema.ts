/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { DataPortSchema } from "../json-schema/DataPortSchema";

export function GpuImageSchema(annotations: Record<string, unknown> = {}): DataPortSchema {
  // Runtime shape is the multi-type form `["string", "object"]` so the
  // schema validator accepts every wire form image values take:
  //   - string  (data: URI; the input resolver hydrates it to a GpuImage)
  //   - object  (raw ImageBinary, Blob, ImageBitmap, or an already-hydrated
  //              GpuImage instance — the receiving task hydrates as needed)
  // Validators previously saw a bare `type: "object"` and rejected the
  // string form (which is what the property editor produces from file uploads
  // and URL inputs). format: "image" remains the signal for the resolver.
  //
  // The cast through `unknown` is needed because DataPortSchemaObject pins
  // `type` to the literal `"object"`. Without the cast the inferred return
  // type would widen to DataPortSchemaNonBoolean, which leaks the broader
  // JsonSchema structural type into consumers (FromSchema<typeof X> then
  // emits TS2883 "name is not portable" errors). Keeping the public return
  // type as DataPortSchema preserves the consumer experience that worked
  // before this change.
  return {
    type: ["string", "object"],
    properties: {},
    title: "Image",
    description: "Image (hydrated to GpuImage by the runner)",
    ...annotations,
    format: "image",
  } as unknown as DataPortSchema;
}
