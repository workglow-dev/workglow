/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageBinary, ImageChannels, ImageDataSupport } from "./imageTypes";
import { parseDataUri } from "./imageTypes";
import { getImageRasterCodec } from "./imageRasterCodecRegistry";
import { MediaRawImage, isMediaRawImageShape } from "./MediaRawImage";

/**
 * Legacy wire format: either a raw `data:image/...;base64,...` URI or a
 * serialized {@link ImageBinary} with `data` as a plain number array
 * (`Array.from(Uint8ClampedArray)`) to avoid the indexed-object pitfall
 * when stringified through `JSON.stringify`.
 */
export type ImageJson =
  | string
  | {
      readonly data: readonly number[];
      readonly width: number;
      readonly height: number;
      readonly channels: ImageChannels;
    };

export type ImageSourceKind =
  | "dataUri"
  | "pixels"
  | "blob"
  | "bitmap"
  | "videoFrame"
  | "offscreenCanvas";

type ImageSource =
  | { readonly kind: "dataUri"; readonly dataUri: string; readonly mimeType: string }
  | { readonly kind: "pixels"; readonly pixels: ImageBinary }
  | { readonly kind: "blob"; readonly blob: Blob }
  | { readonly kind: "bitmap"; readonly bitmap: ImageBitmap }
  | { readonly kind: "videoFrame"; readonly frame: VideoFrame }
  | { readonly kind: "offscreenCanvas"; readonly canvas: OffscreenCanvas };

const IMAGE_BRAND = Symbol.for("@workglow/util/media/Image");

function parseDataUriMimeType(dataUri: string): string {
  const match = dataUri.match(/^data:([^;,]+)/);
  const raw = match?.[1]?.trim();
  return raw ? raw.toLowerCase() : "image/png";
}

export function dataUriToBlob(dataUri: string): Blob {
  const { mimeType, base64 } = parseDataUri(dataUri);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function toImageBinary(value: {
  data: unknown;
  width: number;
  height: number;
  channels: number;
  rawChannels?: number | undefined;
}): ImageBinary {
  const ch = value.channels;
  if (ch !== 1 && ch !== 3 && ch !== 4) {
    throw new Error(`Image: unsupported channel count ${ch}`);
  }
  const data = coerceToUint8ClampedArray(value.data);
  return {
    data,
    width: value.width,
    height: value.height,
    channels: ch,
    rawChannels: value.rawChannels,
  };
}

function coerceToUint8ClampedArray(data: unknown): Uint8ClampedArray {
  if (data instanceof Uint8ClampedArray) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8ClampedArray(
      (data as ArrayBufferView).buffer,
      (data as ArrayBufferView).byteOffset,
      (data as ArrayBufferView).byteLength
    );
  }
  if (Array.isArray(data)) {
    return Uint8ClampedArray.from(data as ArrayLike<number>);
  }
  if (data && typeof data === "object") {
    // Indexed-object form produced by JSON.stringify(Uint8ClampedArray).
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      const arr = new Uint8ClampedArray(keys.length);
      for (let i = 0; i < keys.length; i++) {
        arr[i] = Number(obj[String(i)]);
      }
      return arr;
    }
  }
  throw new Error("Image: pixel data is not array-like");
}

/**
 * Unified image representation: holds a single source (dataUri, pixels, blob,
 * bitmap, video frame, or offscreen canvas) and converts on demand.
 *
 * - `toJSON()` normalizes to `{ kind, ... }`; no `Uint8ClampedArray` indexed-
 *   object serialization pitfall.
 * - `fromJSON()` accepts the new discriminated shape **and** legacy shapes
 *   (raw data URI, raw `ImageBinary`, indexed-object `data`) for migration.
 * - `toFirstSupported(supports[])` replaces `convertImageDataToUseableForm`.
 */
export class Image {
  /** @internal brand so `Image.is` works across realms. */
  readonly [IMAGE_BRAND]: true = true;

  private source: ImageSource;
  private pixelsCache: ImageBinary | undefined;
  private dataUriCache: Map<string, string> = new Map();
  private blobCache: Map<string, Blob> = new Map();

  private constructor(source: ImageSource) {
    this.source = source;
  }

  static fromDataUri(dataUri: string): Image {
    if (!dataUri.startsWith("data:")) {
      throw new Error("Image.fromDataUri: input must start with 'data:'");
    }
    return new Image({ kind: "dataUri", dataUri, mimeType: parseDataUriMimeType(dataUri) });
  }

  static fromPixels(pixels: ImageBinary): Image {
    return new Image({ kind: "pixels", pixels });
  }

  static fromBlob(blob: Blob): Image {
    return new Image({ kind: "blob", blob });
  }

  /** Accepts anything `convertImageDataToUseableForm` accepted today, plus `Image`. */
  static from(value: unknown): Image {
    if (Image.is(value)) {
      return value;
    }
    if (typeof value === "string" && value.startsWith("data:")) {
      return Image.fromDataUri(value);
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      return Image.fromBlob(value);
    }
    if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
      return new Image({ kind: "bitmap", bitmap: value });
    }
    if (typeof VideoFrame !== "undefined" && value instanceof VideoFrame) {
      return new Image({ kind: "videoFrame", frame: value });
    }
    if (typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas) {
      return new Image({ kind: "offscreenCanvas", canvas: value });
    }
    if (
      value &&
      typeof value === "object" &&
      "data" in value &&
      "width" in value &&
      "height" in value &&
      "channels" in value
    ) {
      return Image.fromPixels(toImageBinary(value as never));
    }
    throw new Error(`Image.from: unsupported image value of type ${typeof value}`);
  }

  static is(value: unknown): value is Image {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as Record<symbol, unknown>)[IMAGE_BRAND] === true
    );
  }

  /**
   * Reconstruct an {@link Image} from its serialized form. Accepts a raw
   * `data:` URI string, a pixel-backed object `{data,width,height,channels}`
   * (with `data` as typed array, plain array, or the indexed-object pitfall
   * produced by `JSON.stringify(Uint8ClampedArray)`), or an `Image` instance.
   */
  static fromJSON(value: unknown): Image {
    if (Image.is(value)) {
      return value;
    }
    if (typeof value === "string" && value.startsWith("data:")) {
      return Image.fromDataUri(value);
    }
    if (
      value &&
      typeof value === "object" &&
      "data" in value &&
      typeof (value as { width?: unknown }).width === "number" &&
      typeof (value as { height?: unknown }).height === "number" &&
      typeof (value as { channels?: unknown }).channels === "number"
    ) {
      const v = value as {
        data: unknown;
        width: number;
        height: number;
        channels: number;
      };
      return Image.fromPixels(
        toImageBinary({
          data: v.data,
          width: v.width,
          height: v.height,
          channels: v.channels,
        })
      );
    }
    throw new Error("Image.fromJSON: value does not match any known Image shape");
  }

  get kind(): ImageSourceKind {
    return this.source.kind;
  }

  get mimeType(): string | undefined {
    if (this.source.kind === "dataUri") return this.source.mimeType;
    if (this.source.kind === "blob") return this.source.blob.type || undefined;
    return undefined;
  }

  get width(): number | undefined {
    if (this.source.kind === "pixels") return this.source.pixels.width;
    if (this.source.kind === "bitmap") return this.source.bitmap.width;
    if (this.source.kind === "offscreenCanvas") return this.source.canvas.width;
    if (this.source.kind === "videoFrame") return this.source.frame.displayWidth;
    return this.pixelsCache?.width;
  }

  get height(): number | undefined {
    if (this.source.kind === "pixels") return this.source.pixels.height;
    if (this.source.kind === "bitmap") return this.source.bitmap.height;
    if (this.source.kind === "offscreenCanvas") return this.source.canvas.height;
    if (this.source.kind === "videoFrame") return this.source.frame.displayHeight;
    return this.pixelsCache?.height;
  }

  get channels(): ImageChannels | undefined {
    if (this.source.kind === "pixels") return this.source.pixels.channels;
    return this.pixelsCache?.channels;
  }

  async getPixels(): Promise<ImageBinary> {
    if (this.pixelsCache) return this.pixelsCache;
    if (this.source.kind === "pixels") {
      this.pixelsCache = this.source.pixels;
      return this.pixelsCache;
    }
    if (this.source.kind === "dataUri") {
      this.pixelsCache = await getImageRasterCodec().decodeDataUri(this.source.dataUri);
      return this.pixelsCache;
    }
    if (this.source.kind === "blob") {
      const dataUri = await blobToDataUri(this.source.blob);
      this.pixelsCache = await getImageRasterCodec().decodeDataUri(dataUri);
      return this.pixelsCache;
    }
    throw new Error(
      `Image.getPixels: browser-only source '${this.source.kind}' requires Image.browser augmentation`
    );
  }

  async getDataUri(mimeType: string = "image/png"): Promise<string> {
    if (this.source.kind === "dataUri") {
      if (mimeType === this.source.mimeType || mimeType === "image/png") {
        return this.source.dataUri;
      }
    }
    const cached = this.dataUriCache.get(mimeType);
    if (cached) return cached;
    const pixels = await this.getPixels();
    const dataUri = await getImageRasterCodec().encodeDataUri(pixels, mimeType);
    this.dataUriCache.set(mimeType, dataUri);
    return dataUri;
  }

  async getBlob(mimeType: string = "image/png"): Promise<Blob> {
    if (this.source.kind === "blob" && (!mimeType || this.source.blob.type === mimeType)) {
      return this.source.blob;
    }
    const cached = this.blobCache.get(mimeType);
    if (cached) return cached;
    if (this.source.kind === "dataUri" && this.source.mimeType === mimeType) {
      const blob = dataUriToBlob(this.source.dataUri);
      this.blobCache.set(mimeType, blob);
      return blob;
    }
    const dataUri = await this.getDataUri(mimeType);
    const blob = dataUriToBlob(dataUri);
    this.blobCache.set(mimeType, blob);
    return blob;
  }

  /**
   * Return the first representation in `supports` that can be produced on
   * this platform. Mirrors the list-order semantics of the former
   * `convertImageDataToUseableForm`: earlier entries win.
   */
  async toFirstSupported(supports: readonly ImageDataSupport[]): Promise<unknown> {
    const canonical = this.canonicalSupport();
    if (canonical && supports.includes(canonical)) {
      return this.currentSourceValue();
    }
    for (const want of supports) {
      switch (want) {
        case "ImageBinary":
          return this.getPixels();
        case "Blob":
          return this.getBlob();
        case "DataUri":
          return this.getDataUri();
        case "RawImage": {
          const p = await this.getPixels();
          return new MediaRawImage(p.data, p.width, p.height, p.channels);
        }
        case "ImageBitmap":
        case "VideoFrame":
        case "OffscreenCanvas": {
          const asBrowser = this as unknown as {
            toFirstSupportedBrowser?: (
              want: ImageDataSupport
            ) => Promise<unknown> | undefined;
          };
          if (asBrowser.toFirstSupportedBrowser) {
            const produced = await asBrowser.toFirstSupportedBrowser(want);
            if (produced !== undefined) return produced;
          }
          continue;
        }
        case "Sharp":
          continue;
      }
    }
    throw new Error(
      `Image.toFirstSupported: none of [${supports.join(", ")}] can be produced on this platform`
    );
  }

  toJSON(): ImageJson {
    if (this.source.kind === "dataUri") {
      return this.source.dataUri;
    }
    const pixels =
      this.source.kind === "pixels" ? this.source.pixels : this.pixelsCache;
    if (pixels) {
      return {
        data: Array.from(pixels.data),
        width: pixels.width,
        height: pixels.height,
        channels: pixels.channels,
      };
    }
    throw new Error(
      "Image.toJSON: cannot serialize transient source '" +
        this.source.kind +
        "' synchronously — call getPixels() or getDataUri() first"
    );
  }

  private canonicalSupport(): ImageDataSupport | undefined {
    switch (this.source.kind) {
      case "dataUri":
        return "DataUri";
      case "pixels":
        return "ImageBinary";
      case "blob":
        return "Blob";
      case "bitmap":
        return "ImageBitmap";
      case "videoFrame":
        return "VideoFrame";
      case "offscreenCanvas":
        return "OffscreenCanvas";
    }
  }

  /** @internal */
  getSource(): ImageSource {
    return this.source;
  }

  /** @internal */
  setPixelsCache(pixels: ImageBinary): void {
    this.pixelsCache = pixels;
  }

  private currentSourceValue(): unknown {
    switch (this.source.kind) {
      case "dataUri":
        return this.source.dataUri;
      case "pixels":
        return this.source.pixels;
      case "blob":
        return this.source.blob;
      case "bitmap":
        return this.source.bitmap;
      case "videoFrame":
        return this.source.frame;
      case "offscreenCanvas":
        return this.source.canvas;
    }
  }
}

async function blobToDataUri(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const mime = blob.type || "image/png";
  return `data:${mime};base64,${btoa(binary)}`;
}

export { MediaRawImage, isMediaRawImageShape };
