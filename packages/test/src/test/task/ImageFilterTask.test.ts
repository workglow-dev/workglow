/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test } from "vitest";
import {
  ImageFilterTask,
  type ImageFilterInput,
  type ImageFilterOutput,
  registerFilterOp,
} from "@workglow/tasks";
import { CpuImage, type GpuImage } from "@workglow/util/media";

interface BumpParams { delta: number; }

registerFilterOp<BumpParams>("cpu", "__test_bump__", (image, { delta }) => {
  const bin = (image as CpuImage).getBinary();
  const data = new Uint8ClampedArray(bin.data);
  for (let i = 0; i < data.length; i += 4) data[i] = (data[i]! + delta) & 0xff;
  return CpuImage.fromImageBinary({ ...bin, data });
});

registerFilterOp<BumpParams>("cpu", "__test_capture__", (image, { delta }) => {
  const bin = (image as CpuImage).getBinary();
  const data = new Uint8ClampedArray(bin.data);
  for (let i = 0; i < data.length; i += 4) data[i] = (data[i]! + delta) & 0xff;
  return CpuImage.fromImageBinary({ ...bin, data });
});

interface BumpInput extends ImageFilterInput, Record<string, unknown> { delta: number; }

class BumpTask extends ImageFilterTask<BumpParams, BumpInput> {
  static override readonly type = "BumpTask";
  static override readonly category = "Image";
  protected readonly filterName = "__test_bump__";
  protected opParams(input: BumpInput): BumpParams { return { delta: input.delta }; }
}

describe("ImageFilterTask", () => {
  test("execute and executePreview produce identical results via the same filter", async () => {
    const image = CpuImage.fromImageBinary({
      data: new Uint8ClampedArray([10, 0, 0, 255]),
      width: 1, height: 1, channels: 4,
    }) as unknown as GpuImage;

    const t = new BumpTask();
    const exec = await t.execute({ image, delta: 5 } as BumpInput, {} as never);
    const prev = await t.executePreview({ image, delta: 5 } as BumpInput, {} as never);

    expect(exec).toBeDefined();
    expect(prev).toBeDefined();
    const execBin = await (exec as ImageFilterOutput).image.materialize();
    const prevBin = await (prev as ImageFilterOutput).image.materialize();
    expect(execBin.data[0]).toBe(15);
    expect(prevBin.data[0]).toBe(15);
  });

  test("opParams is called with the full input on each invocation", async () => {
    let captured: BumpInput | null = null;
    class Capture extends ImageFilterTask<BumpParams, BumpInput> {
      static override readonly type = "CaptureTask";
      static override readonly category = "Image";
      protected readonly filterName = "__test_capture__";
      protected opParams(input: BumpInput): BumpParams { captured = input; return { delta: input.delta }; }
    }
    const image = CpuImage.fromImageBinary({
      data: new Uint8ClampedArray(4),
      width: 1, height: 1, channels: 4,
    }) as unknown as GpuImage;
    const t = new Capture();
    await t.execute({ image, delta: 7 } as BumpInput, {} as never);
    expect(captured).not.toBeNull();
    expect(captured!.delta).toBe(7);
  });
});
