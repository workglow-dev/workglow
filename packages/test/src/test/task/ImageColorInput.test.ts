/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ImageBorderTask, ImageTextTask, ImageTintTask } from "@workglow/tasks";
import type { ImageBinary } from "@workglow/util/media";
import { describe, expect, it } from "vitest";

function makeImage(width: number, height: number): ImageBinary {
  const channels = 4 as const;
  const data = new Uint8ClampedArray(width * height * channels);
  // Opaque white everywhere.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return { data, width, height, channels };
}

function assertSameImage(a: ImageBinary, b: ImageBinary): void {
  expect(a.width).toBe(b.width);
  expect(a.height).toBe(b.height);
  expect(a.channels).toBe(b.channels);
  expect(Array.from(a.data)).toEqual(Array.from(b.data));
}

describe("ImageTintTask accepts both color wire forms", () => {
  it("produces identical pixels for hex and object color input", async () => {
    const image = makeImage(4, 4);
    const objTask = new ImageTintTask();
    const hexTask = new ImageTintTask();

    const fromObject = await objTask.run({
      image,
      color: { r: 255, g: 0, b: 0, a: 255 },
      amount: 0.5,
    });
    const fromHex = await hexTask.run({
      image,
      color: "#ff0000",
      amount: 0.5,
    });

    assertSameImage(fromObject.image as ImageBinary, fromHex.image as ImageBinary);
  });
});

describe("ImageBorderTask accepts both color wire forms", () => {
  it("produces identical pixels for hex and object color input", async () => {
    const image = makeImage(6, 6);
    const objTask = new ImageBorderTask();
    const hexTask = new ImageBorderTask();

    const fromObject = await objTask.run({
      image,
      color: { r: 0, g: 0, b: 0, a: 255 },
      borderWidth: 1,
    });
    const fromHex = await hexTask.run({
      image,
      color: "#000000",
      borderWidth: 1,
    });

    assertSameImage(fromObject.image as ImageBinary, fromHex.image as ImageBinary);
  });
});

describe("ImageTextTask accepts both color wire forms", () => {
  it("produces identical pixels for hex and object color input", async () => {
    const objTask = new ImageTextTask();
    const hexTask = new ImageTextTask();

    const fromObject = await objTask.run({
      text: "A",
      color: { r: 0, g: 0, b: 0, a: 255 },
      width: 32,
      height: 32,
    });
    const fromHex = await hexTask.run({
      text: "A",
      color: "#000000",
      width: 32,
      height: 32,
    });

    assertSameImage(fromObject.image as ImageBinary, fromHex.image as ImageBinary);
  });
});
