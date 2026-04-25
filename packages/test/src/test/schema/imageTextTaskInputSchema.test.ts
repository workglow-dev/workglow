/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ImageTextTask } from "@workglow/tasks";
import { compileSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

function validateInput(value: unknown) {
  return compileSchema(ImageTextTask.inputSchema()).validate(value);
}

describe("ImageTextTask inputSchema (json-schema-library)", () => {
  const color = { r: 0, g: 0, b: 0 } as const;
  const base = { text: "Hello", color };

  it("rejects when there is no image and no width/height", () => {
    const result = validateInput({ ...base });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("width"))).toBe(true);
    expect(result.errors.some((e) => e.message.includes("height"))).toBe(true);
  });

  it("accepts when a background ImageBinary is present without width/height", () => {
    const image = {
      data: [255, 0, 0, 255],
      width: 1,
      height: 1,
      channels: 4,
    } as const;
    expect(validateInput({ ...base, image }).valid).toBe(true);
  });

  it("accepts when a data-URI background image is present without width/height", () => {
    const image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    expect(validateInput({ ...base, image }).valid).toBe(true);
  });

  it("accepts when there is no image but width and height are set", () => {
    expect(validateInput({ ...base, width: 640, height: 480 }).valid).toBe(true);
  });
});
