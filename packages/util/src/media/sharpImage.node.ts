/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { ImageBinary, ImageChannels } from "./imageTypes";
import type { GpuImage as IGpuImage, GpuImageEncodeFormat } from "./gpuImage";

// Sharp's TypeScript types are heavyweight; treat the local type as opaque.
type Sharp = {
  clone(): Sharp;
  flip(): Sharp;
  flop(): Sharp;
  blur(sigma: number): Sharp;
  grayscale(grayscale?: boolean): Sharp;
  negate(options?: { alpha?: boolean }): Sharp;
  recomb(matrix: number[][]): Sharp;
  linear(a: number, b: number): Sharp;
  threshold(threshold: number, options?: { grayscale?: boolean }): Sharp;
  tint(rgb: { r: number; g: number; b: number }): Sharp;
  ensureAlpha(alpha?: number): Sharp;
  extend(options: { top?: number; bottom?: number; left?: number; right?: number; background?: unknown }): Sharp;
  extract(region: { left: number; top: number; width: number; height: number }): Sharp;
  rotate(angle?: number, options?: { background?: unknown }): Sharp;
  resize(width?: number | null, height?: number | null, options?: { kernel?: string; fit?: string; background?: unknown }): Sharp;
  raw(): Sharp;
  png(opts?: unknown): Sharp;
  jpeg(opts?: unknown): Sharp;
  webp(opts?: unknown): Sharp;
  metadata(): Promise<{ width?: number; height?: number; channels?: number }>;
  toBuffer(opts?: unknown): Promise<Buffer | { data: Buffer; info: { width: number; height: number; channels: number } }>;
};

type SharpModule = (
  input?: Buffer | Uint8ClampedArray,
  opts?: { raw?: { width: number; height: number; channels: 1 | 2 | 3 | 4 } },
) => Sharp;

let cachedSharp: SharpModule | null = null;
async function loadSharp(): Promise<SharpModule> {
  if (cachedSharp) return cachedSharp;
  const mod = await import("sharp");
  cachedSharp = ((mod as { default?: unknown }).default ?? mod) as SharpModule;
  return cachedSharp;
}

export class SharpImage implements IGpuImage {
  readonly backend = "sharp" as const;

  private constructor(
    private pipeline: Sharp,
    readonly width: number,
    readonly height: number,
    readonly channels: ImageChannels,
  ) {}

  static async fromImageBinary(bin: ImageBinary): Promise<SharpImage> {
    const sharp = await loadSharp();
    const buf = Buffer.from(bin.data.buffer, bin.data.byteOffset, bin.data.byteLength);
    const pipeline = sharp(buf, {
      raw: { width: bin.width, height: bin.height, channels: bin.channels as 1 | 2 | 3 | 4 },
    });
    return new SharpImage(pipeline, bin.width, bin.height, bin.channels);
  }

  static async fromBuffer(buf: Buffer): Promise<SharpImage> {
    const sharp = await loadSharp();
    const pipeline = sharp(buf);
    const meta = await pipeline.clone().metadata();
    if (typeof meta.width !== "number" || typeof meta.height !== "number") {
      throw new Error("SharpImage.fromBuffer: input has no width/height metadata");
    }
    return new SharpImage(pipeline, meta.width, meta.height, (meta.channels ?? 4) as ImageChannels);
  }

  apply(op: (p: Sharp) => Sharp, outSize?: { width: number; height: number; channels?: ImageChannels }): SharpImage {
    const next = op(this.pipeline.clone());
    return new SharpImage(
      next,
      outSize?.width ?? this.width,
      outSize?.height ?? this.height,
      outSize?.channels ?? this.channels,
    );
  }

  async materialize(): Promise<ImageBinary> {
    const result = await this.pipeline.clone().raw().toBuffer({ resolveWithObject: true });
    if (!isObjectResult(result)) {
      throw new Error("SharpImage.materialize: expected resolveWithObject result");
    }
    const { data, info } = result;
    const out = new Uint8ClampedArray(data.length);
    out.set(data);
    return {
      data: out,
      width: info.width,
      height: info.height,
      channels: info.channels as ImageChannels,
    };
  }

  async toCanvas(_canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
    throw new Error("SharpImage.toCanvas is not supported in node/bun environments");
  }

  async encode(format: GpuImageEncodeFormat, quality?: number): Promise<Uint8Array> {
    const p = this.pipeline.clone();
    let result: unknown;
    if (format === "png") result = await p.png({ quality }).toBuffer();
    else if (format === "jpeg") result = await p.jpeg({ quality }).toBuffer();
    else result = await p.webp({ quality }).toBuffer();
    const buf = result as Buffer;
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  retain(_n: number = 1): this {
    // Sharp manages its own buffers via libuv; no explicit retain.
    return this;
  }

  release(): void {
    // Sharp manages its own buffers via libuv; no explicit release.
  }
}

function isObjectResult(r: unknown): r is { data: Buffer; info: { width: number; height: number; channels: number } } {
  return !!r && typeof r === "object" && "data" in r && "info" in r;
}
