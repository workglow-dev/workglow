/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebGPU acceleration for image operations. Provides:
 *   - a lazily-initialized device shared across image tasks,
 *   - an `rgba8unorm` storage-texture pipeline cache, and
 *   - upload / download / texture-clone helpers.
 *
 * The module is browser-safe (gracefully reports unsupported on Node), so it
 * lives in the platform-neutral `@workglow/util/media` surface and the
 * browser-only Image augmentation re-exports a `texture` source kind.
 */
import type { ImageBinary, RgbaImageBinary } from "./imageTypes";

/**
 * Minimal WebGPU surface we depend on. We intentionally avoid pulling in the
 * `@webgpu/types` dependency: `unknown` casts at the boundary are sufficient
 * and let `@workglow/util/media` keep its lean dep graph.
 */
type Gpu = {
  requestAdapter(): Promise<{
    requestDevice(): Promise<unknown>;
  } | null>;
};

let cachedDevicePromise: Promise<unknown | null> | null = null;
let cachedDevice: unknown | null = null;
let unsupportedReason: string | null = null;

function getNavigatorGpu(): Gpu | null {
  if (typeof navigator === "undefined") return null;
  const gpu = (navigator as unknown as { gpu?: Gpu }).gpu;
  return gpu ?? null;
}

/** Synchronous "do we have a device already" check used to avoid awaiting in hot paths. */
export function getCachedImageGpuDevice(): unknown | null {
  return cachedDevice;
}

export function isImageGpuSupported(): boolean {
  return getNavigatorGpu() !== null;
}

export function getImageGpuUnsupportedReason(): string | null {
  return unsupportedReason;
}

/**
 * Returns a shared GPUDevice (typed `unknown` here — see file header), or null
 * if WebGPU isn't available. Callers must treat null as "fall back to CPU".
 */
export async function getImageGpuDevice(): Promise<unknown | null> {
  if (cachedDevice) return cachedDevice;
  if (cachedDevicePromise) return cachedDevicePromise;
  const gpu = getNavigatorGpu();
  if (!gpu) {
    unsupportedReason = "navigator.gpu unavailable";
    return null;
  }
  cachedDevicePromise = (async () => {
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) {
        unsupportedReason = "no GPU adapter available";
        return null;
      }
      const device = await adapter.requestDevice();
      cachedDevice = device;
      // Wire device.lost so a lost device drops the cache and the next call
      // re-acquires instead of running ops against a dead handle.
      const dev = device as { lost?: Promise<unknown> };
      dev.lost?.then(() => {
        cachedDevice = null;
        pipelineCache = new Map();
        cachedDevicePromise = null;
      });
      return device;
    } catch (err) {
      unsupportedReason = err instanceof Error ? err.message : String(err);
      return null;
    }
  })();
  return cachedDevicePromise;
}

// --------------------------------------------------------------------------
// Pipeline cache — keyed by op name + entry point.
// --------------------------------------------------------------------------

interface PipelineEntry {
  readonly module: unknown;
  readonly pipeline: unknown;
  readonly bindGroupLayout: unknown;
}

let pipelineCache = new Map<string, PipelineEntry>();

export function getOrCreateImageGpuPipeline(
  device: unknown,
  cacheKey: string,
  shader: string,
  entryPoint: string = "main"
): PipelineEntry {
  const existing = pipelineCache.get(cacheKey);
  if (existing) return existing;

  const dev = device as {
    createShaderModule(d: { code: string }): unknown;
    createComputePipeline(d: {
      layout: "auto";
      compute: { module: unknown; entryPoint: string };
    }): unknown & { getBindGroupLayout(idx: number): unknown };
  };
  const module = dev.createShaderModule({ code: shader });
  const pipeline = dev.createComputePipeline({
    layout: "auto",
    compute: { module, entryPoint },
  });
  const bindGroupLayout = (
    pipeline as { getBindGroupLayout(idx: number): unknown }
  ).getBindGroupLayout(0);
  const entry: PipelineEntry = { module, pipeline, bindGroupLayout };
  pipelineCache.set(cacheKey, entry);
  return entry;
}

// --------------------------------------------------------------------------
// Texture upload / download helpers.
//
// All textures are `rgba8unorm` with usage `STORAGE_BINDING |
// TEXTURE_BINDING | COPY_SRC | COPY_DST | RENDER_ATTACHMENT`. RGBA is the
// only universal storage-texture format guaranteed to support
// read-write-storage-binding access.
// --------------------------------------------------------------------------

const TEX_USAGE_ALL = 0x10 | 0x04 | 0x08 | 0x40 | 0x80;
// STORAGE_BINDING(0x80) | TEXTURE_BINDING(0x04) | COPY_DST(0x08) |
// COPY_SRC(0x10) | RENDER_ATTACHMENT(0x40). Numeric literals avoid pulling
// in the runtime `GPUTextureUsage` enum (it's only present in browsers,
// even though we already gated on isImageGpuSupported).

export function createImageGpuTexture(
  device: unknown,
  width: number,
  height: number,
  label?: string
): unknown {
  const dev = device as {
    createTexture(d: {
      size: { width: number; height: number; depthOrArrayLayers: number };
      format: string;
      usage: number;
      label?: string;
    }): unknown;
  };
  return dev.createTexture({
    size: { width, height, depthOrArrayLayers: 1 },
    format: "rgba8unorm",
    usage: TEX_USAGE_ALL,
    label,
  });
}

/**
 * Upload an `ImageBinary` to a GPU texture. Promotes 1/3-channel data to RGBA
 * on the CPU (cheap: a single linear pass on Uint8ClampedArray) since storage
 * textures must be 4-channel.
 */
export function uploadImageBinaryToTexture(
  device: unknown,
  image: ImageBinary,
  reusedTexture?: unknown
): unknown {
  const { width, height, channels, data } = image;
  const rgba = channels === 4 ? data : promoteToRgba(image);
  const texture =
    reusedTexture ?? createImageGpuTexture(device, width, height, "image-gpu");
  const dev = device as {
    queue: {
      writeTexture(
        dest: { texture: unknown },
        data: ArrayBufferView,
        layout: { offset: number; bytesPerRow: number; rowsPerImage: number },
        size: { width: number; height: number; depthOrArrayLayers: number }
      ): void;
    };
  };
  dev.queue.writeTexture(
    { texture },
    rgba,
    { offset: 0, bytesPerRow: width * 4, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 }
  );
  return texture;
}

function promoteToRgba(image: ImageBinary): Uint8ClampedArray {
  const { width, height, channels, data } = image;
  const out = new Uint8ClampedArray(width * height * 4);
  if (channels === 4) {
    out.set(data);
  } else if (channels === 3) {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      out[i * 4] = data[j]!;
      out[i * 4 + 1] = data[j + 1]!;
      out[i * 4 + 2] = data[j + 2]!;
      out[i * 4 + 3] = 255;
    }
  } else {
    for (let i = 0; i < width * height; i++) {
      const v = data[i]!;
      out[i * 4] = v;
      out[i * 4 + 1] = v;
      out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

/**
 * Read a 4-channel GPU texture back to an `ImageBinary`. Uses a 256-aligned
 * `bytesPerRow` (WebGPU requires it) and re-packs only when alignment padding
 * is non-zero.
 */
export async function downloadTextureToImageBinary(
  device: unknown,
  texture: unknown,
  width: number,
  height: number
): Promise<RgbaImageBinary> {
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const dev = device as {
    createBuffer(d: { size: number; usage: number }): unknown;
    createCommandEncoder(): {
      copyTextureToBuffer(
        src: { texture: unknown },
        dest: { buffer: unknown; bytesPerRow: number; rowsPerImage: number },
        size: { width: number; height: number; depthOrArrayLayers: number }
      ): void;
      finish(): unknown;
    };
    queue: { submit(buffers: unknown[]): void };
  };
  const buffer = dev.createBuffer({
    size: bytesPerRow * height,
    usage: 0x0001 | 0x0008, // MAP_READ(0x01) | COPY_DST(0x08)
  });
  const encoder = dev.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 }
  );
  const cmd = encoder.finish();
  dev.queue.submit([cmd]);

  const buf = buffer as {
    mapAsync(mode: number): Promise<void>;
    getMappedRange(): ArrayBuffer;
    unmap(): void;
    destroy?: () => void;
  };
  await buf.mapAsync(0x01); // MAP_READ
  const mapped = new Uint8Array(buf.getMappedRange());
  let pixels: Uint8ClampedArray;
  const tightRow = width * 4;
  if (bytesPerRow === tightRow) {
    pixels = new Uint8ClampedArray(mapped.slice(0, tightRow * height).buffer);
  } else {
    pixels = new Uint8ClampedArray(tightRow * height);
    for (let y = 0; y < height; y++) {
      pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + tightRow), y * tightRow);
    }
  }
  buf.unmap();
  buf.destroy?.();
  return { data: pixels, width, height, channels: 4 };
}

/**
 * Run a single-pass compute shader that reads `inputTexture` and writes
 * `outputTexture`. Bind group layout (group(0)):
 *   - 0: read-only `texture_2d<f32>` (input)
 *   - 1: write-only `texture_storage_2d<rgba8unorm, write>` (output)
 *   - 2 (optional): uniform buffer with the params struct.
 */
export function runImageGpuPass(
  device: unknown,
  pipeline: PipelineEntry,
  inputTexture: unknown,
  outputTexture: unknown,
  width: number,
  height: number,
  uniformBuffer?: unknown,
  workgroupSize: { x: number; y: number } = { x: 8, y: 8 }
): void {
  const dev = device as {
    createBindGroup(d: {
      layout: unknown;
      entries: Array<{ binding: number; resource: unknown }>;
    }): unknown;
    createCommandEncoder(): {
      beginComputePass(): {
        setPipeline(p: unknown): void;
        setBindGroup(idx: number, g: unknown): void;
        dispatchWorkgroups(x: number, y: number, z?: number): void;
        end(): void;
      };
      finish(): unknown;
    };
    queue: { submit(b: unknown[]): void };
  };
  const inTex = inputTexture as { createView(): unknown };
  const outTex = outputTexture as { createView(): unknown };
  const entries: Array<{ binding: number; resource: unknown }> = [
    { binding: 0, resource: inTex.createView() },
    { binding: 1, resource: outTex.createView() },
  ];
  if (uniformBuffer) {
    entries.push({ binding: 2, resource: { buffer: uniformBuffer } });
  }
  const bg = dev.createBindGroup({ layout: pipeline.bindGroupLayout, entries });
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline.pipeline);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(
    Math.ceil(width / workgroupSize.x),
    Math.ceil(height / workgroupSize.y)
  );
  pass.end();
  dev.queue.submit([enc.finish()]);
}

/**
 * Allocate a uniform buffer and write `floats` into it (16-byte aligned).
 * Caller is responsible for destroying when no longer needed.
 */
export function createImageGpuUniformBuffer(
  device: unknown,
  floats: readonly number[]
): unknown {
  const padded = Math.ceil(floats.length / 4) * 4;
  const data = new Float32Array(padded);
  for (let i = 0; i < floats.length; i++) data[i] = floats[i]!;
  const dev = device as {
    createBuffer(d: { size: number; usage: number; mappedAtCreation?: boolean }): unknown;
  };
  const buffer = dev.createBuffer({
    size: data.byteLength,
    usage: 0x0040 | 0x0008, // UNIFORM(0x40) | COPY_DST(0x08)
    mappedAtCreation: true,
  });
  const buf = buffer as {
    getMappedRange(): ArrayBuffer;
    unmap(): void;
  };
  new Float32Array(buf.getMappedRange()).set(data);
  buf.unmap();
  return buffer;
}

export function createImageGpuUniformIntBuffer(
  device: unknown,
  ints: readonly number[]
): unknown {
  const padded = Math.ceil(ints.length / 4) * 4;
  const data = new Int32Array(padded);
  for (let i = 0; i < ints.length; i++) data[i] = ints[i]!;
  const dev = device as {
    createBuffer(d: { size: number; usage: number; mappedAtCreation?: boolean }): unknown;
  };
  const buffer = dev.createBuffer({
    size: data.byteLength,
    usage: 0x0040 | 0x0008,
    mappedAtCreation: true,
  });
  const buf = buffer as {
    getMappedRange(): ArrayBuffer;
    unmap(): void;
  };
  new Int32Array(buf.getMappedRange()).set(data);
  buf.unmap();
  return buffer;
}

/** Free all cached pipelines. Called by the device-lost handler. */
export function resetImageGpuPipelineCache(): void {
  pipelineCache = new Map();
}
