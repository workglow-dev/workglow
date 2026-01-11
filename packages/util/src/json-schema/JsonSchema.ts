/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExtendedJSONSchema, JSONSchemaExtension } from "@sroussey/json-schema-to-ts";

export type JsonSchemaCustomProps = {
  "x-replicate"?: boolean;
  "x-ui-reactive"?: boolean | string; // hint that this field responds to reactive changes
  "x-ui-hidden"?: boolean;
  "x-ui-order"?: number;
  "x-ui-priority"?: number;
  "x-ui-viewer"?: string;
  "x-ui-editor"?: string;
  "x-ui-group"?: string;
  "x-ui-group-order"?: number;
  "x-ui-group-priority"?: number;
  "x-ui-group-open"?: boolean;
  "x-ui"?: unknown;
};

export type JsonSchema<EXTENSION extends JSONSchemaExtension = JsonSchemaCustomProps> =
  ExtendedJSONSchema<EXTENSION>;
