/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import "@workglow/tasks";
import { ImageTextTask } from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

describe("ImageTextTask (cpu)", () => {
  test("renders text onto a transparent background of the given dimensions", async () => {
    const t = new ImageTextTask();
    const out = await t.execute(
      {
        text: "AB",
        width: 32,
        height: 16,
        font: "sans-serif",
        fontSize: 12,
        bold: false,
        italic: false,
        color: "#ffffff",
        position: "middle-center",
      } as never,
      {} as never
    );
    expect(out).toBeDefined();
    const bin = await (out!.image as unknown as GpuImage).materialize();
    expect(bin.width).toBe(32);
    expect(bin.height).toBe(16);
    let hasText = false;
    for (let i = 3; i < bin.data.length; i += 4) {
      if (bin.data[i]! > 0) {
        hasText = true;
        break;
      }
    }
    expect(hasText).toBe(true);
  });

  test("composites text over a background image", async () => {
    const bgData = new Uint8ClampedArray(32 * 16 * 4);
    for (let i = 0; i < bgData.length; i += 4) {
      bgData[i] = 100;
      bgData[i + 1] = 100;
      bgData[i + 2] = 100;
      bgData[i + 3] = 255;
    }
    const bg = CpuImage.fromImageBinary({
      data: bgData,
      width: 32,
      height: 16,
      channels: 4,
    }) as unknown as GpuImage;
    const t = new ImageTextTask();
    const out = await t.execute(
      {
        image: bg,
        text: "AB",
        font: "sans-serif",
        fontSize: 12,
        bold: false,
        italic: false,
        color: "#ffffff",
        position: "middle-center",
      } as never,
      {} as never
    );
    expect(out).toBeDefined();
    const bin = await (out!.image as unknown as GpuImage).materialize();
    expect(bin.width).toBe(32);
    expect(bin.height).toBe(16);
  });
});
