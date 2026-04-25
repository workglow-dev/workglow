/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared base for the image tasks. Centralizes two cross-cutting concerns:
 *
 * 1. **Cheap input validation.** The image field carries either an `Image`
 *    instance or a Uint8ClampedArray-backed `ImageBinary`. The default
 *    `Task.validateInput` runs a generic JSON-Schema validator against the
 *    full input — for image data that means walking a multi-megabyte typed
 *    array every reactive run. We replace `image` with a tiny stand-in
 *    before delegating, so the validator exercises every other field at
 *    full strength but skips the pixel walk.
 *
 * 2. **Output normalization.** Task output is always wrapped in an `Image`
 *    instance so a chain of GPU-using tasks can pass a `GPUTexture` along
 *    without intermediate readback. Downstream consumers (display, storage,
 *    other tasks) all accept `Image` via `Image.from()`.
 */

import { Task, type TaskConfig } from "@workglow/task-graph";
import { Image } from "@workglow/util/media";

const IMAGE_VALIDATION_SENTINEL = Object.freeze({
  data: [] as readonly number[],
  width: 1,
  height: 1,
  channels: 4 as 4,
});

/**
 * Replace any property whose key matches `imageKeys` with a tiny sentinel
 * that satisfies the `ImageBinaryOrDataUriSchema` shape. The original input
 * is not mutated.
 */
function withSentinelImageFields<T extends Record<string, unknown>>(
  input: T,
  imageKeys: ReadonlyArray<string>
): T {
  let needsCopy = false;
  for (const k of imageKeys) {
    if (k in input) {
      needsCopy = true;
      break;
    }
  }
  if (!needsCopy) return input;
  const copy: Record<string, unknown> = { ...input };
  for (const k of imageKeys) {
    if (k in copy) {
      const v = copy[k];
      if (v === undefined) continue;
      copy[k] = Image.is(v) ? IMAGE_VALIDATION_SENTINEL : v;
    }
  }
  return copy as T;
}

export class ImageTaskBase<
  Input extends object = object,
  Output extends object = object,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  /**
   * Subclasses override to declare which input fields hold image values
   * (default: `["image"]`). The base class swaps those fields for the
   * sentinel during validation so the validator doesn't walk pixel data.
   */
  protected getImageInputKeys(): ReadonlyArray<string> {
    return ["image"];
  }

  override async validateInput(input: Input): Promise<boolean> {
    const keys = this.getImageInputKeys();
    const stand = withSentinelImageFields(input as unknown as Record<string, unknown>, keys);
    return super.validateInput(stand as unknown as Input);
  }
}
