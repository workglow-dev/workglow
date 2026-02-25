/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unified locator specification for element targeting across backends.
 *
 * Defaults to Playwright-recommended user-facing locator strategies
 * (role, label, text, testid) for resilience against DOM changes.
 * Falls back to CSS/XPath for advanced cases.
 */
export type LocatorSpec =
  | { kind: "role"; role: string; name?: string; exact?: boolean; nth?: number }
  | { kind: "label"; text: string; exact?: boolean; nth?: number }
  | { kind: "text"; text: string; exact?: boolean; nth?: number }
  | { kind: "testid"; testId: string; nth?: number }
  | { kind: "css"; selector: string; nth?: number }
  | { kind: "xpath"; selector: string; nth?: number };

export const locatorSpecSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { type: "string", const: "role" },
        role: { type: "string" },
        name: { type: "string" },
        exact: { type: "boolean" },
        nth: { type: "number" },
      },
      required: ["kind", "role"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", const: "label" },
        text: { type: "string" },
        exact: { type: "boolean" },
        nth: { type: "number" },
      },
      required: ["kind", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", const: "text" },
        text: { type: "string" },
        exact: { type: "boolean" },
        nth: { type: "number" },
      },
      required: ["kind", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", const: "testid" },
        testId: { type: "string" },
        nth: { type: "number" },
      },
      required: ["kind", "testId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", const: "css" },
        selector: { type: "string" },
        nth: { type: "number" },
      },
      required: ["kind", "selector"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", const: "xpath" },
        selector: { type: "string" },
        nth: { type: "number" },
      },
      required: ["kind", "selector"],
      additionalProperties: false,
    },
  ],
} as const;
