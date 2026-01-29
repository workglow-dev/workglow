/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DataPortSchemaObject, FromSchema } from "@workglow/util";

/**
 * A model configuration suitable for task/job inputs.
 *
 * @remarks
 * This is intentionally less strict than {@link ModelRecord} so jobs can carry only the
 * provider configuration required to execute, without requiring access to a model repository.
 */
export const ModelConfigSchema = {
  type: "object",
  properties: {
    model_id: { type: "string" },
    tasks: { type: "array", items: { type: "string" }, "x-ui-editor": "multiselect" },
    title: { type: "string" },
    description: { type: "string", "x-ui-editor": "textarea" },
    provider: { type: "string" },
    provider_config: { type: "object", default: {} },
    metadata: { type: "object", default: {}, "x-ui-hidden": true },
  },
  required: ["provider", "provider_config"],
  format: "model",
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

/**
 * A fully-specified model record suitable for persistence in a repository.
 */
export const ModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
  },
  required: [
    "model_id",
    "tasks",
    "provider",
    "title",
    "description",
    "provider_config",
    "metadata",
  ],
  format: "model",
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type ModelConfig = FromSchema<typeof ModelConfigSchema>;
export type ModelRecord = FromSchema<typeof ModelRecordSchema>;
export const ModelPrimaryKeyNames = ["model_id"] as const;
