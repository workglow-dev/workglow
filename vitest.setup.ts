/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Polyfill Float16Array for Node < 24 environments.
 * Float16Array is used in vector/tensor type definitions and must exist
 * at module-load time. This lightweight shim extends Uint16Array so that
 * `instanceof Float16Array` checks work; it does NOT implement IEEE 754
 * half-precision arithmetic — only enough to unblock tests.
 */
if (typeof globalThis.Float16Array === "undefined") {
  // @ts-expect-error — intentional minimal shim
  globalThis.Float16Array = class Float16Array extends Uint16Array {
    static readonly BYTES_PER_ELEMENT = 2;
  };
}
