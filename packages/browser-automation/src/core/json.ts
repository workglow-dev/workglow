/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Strict JSON-serializable value types.
 * All task inputs and outputs in browser-automation must conform to JSONValue.
 */
export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [k: string]: JSONValue };

/**
 * Runtime assertion that a value is JSON-serializable.
 * Only active in non-production builds to avoid overhead.
 * Throws if the value contains functions, symbols, undefined, or class instances.
 */
export function assertJsonValue(value: unknown, path = "root"): asserts value is JSONValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "undefined") {
    throw new TypeError(`Non-JSON value at ${path}: undefined`);
  }
  if (typeof value === "function") {
    throw new TypeError(`Non-JSON value at ${path}: function`);
  }
  if (typeof value === "symbol") {
    throw new TypeError(`Non-JSON value at ${path}: symbol`);
  }
  if (typeof value === "bigint") {
    throw new TypeError(`Non-JSON value at ${path}: bigint`);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertJsonValue(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      throw new TypeError(`Non-JSON value at ${path}: class instance (${proto.constructor?.name})`);
    }
    for (const key of Object.keys(value as Record<string, unknown>)) {
      assertJsonValue((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
    return;
  }
  throw new TypeError(`Non-JSON value at ${path}: ${typeof value}`);
}
