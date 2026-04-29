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

const VERTEX_PRELUDE = `
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

const PASSTHROUGH_SRC = `${VERTEX_PRELUDE}
@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  return textureSample(src, src_sampler, in.uv);
}
`;

const FLIP_SRC = `${VERTEX_PRELUDE}
struct U { direction: u32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  // direction: 0 = horizontal (flip x), 1 = vertical (flip y).
  let flipX = u.direction == 0u;
  let flipY = u.direction == 1u;
  let uv = vec2f(
    select(in.uv.x, 1.0 - in.uv.x, flipX),
    select(in.uv.y, 1.0 - in.uv.y, flipY),
  );
  return textureSample(src, src_sampler, uv);
}
`;
const SEPIA_SRC = `${VERTEX_PRELUDE}
@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  let r = s.r * 0.393 + s.g * 0.769 + s.b * 0.189;
  let g = s.r * 0.349 + s.g * 0.686 + s.b * 0.168;
  let b = s.r * 0.272 + s.g * 0.534 + s.b * 0.131;
  return vec4f(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), s.a);
}
`;
const GRAYSCALE_SRC = `${VERTEX_PRELUDE}
@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  // Match cpuGrayscale's BT.601-ish (77,150,29)/256 weights.
  let g = (s.r * 77.0 + s.g * 150.0 + s.b * 29.0) / 256.0;
  return vec4f(g, g, g, s.a);
}
`;
const INVERT_SRC = `${VERTEX_PRELUDE}
@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  return vec4f(1.0 - s.rgb, s.a);
}
`;
const BLUR_SRC = `${VERTEX_PRELUDE}
struct U { radius: u32, direction: u32, width: f32, height: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let r = i32(u.radius);
  var sum = vec4f(0.0);
  let texel = vec2f(1.0 / u.width, 1.0 / u.height);
  // direction: 0 = horizontal, 1 = vertical.
  let dir = select(vec2f(0.0, texel.y), vec2f(texel.x, 0.0), u.direction == 0u);
  for (var k: i32 = -r; k <= r; k = k + 1) {
    let uv = clamp(in.uv + dir * f32(k), vec2f(0.0), vec2f(1.0));
    sum = sum + textureSample(src, src_sampler, uv);
  }
  let n = f32(2 * r + 1);
  return sum / n;
}
`;
const POSTERIZE_SRC = `${VERTEX_PRELUDE}
struct U { levels: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  let n = max(u.levels, 2.0);
  // Round-to-nearest quantization, matching cpuPosterize's LUT semantics.
  let q = round(s.rgb * (n - 1.0)) / (n - 1.0);
  return vec4f(clamp(q, vec3f(0.0), vec3f(1.0)), s.a);
}
`;
const BORDER_SRC = `${VERTEX_PRELUDE}
struct U { color: vec4f, borderWidth: f32, srcWidth: f32, srcHeight: f32, _pad: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let outW = u.srcWidth + 2.0 * u.borderWidth;
  let outH = u.srcHeight + 2.0 * u.borderWidth;
  let px = in.uv.x * outW;
  let py = in.uv.y * outH;
  let inside = px >= u.borderWidth && px < (u.borderWidth + u.srcWidth)
            && py >= u.borderWidth && py < (u.borderWidth + u.srcHeight);
  if (!inside) {
    return u.color;
  }
  let sx = (px - u.borderWidth) / u.srcWidth;
  let sy = (py - u.borderWidth) / u.srcHeight;
  return textureSample(src, src_sampler, vec2f(sx, sy));
}
`;
const PIXELATE_SRC = `${VERTEX_PRELUDE}
struct U { blockSize: u32, width: u32, height: u32, _pad: u32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let px = u32(in.uv.x * f32(u.width));
  let py = u32(in.uv.y * f32(u.height));
  let bx = px / u.blockSize;
  let by = py / u.blockSize;
  let startX = bx * u.blockSize;
  let startY = by * u.blockSize;
  let endX = min(startX + u.blockSize, u.width);
  let endY = min(startY + u.blockSize, u.height);

  var sum = vec4f(0.0);
  var count: f32 = 0.0;
  for (var sy: u32 = startY; sy < endY; sy = sy + 1u) {
    for (var sx: u32 = startX; sx < endX; sx = sx + 1u) {
      sum = sum + textureLoad(src, vec2i(i32(sx), i32(sy)), 0);
      count = count + 1.0;
    }
  }
  return sum / count;
}
`;
const TEXT_OVERLAY_SRC = PASSTHROUGH_SRC;
const BRIGHTNESS_SRC = `${VERTEX_PRELUDE}
struct U { amount: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  let d = u.amount / 255.0;
  return vec4f(clamp(s.rgb + vec3f(d), vec3f(0.0), vec3f(1.0)), s.a);
}
`;
const CONTRAST_SRC = `${VERTEX_PRELUDE}
struct U { amount: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  let factor = 1.0 + u.amount / 100.0;
  let rgb = (s.rgb - vec3f(0.5)) * factor + vec3f(0.5);
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), s.a);
}
`;
const THRESHOLD_SRC = `${VERTEX_PRELUDE}
struct U { value: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  let v = u.value / 255.0;
  // Per-channel binary threshold to match cpuThreshold (each of R/G/B
  // compared independently); alpha preserved.
  let r = select(0.0, 1.0, s.r >= v);
  let g = select(0.0, 1.0, s.g >= v);
  let b = select(0.0, 1.0, s.b >= v);
  return vec4f(r, g, b, s.a);
}
`;
const TRANSPARENCY_SRC = `${VERTEX_PRELUDE}
struct U { amount: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  return vec4f(s.rgb, s.a * u.amount);
}
`;
const TINT_SRC = `${VERTEX_PRELUDE}
struct U { color: vec4f, amount: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  let tinted = mix(s.rgb, u.color.rgb, u.amount);
  return vec4f(clamp(tinted, vec3f(0.0), vec3f(1.0)), s.a);
}
`;
const CROP_SRC = `${VERTEX_PRELUDE}
struct U { left: f32, top: f32, srcWidth: f32, srcHeight: f32, outWidth: f32, outHeight: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let px = u.left + in.uv.x * u.outWidth;
  let py = u.top + in.uv.y * u.outHeight;
  let uv = vec2f(px / u.srcWidth, py / u.srcHeight);
  return textureSample(src, src_sampler, uv);
}
`;
const RESIZE_SRC = `${VERTEX_PRELUDE}
@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  return textureSample(src, src_sampler, in.uv);
}
`;
const ROTATE_SRC = `${VERTEX_PRELUDE}
struct U { angle: u32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  // Map output uv back to source uv via inverse rotation.
  var srcUv = in.uv;
  if (u.angle == 90u) {
    srcUv = vec2f(in.uv.y, 1.0 - in.uv.x);
  } else if (u.angle == 180u) {
    srcUv = vec2f(1.0 - in.uv.x, 1.0 - in.uv.y);
  } else if (u.angle == 270u) {
    srcUv = vec2f(1.0 - in.uv.y, in.uv.x);
  }
  return textureSample(src, src_sampler, srcUv);
}
`;

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
