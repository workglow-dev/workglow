/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DataPortSchema,
  DataPortSchemaNonBoolean,
  DataPortSchemaObject,
} from "@workglow/util/schema";

/**
 * Normalizes {@link DataPortSchema} to an object schema suitable for {@link getAllFields} / Ink forms.
 */
export function asDataPortSchemaObject(schema: DataPortSchema): DataPortSchemaObject {
  if (schema === true) {
    return { type: "object", properties: {}, additionalProperties: true };
  }
  if (schema === false) {
    return { type: "object", properties: {} };
  }
  if (schema.type === "object") {
    return schema as DataPortSchemaObject;
  }
  return {
    type: "object",
    properties: {
      value: schema as DataPortSchemaNonBoolean,
    },
    required: ["value"],
  };
}
