/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, test, beforeEach } from "vitest";
import { ResourceScope } from "@workglow/util";
import {
  type IExecuteContext,
  type IExecutePreviewContext,
} from "@workglow/task-graph";
import {
  setPreviewBudget,
  CpuImage,
  type GpuImage,
  type GpuImageBackend,
} from "@workglow/util/media";
import {
  ImageFilterTask,
  _resetFilterRegistryForTests,
  registerFilterOp,
  type FilterOpFn,
  type ImageFilterInput,
  type ImageFilterOutput,
} from "@workglow/tasks";
import "@workglow/tasks/codec"; // registers previewResizeFn → applyFilter("resize") so previewSource works
import type { DataPortSchema } from "@workglow/util/schema";

// ---------------------------------------------------------------------------
// CountingImage — tracks retain/release for refcount assertions.
// ---------------------------------------------------------------------------
class CountingImage implements GpuImage {
  backend: GpuImageBackend = "cpu";
  readonly width: number;
  readonly height: number;
  readonly channels = 4 as const;
  refs = 1;
  constructor(w: number, h: number, backend: GpuImageBackend = "cpu") {
    this.width = w;
    this.height = h;
    this.backend = backend;
  }
  retain(n: number = 1) { this.refs += n; return this; }
  release(): void { this.refs -= 1; }
  async materialize() { return { data: new Uint8ClampedArray(this.width * this.height * 4), width: this.width, height: this.height, channels: 4 as const }; }
  async toCanvas() {}
  async encode() { return new Uint8Array(); }
}

// ---------------------------------------------------------------------------
// Minimal test subclass of ImageFilterTask.
// ---------------------------------------------------------------------------
class TestFilterTask extends ImageFilterTask<{}> {
  static override readonly type = "TestFilterTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: { image: { type: "object" } } } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return { type: "object", properties: { image: { type: "object" } } } as const satisfies DataPortSchema;
  }
  protected readonly filterName = "test-filter";
  protected opParams() { return {}; }
}

function makeContext(scope?: ResourceScope): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: async () => {},
    own: <T>(t: T) => t,
    registry: undefined as unknown as IExecuteContext["registry"],
    resourceScope: scope,
  };
}

const previewCtx: IExecutePreviewContext = { own: <T>(t: T) => t };

// ---------------------------------------------------------------------------
// Existing filter / task wiring for the original functional tests.
// ---------------------------------------------------------------------------
interface BumpParams { delta: number; }

function registerTestBumpOps() {
  const bump: FilterOpFn<BumpParams> = (image, { delta }) => {
    const bin = (image as CpuImage).getBinary();
    const data = new Uint8ClampedArray(bin.data);
    for (let i = 0; i < data.length; i += 4) data[i] = (data[i]! + delta) & 0xff;
    return CpuImage.fromImageBinary({ ...bin, data });
  };
  registerFilterOp<BumpParams>("cpu", "__test_bump__", bump);
  registerFilterOp<BumpParams>("cpu", "__test_capture__", bump);
}

registerTestBumpOps();

interface BumpInput extends ImageFilterInput, Record<string, unknown> { delta: number; }

class BumpTask extends ImageFilterTask<BumpParams, BumpInput> {
  static override readonly type = "BumpTask";
  static override readonly category = "Image";
  protected readonly filterName = "__test_bump__";
  protected opParams(input: BumpInput): BumpParams { return { delta: input.delta }; }
}

// ---------------------------------------------------------------------------
// Original functional tests.
// ---------------------------------------------------------------------------
describe("ImageFilterTask", () => {
  test("execute and executePreview produce identical results via the same filter", async () => {
    const image = CpuImage.fromImageBinary({
      data: new Uint8ClampedArray([10, 0, 0, 255]),
      width: 1, height: 1, channels: 4,
    }) as unknown as GpuImage;

    const t = new BumpTask();
    const exec = await t.execute({ image, delta: 5 } as BumpInput, makeContext());
    // Provide a fresh image for preview since execute released the original ref.
    const image2 = CpuImage.fromImageBinary({
      data: new Uint8ClampedArray([10, 0, 0, 255]),
      width: 1, height: 1, channels: 4,
    }) as unknown as GpuImage;
    const prev = await t.executePreview({ image: image2, delta: 5 } as BumpInput, previewCtx);

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
    await t.execute({ image, delta: 7 } as BumpInput, makeContext());
    expect(captured).not.toBeNull();
    expect(captured!.delta).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Refcount lifecycle tests.
// ---------------------------------------------------------------------------
describe("ImageFilterTask refcount behavior", () => {
  beforeEach(() => {
    _resetFilterRegistryForTests();
    setPreviewBudget(512);
    // Re-register the bump ops that the outer describe registered (cleared by reset).
    registerTestBumpOps();
  });

  test("execute releases input image after applyFilter", async () => {
    registerFilterOp("cpu", "test-filter", (image) => new CountingImage(image.width, image.height));

    const input = new CountingImage(100, 100);
    expect(input.refs).toBe(1);

    const task = new TestFilterTask({ id: "t1" });
    await task.execute({ image: input as unknown as GpuImage }, makeContext());

    expect(input.refs).toBe(0); // released by execute
  });

  test("execute registers a resourceScope disposer for the output", async () => {
    const filterOutput = new CountingImage(100, 100);
    registerFilterOp("cpu", "test-filter", () => filterOutput);

    const input = new CountingImage(100, 100);
    const scope = new ResourceScope();
    const task = new TestFilterTask({ id: "t1" });
    await task.execute({ image: input as unknown as GpuImage }, makeContext(scope));

    expect(scope.size).toBe(1);
    expect(filterOutput.refs).toBe(1);

    await scope.disposeAll();
    expect(filterOutput.refs).toBe(0); // disposer released the output
  });

  test("execute without resourceScope still releases input", async () => {
    registerFilterOp("cpu", "test-filter", (image) => new CountingImage(image.width, image.height));

    const input = new CountingImage(100, 100);
    const task = new TestFilterTask({ id: "t1" });
    await task.execute({ image: input as unknown as GpuImage }, makeContext(undefined));

    expect(input.refs).toBe(0);
  });

  test("executePreview does NOT release the input", async () => {
    registerFilterOp("cpu", "test-filter", (image) => new CountingImage(image.width, image.height));

    const input = new CountingImage(100, 100);
    const task = new TestFilterTask({ id: "t1" });
    await task.executePreview({ image: input as unknown as GpuImage }, previewCtx);

    expect(input.refs).toBe(1); // unchanged — builder hook keeps display ref
  });

  test("executePreview is no-op for the resize step on cpu backend", async () => {
    // previewSource only resizes for webgpu backend; cpu input stays referentially equal.
    let resizeCalls = 0;
    let filterCalls = 0;
    registerFilterOp("cpu", "resize", (_image, _params: { width: number; height: number }) => {
      resizeCalls++;
      return new CountingImage(_params.width, _params.height);
    });
    registerFilterOp("cpu", "test-filter", (image) => {
      filterCalls++;
      return new CountingImage(image.width, image.height);
    });

    const oversized = new CountingImage(2048, 1024);
    const task = new TestFilterTask({ id: "t1" });
    await task.executePreview({ image: oversized as unknown as GpuImage }, previewCtx);

    expect(resizeCalls).toBe(0); // cpu backend short-circuits previewSource
    expect(filterCalls).toBe(1);
  });

  test("preview chain calls resize exactly once even with multiple filters", async () => {
    // Three filters chained at preview-time. The first sees a 2048×1024
    // image and triggers a webgpu resize; the next two see budget-sized
    // images and skip the resize. previewSource on cpu backend short-
    // circuits, so we synthesize a "webgpu" backend tag on a CountingImage
    // — that's enough to take the resize path without a real GPU.
    let resizeCalls = 0;
    let filterCalls = 0;
    registerFilterOp("webgpu", "resize", (image, params: { width: number; height: number }) => {
      resizeCalls++;
      return new CountingImage(params.width, params.height, "webgpu") as unknown as GpuImage;
    });
    registerFilterOp("webgpu", "test-filter", (image) => {
      filterCalls++;
      return new CountingImage(image.width, image.height, "webgpu") as unknown as GpuImage;
    });

    let curr: GpuImage = new CountingImage(2048, 1024, "webgpu") as unknown as GpuImage;
    for (let i = 0; i < 3; i++) {
      const task = new TestFilterTask({ id: `chain-${i}` });
      const result = await task.executePreview({ image: curr }, previewCtx);
      curr = (result as { image: GpuImage }).image;
    }

    expect(resizeCalls).toBe(1);
    expect(filterCalls).toBe(3);
  });

  test("execute hydrates a raw ImageBinary input via the async factory before filtering", async () => {
    let receivedBackend: string | undefined;
    // Register for all backends that the async factory may produce:
    // - "sharp" on node (fromImageBinaryAsync → SharpImage)
    // - "webgpu" on browser with GPU, "cpu" on browser without GPU / fallback
    const captureOp: FilterOpFn = (image) => {
      receivedBackend = image.backend;
      return new CountingImage(image.width, image.height, image.backend);
    };
    registerFilterOp("cpu", "test-filter", captureOp);
    registerFilterOp("sharp", "test-filter", captureOp);
    registerFilterOp("webgpu", "test-filter", captureOp);

    // Plain ImageBinary shape — exactly what an unhydrated upstream produces.
    const rawBinary = {
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
      channels: 4 as const,
    };

    const task = new TestFilterTask({ id: "t1" });
    await task.execute({ image: rawBinary as unknown as GpuImage }, makeContext());

    // Hydration routes to the platform's preferred backend.
    // On node: "sharp" (fromImageBinaryAsync → SharpImage).
    // On browser with GPU: "webgpu". Without GPU or in fallback: "cpu".
    expect(["cpu", "sharp", "webgpu"]).toContain(receivedBackend);
  });

  test("executePreview hydrates a raw ImageBinary input via the async factory before filtering", async () => {
    let receivedBackend: string | undefined;
    const captureOp: FilterOpFn = (image) => {
      receivedBackend = image.backend;
      return new CountingImage(image.width, image.height, image.backend);
    };
    registerFilterOp("cpu", "test-filter", captureOp);
    registerFilterOp("sharp", "test-filter", captureOp);
    registerFilterOp("webgpu", "test-filter", captureOp);

    const rawBinary = {
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
      channels: 4 as const,
    };

    const task = new TestFilterTask({ id: "t1" });
    await task.executePreview({ image: rawBinary as unknown as GpuImage }, previewCtx);

    expect(["cpu", "sharp", "webgpu"]).toContain(receivedBackend);
  });

  test("hydrateInput throws on values that are neither GpuImage nor ImageBinary", async () => {
    registerFilterOp("cpu", "test-filter", (image) => new CountingImage(image.width, image.height));

    const task = new TestFilterTask({ id: "t1" });
    await expect(
      task.execute({ image: "not an image" as unknown as GpuImage }, makeContext()),
    ).rejects.toThrow(/ImageBinary/);
  });

  test("hydrateInput throws with constructor name and keys for unrecognized shapes", async () => {
    registerFilterOp("cpu", "test-filter", (image) => new CountingImage(image.width, image.height));

    const task = new TestFilterTask({ id: "t1" });
    class WeirdShape { foo = 1; bar = 2; }
    await expect(
      task.execute({ image: new WeirdShape() as unknown as GpuImage }, makeContext()),
    ).rejects.toThrow(/WeirdShape.*foo.*bar/);
  });
});

// ---------------------------------------------------------------------------
// Backend fallback: when the input's backend has no registered arm for the
// requested filter, ImageFilterTask.execute materializes to CpuImage and
// dispatches the cpu arm. Uses a unique filter name so it doesn't conflict
// with any codec-registered ops, avoiding the need to reset the registry.
// ---------------------------------------------------------------------------
describe("ImageFilterTask execute fallback", () => {
  class FakeFilterTask extends ImageFilterTask<undefined> {
    static override readonly type = "FakeFilterTask";
    static override readonly category = "Test";
    static override readonly cacheable = false;
    static override inputSchema(): DataPortSchema {
      return { type: "object", properties: { image: { type: "object" } }, required: ["image"] } as const satisfies DataPortSchema;
    }
    static override outputSchema(): DataPortSchema {
      return { type: "object", properties: { image: { type: "object" } }, required: ["image"] } as const satisfies DataPortSchema;
    }
    protected readonly filterName = "fake_filter_for_fallback_test";
    protected opParams() { return undefined; }
  }

  test("execute falls back to cpu when image's backend has no registered arm", async () => {
    let cpuRan = false;
    registerFilterOp<undefined>("cpu", "fake_filter_for_fallback_test", (img) => {
      cpuRan = true;
      return img;
    });

    const bin = { data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1, channels: 4 as const };
    let releasedSource = false;
    const stub = {
      backend: "webgpu" as const,
      width: 1,
      height: 1,
      channels: 4 as const,
      materialize: async () => bin,
      retain() { return this; },
      release() { releasedSource = true; },
      toCanvas: async () => { throw new Error("unused"); },
      encode: async () => { throw new Error("unused"); },
    };

    const task = new FakeFilterTask({ id: "t1" });
    const out = await task.execute(
      { image: stub as never },
      { resourceScope: undefined } as never,
    );

    expect(cpuRan).toBe(true);
    expect(releasedSource).toBe(true);
    expect(out!.image).toBeDefined();
  });

  test("executePreview falls back AFTER previewSource so over-budget images still downscale", async () => {
    registerFilterOp<undefined>("cpu", "fake_filter_for_preview_fallback", (img) => img);

    const bin = { data: new Uint8ClampedArray([10, 20, 30, 255]), width: 1, height: 1, channels: 4 as const };
    let materializeCalls = 0;
    const stub = {
      backend: "webgpu" as const,
      width: 1, height: 1, channels: 4 as const,
      materialize: async () => { materializeCalls++; return bin; },
      retain() { return this; },
      release() {},
      toCanvas: async () => { throw new Error("unused"); },
      encode: async () => { throw new Error("unused"); },
    };

    class FakePreviewTask extends ImageFilterTask<undefined> {
      static override readonly type = "FakePreviewTask";
      protected readonly filterName = "fake_filter_for_preview_fallback";
      protected opParams() { return undefined; }
      static override inputSchema() { return { type: "object", properties: { image: { type: "object" } }, required: ["image"] } as never; }
      static override outputSchema() { return { type: "object", properties: { image: { type: "object" } }, required: ["image"] } as never; }
    }

    const task = new FakePreviewTask({ id: "p1" });
    const out = await task.executePreview({ image: stub as never }, {} as never);
    expect(out!.image).toBeDefined();
    // 1 materialize from the fallback (input is small, previewSource is a no-op).
    expect(materializeCalls).toBe(1);
  });
});
