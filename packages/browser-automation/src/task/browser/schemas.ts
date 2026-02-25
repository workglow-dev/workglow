/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { locatorSpecSchema } from "../../core/locator";

/**
 * Shared JSON Schema fragments for browser task I/O.
 */

export const contextProperty = {
  type: "object",
  additionalProperties: true,
  default: {},
} as const;

export const sessionConfigProperty = {
  type: "object",
  properties: {
    headless: { type: "boolean" },
    viewport: {
      type: "object",
      properties: {
        width: { type: "number" },
        height: { type: "number" },
      },
    },
    userAgent: { type: "string" },
    timeoutMs: { type: "number" },
  },
  additionalProperties: true,
} as const;

export const timeoutMsProperty = {
  type: "number",
  minimum: 1,
  default: 30000,
} as const;

export const locatorProperty = locatorSpecSchema;

export const extractKindProperty = {
  type: "string",
  enum: ["text", "innerHTML", "attribute", "value", "textContent", "allText", "table"],
} as const;

export const waitModeProperty = {
  type: "string",
  enum: ["timeout", "locator", "url", "loadState"],
} as const;
