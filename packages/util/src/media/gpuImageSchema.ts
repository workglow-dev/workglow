/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { DataPortSchema } from "../json-schema/DataPortSchema";

export function GpuImageSchema(annotations: Record<string, unknown> = {}): DataPortSchema {
  return {
    type: "object",
    properties: {},
    title: "Image",
    description: "Image (hydrated to GpuImage by the runner)",
    ...annotations,
    format: "image",
  };
}
