/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structural match for `RawImage` from `@huggingface/transformers`. The HF
 * class carries helpers (`save`, `toCanvas`, `rgb`, ...) that the provider
 * runtime does not invoke on inputs, so a minimal shim over the four data
 * fields is sufficient. If a consumer later needs HF-specific methods we can
 * widen this shim lazily — no need to pull the transformers dep into
 * `@workglow/util/media` today.
 */
export class MediaRawImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly channels: number;

  constructor(data: Uint8ClampedArray, width: number, height: number, channels: number) {
    this.data = data;
    this.width = width;
    this.height = height;
    this.channels = channels;
  }
}

export function isMediaRawImageShape(
  value: unknown
): value is { data: Uint8ClampedArray; width: number; height: number; channels: number } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.data instanceof Uint8ClampedArray &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    typeof v.channels === "number"
  );
}
