/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { ImageBinary } from "./imageTypes";
import {
  registerGpuImageFactory,
  type GpuImage as IGpuImage,
  type GpuImageEncodeFormat,
} from "./gpuImage";
import { getImageRasterCodec } from "./imageRasterCodecRegistry";

const FORMAT_TO_MIME: Record<GpuImageEncodeFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function dataUriToBytes(dataUri: string): Uint8Array {
  const comma = dataUri.indexOf(",");
  const b64 = dataUri.slice(comma + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function expandToRgba(bin: ImageBinary): Uint8ClampedArray {
  if (bin.channels === 4) return bin.data;
  const px = bin.width * bin.height;
  const out = new Uint8ClampedArray(px * 4);
  if (bin.channels === 3) {
    for (let i = 0; i < px; i++) {
      out[i * 4 + 0] = bin.data[i * 3 + 0] ?? 0;
      out[i * 4 + 1] = bin.data[i * 3 + 1] ?? 0;
      out[i * 4 + 2] = bin.data[i * 3 + 2] ?? 0;
      out[i * 4 + 3] = 255;
    }
  } else if (bin.channels === 1) {
    for (let i = 0; i < px; i++) {
      const g = bin.data[i] ?? 0;
      out[i * 4 + 0] = g;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = g;
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

export class CpuImage implements IGpuImage {
  readonly backend = "cpu" as const;

  private _previewScale: number;

  private constructor(private readonly bin: ImageBinary, previewScale: number = 1.0) {
    this._previewScale = previewScale;
  }

  get width(): number {
    return this.bin.width;
  }
  get height(): number {
    return this.bin.height;
  }
  get channels(): ImageBinary["channels"] {
    return this.bin.channels;
  }

  get previewScale(): number {
    return this._previewScale;
  }

  /** @internal — only previewSource and ImageTextTask.executePreview (without-
   *  background source case) may call this. */
  _setPreviewScale(scale: number): this {
    this._previewScale = scale;
    return this;
  }

  async materialize(): Promise<ImageBinary> {
    return this.bin;
  }

  /** @internal — synchronous accessor used by per-filter cpu ops to avoid awaiting materialize(). */
  getBinary(): ImageBinary {
    return this.bin;
  }

  async toCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
    if (typeof ImageData === "undefined") {
      throw new Error("CpuImage.toCanvas requires a browser environment with ImageData");
    }
    const rgba = expandToRgba(this.bin);
    const id = new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), this.bin.width, this.bin.height);
    if (canvas.width !== this.bin.width) canvas.width = this.bin.width;
    if (canvas.height !== this.bin.height) canvas.height = this.bin.height;
    const ctx = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("CpuImage.toCanvas could not acquire a 2D context");
    ctx.putImageData(id, 0, 0);
  }

  async encode(format: GpuImageEncodeFormat, _quality?: number): Promise<Uint8Array> {
    const codec = getImageRasterCodec();
    const dataUri = await codec.encodeDataUri(this.bin, FORMAT_TO_MIME[format]);
    return dataUriToBytes(dataUri);
  }

  retain(_n: number = 1): this {
    // No-op: CpuImage owns no GPU/native resources.
    return this;
  }

  release(): void {
    // No-op: CpuImage owns no GPU/native resources.
  }

  static fromImageBinary(bin: ImageBinary, previewScale: number = 1.0): CpuImage {
    return new CpuImage(bin, previewScale);
  }
}

// Universal fallback: register CpuImage as the synchronous-factory implementation.
// Subsequent backends (WebGpuImage, SharpImage) intentionally do NOT override this
// because their fromImageBinary is async; the input resolver awaits them directly.
registerGpuImageFactory("fromImageBinary", CpuImage.fromImageBinary);
