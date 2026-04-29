/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { ImageBinary, ImageChannels } from "./imageTypes";
import type { GpuImage as IGpuImage, GpuImageEncodeFormat } from "./gpuImage";
import { getGpuDevice } from "./gpuDevice.browser";
import { getTexturePool } from "./texturePool.browser";
import { getShaderCache, PASSTHROUGH_SHADER_SRC } from "./shaderRegistry.browser";

const TEX_FORMAT: GPUTextureFormat = "rgba8unorm";

const finalizers = typeof FinalizationRegistry !== "undefined"
  ? new FinalizationRegistry<() => void>((fn) => {
      try { fn(); } catch { /* device lost or pool drained */ }
    })
  : undefined;

export interface ApplyParams {
  shader: string;
  uniforms: ArrayBuffer | undefined;
  outSize?: { width: number; height: number };
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

function align(n: number, m: number): number {
  return Math.ceil(n / m) * m;
}

export class WebGpuImage implements IGpuImage {
  readonly backend = "webgpu" as const;
  readonly channels: ImageChannels = 4;

  /** Internal refcount. Initialized to 1 in fromImageBinary/apply. Reclaim at 0. */
  private refcount = 1;

  private _previewScale: number;

  private constructor(
    private device: GPUDevice,
    private texture: GPUTexture | null,
    readonly width: number,
    readonly height: number,
    previewScale: number = 1.0,
  ) {
    this._previewScale = previewScale;
    if (finalizers && texture) {
      const dev = device;
      const tex = texture;
      finalizers.register(this, () => {
        try { getTexturePool(dev).release(tex); } catch { /* device lost */ }
      }, this);
    }
  }

  get previewScale(): number {
    return this._previewScale;
  }

  /** @internal — only previewSource and ImageTextTask.executePreview (without-
   *  background source case) may call this. Mutates previewScale on this
   *  instance and returns this for chaining. */
  _setPreviewScale(scale: number): this {
    this._previewScale = scale;
    return this;
  }

  static async fromImageBinary(bin: ImageBinary): Promise<WebGpuImage> {
    const dev = await getGpuDevice();
    if (!dev) throw new Error("WebGPU device unavailable; use CpuImage.fromImageBinary instead");
    const tex = getTexturePool(dev).acquire(bin.width, bin.height, TEX_FORMAT);
    const rgba = bin.channels === 4 ? bin.data : expandToRgba(bin);
    dev.queue.writeTexture(
      { texture: tex },
      rgba,
      { bytesPerRow: bin.width * 4, rowsPerImage: bin.height },
      [bin.width, bin.height, 1],
    );
    return new WebGpuImage(dev, tex, bin.width, bin.height);
  }

  apply(params: ApplyParams): WebGpuImage {
    if (!this.texture) throw new Error("WebGpuImage.apply called on a released image");
    const outW = params.outSize?.width ?? this.width;
    const outH = params.outSize?.height ?? this.height;
    const out = getTexturePool(this.device).acquire(outW, outH, TEX_FORMAT);
    const shaderModule = getShaderCache(this.device).get(params.shader);
    const pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shaderModule, entryPoint: "vs" },
      fragment: { module: shaderModule, entryPoint: "fs", targets: [{ format: TEX_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });

    const sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    const bindEntries: GPUBindGroupEntry[] = [
      { binding: 0, resource: this.texture.createView() },
      { binding: 1, resource: sampler },
    ];
    if (params.uniforms) {
      const ubo = this.device.createBuffer({
        size: params.uniforms.byteLength,
        usage: 0x40 | 0x08, // UNIFORM | COPY_DST
      });
      this.device.queue.writeBuffer(ubo, 0, params.uniforms);
      bindEntries.push({ binding: 2, resource: { buffer: ubo } });
    }
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: bindEntries,
    });

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: out.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: [0, 0, 0, 0],
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);

    // Source texture stays alive; the caller owns its refcount and is
    // responsible for `input.release()` when done. The new image returned
    // here starts at refcount 1 and is owned by the caller.
    return new WebGpuImage(this.device, out, outW, outH, this._previewScale);
  }

  async materialize(): Promise<ImageBinary> {
    if (!this.texture) throw new Error("WebGpuImage.materialize called on a released image");
    const bytesPerRow = align(this.width * 4, 256);
    const buffer = this.device.createBuffer({
      size: bytesPerRow * this.height,
      usage: 0x01 | 0x08, // MAP_READ | COPY_DST
    });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer(
      { texture: this.texture },
      { buffer, bytesPerRow, rowsPerImage: this.height },
      [this.width, this.height, 1],
    );
    this.device.queue.submit([enc.finish()]);
    await buffer.mapAsync(0x01); // MAP_READ
    const mapped = new Uint8Array(buffer.getMappedRange());
    const tightStride = this.width * 4;
    const tight = new Uint8ClampedArray(this.width * this.height * 4);
    if (bytesPerRow === tightStride) {
      tight.set(mapped);
    } else {
      for (let y = 0; y < this.height; y++) {
        tight.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + tightStride), y * tightStride);
      }
    }
    buffer.unmap();
    buffer.destroy();
    return { data: tight, width: this.width, height: this.height, channels: 4 };
  }

  async toCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
    if (!this.texture) throw new Error("WebGpuImage.toCanvas called on a released image");
    if (canvas.width !== this.width) canvas.width = this.width;
    if (canvas.height !== this.height) canvas.height = this.height;
    const ctx = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!ctx) throw new Error("WebGpuImage.toCanvas requires a webgpu context");
    const presentationFormat = (navigator.gpu as unknown as { getPreferredCanvasFormat(): GPUTextureFormat }).getPreferredCanvasFormat();
    ctx.configure({ device: this.device, format: presentationFormat, alphaMode: "premultiplied" });
    const view = ctx.getCurrentTexture().createView();

    const shaderModule = getShaderCache(this.device).get(PASSTHROUGH_SHADER_SRC);
    const pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shaderModule, entryPoint: "vs" },
      fragment: { module: shaderModule, entryPoint: "fs", targets: [{ format: presentationFormat }] },
      primitive: { topology: "triangle-list" },
    });
    const sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.texture.createView() },
        { binding: 1, resource: sampler },
      ],
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  async encode(format: GpuImageEncodeFormat, quality?: number): Promise<Uint8Array> {
    const bin = await this.materialize();
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("WebGpuImage.encode requires an OffscreenCanvas environment");
    }
    const off = new OffscreenCanvas(this.width, this.height);
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("WebGpuImage.encode could not acquire a 2D context");
    ctx.putImageData(new ImageData(bin.data as unknown as Uint8ClampedArray<ArrayBuffer>, this.width, this.height), 0, 0);
    const blob = await off.convertToBlob({ type: `image/${format}`, quality });
    return new Uint8Array(await blob.arrayBuffer());
  }

  retain(n: number = 1): this {
    if (this.refcount <= 0) {
      throw new Error("WebGpuImage.retain called on a released image");
    }
    this.refcount += n;
    return this;
  }

  release(): void {
    if (this.refcount <= 0) {
      throw new Error("WebGpuImage.release called on a released image");
    }
    this.refcount -= 1;
    if (this.refcount > 0) return;
    if (this.texture) {
      const tex = this.texture;
      this.texture = null;
      if (finalizers) finalizers.unregister(this);
      getTexturePool(this.device).release(tex);
    }
  }
}
