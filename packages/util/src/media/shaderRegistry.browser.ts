/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

// Shader sources live as TS string constants (the canonical source of truth).
// Phase 3 replaces each per-filter constant with its real fragment as the
// corresponding filter task is migrated. All constants currently hold the
// passthrough body so device.createShaderModule succeeds; an apply() of a
// not-yet-implemented filter blits the source unchanged.
//
// We don't load .wgsl files: bun build doesn't honor Vite's `?raw` query, and
// dual entry points (browser via ?raw, node via readFileSync) just to ship
// strings would be over-engineered for content that's edited inline anyway.

const PASSTHROUGH_SRC = `// Fullscreen passthrough — canvas blits and stub fragment.

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
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  return textureSample(src, src_sampler, in.uv);
}
`;

const FLIP_SRC = PASSTHROUGH_SRC;
const SEPIA_SRC = PASSTHROUGH_SRC;
const GRAYSCALE_SRC = PASSTHROUGH_SRC;
const INVERT_SRC = PASSTHROUGH_SRC;
const BLUR_SRC = PASSTHROUGH_SRC;
const POSTERIZE_SRC = PASSTHROUGH_SRC;
const BORDER_SRC = PASSTHROUGH_SRC;
const PIXELATE_SRC = PASSTHROUGH_SRC;
const TEXT_OVERLAY_SRC = PASSTHROUGH_SRC;
const BRIGHTNESS_SRC = PASSTHROUGH_SRC;
const CONTRAST_SRC = PASSTHROUGH_SRC;
const THRESHOLD_SRC = PASSTHROUGH_SRC;
const TRANSPARENCY_SRC = PASSTHROUGH_SRC;
const TINT_SRC = PASSTHROUGH_SRC;
const CROP_SRC = PASSTHROUGH_SRC;
const RESIZE_SRC = PASSTHROUGH_SRC;
const ROTATE_SRC = PASSTHROUGH_SRC;

export const SHADER_SRC = {
  passthrough: PASSTHROUGH_SRC,
  flip: FLIP_SRC,
  sepia: SEPIA_SRC,
  grayscale: GRAYSCALE_SRC,
  invert: INVERT_SRC,
  blur: BLUR_SRC,
  posterize: POSTERIZE_SRC,
  border: BORDER_SRC,
  pixelate: PIXELATE_SRC,
  textOverlay: TEXT_OVERLAY_SRC,
  brightness: BRIGHTNESS_SRC,
  contrast: CONTRAST_SRC,
  threshold: THRESHOLD_SRC,
  transparency: TRANSPARENCY_SRC,
  tint: TINT_SRC,
  crop: CROP_SRC,
  resize: RESIZE_SRC,
  rotate: ROTATE_SRC,
} as const;

export type ShaderName = keyof typeof SHADER_SRC;

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
