/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

export interface TexturePoolOptions {
  capacityPerSize?: number;
}

export interface TexturePool {
  acquire(width: number, height: number, format: GPUTextureFormat): GPUTexture;
  release(texture: GPUTexture): void;
  drain(): void;
}

interface PooledTexture {
  texture: GPUTexture;
  width: number;
  height: number;
  format: GPUTextureFormat;
}

const DEFAULT_CAPACITY_PER_SIZE = 8;
const TEXTURE_USAGE = 0x04 | 0x10 | 0x01 | 0x02; // TEXTURE_BINDING | RENDER_ATTACHMENT | COPY_SRC | COPY_DST

export function createTexturePool(device: GPUDevice, opts: TexturePoolOptions = {}): TexturePool {
  const capacity = opts.capacityPerSize ?? DEFAULT_CAPACITY_PER_SIZE;
  const buckets = new Map<string, PooledTexture[]>();
  const owners = new WeakMap<GPUTexture, PooledTexture>();

  const sizeClassKey = (w: number, h: number, f: GPUTextureFormat) => `${w}x${h}:${f}`;

  return {
    acquire(width, height, format) {
      const k = sizeClassKey(width, height, format);
      const bucket = buckets.get(k);
      if (bucket && bucket.length > 0) {
        const reused = bucket.pop()!;
        return reused.texture;
      }
      const texture = device.createTexture({
        size: [width, height, 1],
        format,
        usage: TEXTURE_USAGE,
      });
      const entry: PooledTexture = { texture, width, height, format };
      owners.set(texture, entry);
      return texture;
    },

    release(texture) {
      const entry = owners.get(texture);
      if (!entry) return;
      const k = sizeClassKey(entry.width, entry.height, entry.format);
      let bucket = buckets.get(k);
      if (!bucket) {
        bucket = [];
        buckets.set(k, bucket);
      }
      if (bucket.length >= capacity) {
        texture.destroy();
        return;
      }
      bucket.push(entry);
    },

    drain() {
      for (const bucket of buckets.values()) {
        for (const entry of bucket) entry.texture.destroy();
      }
      buckets.clear();
    },
  };
}

let singleton: { device: GPUDevice; pool: TexturePool } | null = null;

export function getTexturePool(device: GPUDevice): TexturePool {
  if (!singleton || singleton.device !== device) {
    singleton?.pool.drain();
    singleton = { device, pool: createTexturePool(device) };
  }
  return singleton.pool;
}

export function resetTexturePoolForTests(): void {
  singleton?.pool.drain();
  singleton = null;
}
