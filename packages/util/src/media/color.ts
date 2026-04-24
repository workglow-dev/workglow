/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ColorObject {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX_PATTERN = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Parse a `#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA` hex color into a {@link ColorObject}.
 * Case-insensitive on input. No whitespace tolerance. Shorthand nibbles are doubled.
 * Throws on any malformed input.
 */
export function parseHexColor(hex: string): ColorObject {
  if (typeof hex !== "string" || !HEX_PATTERN.test(hex)) {
    throw new Error(`Invalid hex color: ${String(hex)}`);
  }
  const body = hex.slice(1);
  const double = (nibble: string): number => parseInt(nibble + nibble, 16);
  if (body.length === 3) {
    return { r: double(body[0]!), g: double(body[1]!), b: double(body[2]!), a: 255 };
  }
  if (body.length === 4) {
    return {
      r: double(body[0]!),
      g: double(body[1]!),
      b: double(body[2]!),
      a: double(body[3]!),
    };
  }
  if (body.length === 6) {
    return {
      r: parseInt(body.slice(0, 2), 16),
      g: parseInt(body.slice(2, 4), 16),
      b: parseInt(body.slice(4, 6), 16),
      a: 255,
    };
  }
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
    a: parseInt(body.slice(6, 8), 16),
  };
}
