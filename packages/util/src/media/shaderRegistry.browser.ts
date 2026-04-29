/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

export const VERTEX_PRELUDE = `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var src_sampler: sampler;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VsOut {
  let xy = vec2f(f32((vid << 1u) & 2u), f32(vid & 2u));
  var out: VsOut;
  out.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  out.uv  = vec2f(xy.x, 1.0 - xy.y);
  return out;
}`;

// Used by WebGpuImage.toCanvas to blit a texture to the swap-chain image.
export const PASSTHROUGH_SHADER_SRC = `${VERTEX_PRELUDE}
@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  return textureSample(src, src_sampler, in.uv);
}
`;

export interface ShaderCache {
  get(source: string): GPUShaderModule;
}

export function createShaderCache(device: GPUDevice): ShaderCache {
  const map = new Map<string, GPUShaderModule>();
  return {
    get(source) {
      let mod = map.get(source);
      if (!mod) {
        mod = device.createShaderModule({ code: source });
        map.set(source, mod);
      }
      return mod;
    },
  };
}

let singleton: { device: GPUDevice; cache: ShaderCache } | null = null;

export function getShaderCache(device: GPUDevice): ShaderCache {
  if (!singleton || singleton.device !== device) {
    singleton = { device, cache: createShaderCache(device) };
  }
  return singleton.cache;
}
