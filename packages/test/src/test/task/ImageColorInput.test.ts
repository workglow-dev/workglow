/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ImageBorderTask, ImageTextTask, ImageTintTask } from "@workglow/tasks";
import { CpuImage, type GpuImage, type ImageBinary } from "@workglow/util/media";
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

async function assertSameImage(a: GpuImage | ImageBinary, b: GpuImage | ImageBinary): Promise<void> {
  const abin = "materialize" in a ? await (a as GpuImage).materialize() : a as ImageBinary;
  const bbin = "materialize" in b ? await (b as GpuImage).materialize() : b as ImageBinary;
  expect(abin.width).toBe(bbin.width);
  expect(abin.height).toBe(bbin.height);
  expect(abin.channels).toBe(bbin.channels);
  expect(Array.from(abin.data)).toEqual(Array.from(bbin.data));
}

describe("ImageTintTask accepts both color wire forms", () => {
  it("produces identical pixels for hex and object color input", async () => {
    const bin = makeImage(4, 4);
    const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
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

    await assertSameImage(fromObject.image as unknown as GpuImage, fromHex.image as unknown as GpuImage);
  });
});

describe("ImageBorderTask accepts both color wire forms", () => {
  it("produces identical pixels for hex and object color input", async () => {
    const bin = makeImage(6, 6);
    const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
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

    await assertSameImage(fromObject.image as unknown as GpuImage, fromHex.image as unknown as GpuImage);
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

    await assertSameImage(fromObject.image as unknown as ImageBinary, fromHex.image as unknown as ImageBinary);
  });
});
