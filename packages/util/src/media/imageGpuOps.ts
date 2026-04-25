/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebGPU compute pipelines for the image tasks. Each entry is a single
 * dispatch (or two, in the case of separable blur) that reads the input
 * texture and writes an output texture.
 *
 * All pipelines target `rgba8unorm` storage textures. Tasks that need a
 * different output channel count (grayscale, threshold, tint) reduce on the
 * CPU at boundary. The wire format between tasks is always RGBA in pixel
 * space — the channel collapse is preserved at the readback step when the
 * task explicitly produces a non-RGBA result.
 */

import {
  createImageGpuTexture,
  createImageGpuUniformBuffer,
  createImageGpuUniformIntBuffer,
  getOrCreateImageGpuPipeline,
  runImageGpuPass,
} from "./imageGpu";

const WORKGROUP = 8;

const PER_PIXEL_PROLOG = `
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
fn dims() -> vec2<u32> { return textureDimensions(inputTex); }
`;

const SEPIA_SHADER = `
${PER_PIXEL_PROLOG}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let p = textureLoad(inputTex, vec2<i32>(i32(gid.x), i32(gid.y)), 0);
  let r = p.r * 0.393 + p.g * 0.769 + p.b * 0.189;
  let g = p.r * 0.349 + p.g * 0.686 + p.b * 0.168;
  let b = p.r * 0.272 + p.g * 0.534 + p.b * 0.131;
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)),
    vec4<f32>(min(r, 1.0), min(g, 1.0), min(b, 1.0), p.a));
}
`;

const INVERT_SHADER = `
${PER_PIXEL_PROLOG}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let p = textureLoad(inputTex, vec2<i32>(i32(gid.x), i32(gid.y)), 0);
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)),
    vec4<f32>(1.0 - p.r, 1.0 - p.g, 1.0 - p.b, p.a));
}
`;

const GRAYSCALE_SHADER = `
${PER_PIXEL_PROLOG}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let p = textureLoad(inputTex, vec2<i32>(i32(gid.x), i32(gid.y)), 0);
  let g = p.r * 0.299 + p.g * 0.587 + p.b * 0.114;
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)),
    vec4<f32>(g, g, g, p.a));
}
`;

const BRIGHTNESS_SHADER = `
${PER_PIXEL_PROLOG}
struct Params { amount: f32, _pad0: f32, _pad1: f32, _pad2: f32 }
@group(0) @binding(2) var<uniform> u: Params;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let p = textureLoad(inputTex, vec2<i32>(i32(gid.x), i32(gid.y)), 0);
  let a = u.amount;
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)),
    vec4<f32>(clamp(p.r + a, 0.0, 1.0), clamp(p.g + a, 0.0, 1.0), clamp(p.b + a, 0.0, 1.0), p.a));
}
`;

const CONTRAST_SHADER = `
${PER_PIXEL_PROLOG}
struct Params { factor: f32, _pad0: f32, _pad1: f32, _pad2: f32 }
@group(0) @binding(2) var<uniform> u: Params;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let p = textureLoad(inputTex, vec2<i32>(i32(gid.x), i32(gid.y)), 0);
  let f = u.factor;
  let r = clamp(f * (p.r - 0.5) + 0.5, 0.0, 1.0);
  let g = clamp(f * (p.g - 0.5) + 0.5, 0.0, 1.0);
  let b = clamp(f * (p.b - 0.5) + 0.5, 0.0, 1.0);
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)), vec4<f32>(r, g, b, p.a));
}
`;

const POSTERIZE_SHADER = `
${PER_PIXEL_PROLOG}
struct Params { levels: f32, _pad0: f32, _pad1: f32, _pad2: f32 }
@group(0) @binding(2) var<uniform> u: Params;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let p = textureLoad(inputTex, vec2<i32>(i32(gid.x), i32(gid.y)), 0);
  let n = u.levels - 1.0;
  let r = round(p.r * n) / n;
  let g = round(p.g * n) / n;
  let b = round(p.b * n) / n;
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)), vec4<f32>(r, g, b, p.a));
}
`;

const THRESHOLD_SHADER = `
${PER_PIXEL_PROLOG}
struct Params { threshold: f32, _pad0: f32, _pad1: f32, _pad2: f32 }
@group(0) @binding(2) var<uniform> u: Params;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let p = textureLoad(inputTex, vec2<i32>(i32(gid.x), i32(gid.y)), 0);
  let g = p.r * 0.299 + p.g * 0.587 + p.b * 0.114;
  let v = select(0.0, 1.0, g >= u.threshold);
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)), vec4<f32>(v, v, v, p.a));
}
`;

const TINT_SHADER = `
${PER_PIXEL_PROLOG}
struct Params { r: f32, g: f32, b: f32, amount: f32 }
@group(0) @binding(2) var<uniform> u: Params;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let p = textureLoad(inputTex, vec2<i32>(i32(gid.x), i32(gid.y)), 0);
  let inv = 1.0 - u.amount;
  let r = p.r * inv + u.r * u.amount;
  let g = p.g * inv + u.g * u.amount;
  let b = p.b * inv + u.b * u.amount;
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)),
    vec4<f32>(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), p.a));
}
`;

const TRANSPARENCY_SHADER = `
${PER_PIXEL_PROLOG}
struct Params { opacity: f32, _pad0: f32, _pad1: f32, _pad2: f32 }
@group(0) @binding(2) var<uniform> u: Params;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let p = textureLoad(inputTex, vec2<i32>(i32(gid.x), i32(gid.y)), 0);
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)),
    vec4<f32>(p.r, p.g, p.b, clamp(p.a * u.opacity, 0.0, 1.0)));
}
`;

const PIXELATE_SHADER = `
${PER_PIXEL_PROLOG}
struct Params { blockSize: i32, _pad0: i32, _pad1: i32, _pad2: i32 }
@group(0) @binding(2) var<uniform> u: Params;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let bs = u.blockSize;
  let bx = (i32(gid.x) / bs) * bs;
  let by = (i32(gid.y) / bs) * bs;
  let bw = min(bs, i32(d.x) - bx);
  let bh = min(bs, i32(d.y) - by);
  var sum = vec4<f32>(0.0);
  for (var y = 0; y < bh; y = y + 1) {
    for (var x = 0; x < bw; x = x + 1) {
      sum = sum + textureLoad(inputTex, vec2<i32>(bx + x, by + y), 0);
    }
  }
  let avg = sum / f32(bw * bh);
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)), avg);
}
`;

const FLIP_H_SHADER = `
${PER_PIXEL_PROLOG}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let src = vec2<i32>(i32(d.x) - 1 - i32(gid.x), i32(gid.y));
  let p = textureLoad(inputTex, src, 0);
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)), p);
}
`;

const FLIP_V_SHADER = `
${PER_PIXEL_PROLOG}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let src = vec2<i32>(i32(gid.x), i32(d.y) - 1 - i32(gid.y));
  let p = textureLoad(inputTex, src, 0);
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)), p);
}
`;

// Separable box blur passes — radius is bounded to <= 32 by `imageCodecLimits`
// upstream, so a fixed loop bound is safe and lets the compiler unroll.
const BLUR_H_SHADER = `
${PER_PIXEL_PROLOG}
struct Params { radius: i32, _pad0: i32, _pad1: i32, _pad2: i32 }
@group(0) @binding(2) var<uniform> u: Params;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let r = u.radius;
  let kernel = f32(r * 2 + 1);
  var sum = vec4<f32>(0.0);
  for (var k = -r; k <= r; k = k + 1) {
    let xc = clamp(i32(gid.x) + k, 0, i32(d.x) - 1);
    sum = sum + textureLoad(inputTex, vec2<i32>(xc, i32(gid.y)), 0);
  }
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)), sum / kernel);
}
`;

const BLUR_V_SHADER = `
${PER_PIXEL_PROLOG}
struct Params { radius: i32, _pad0: i32, _pad1: i32, _pad2: i32 }
@group(0) @binding(2) var<uniform> u: Params;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = dims();
  if (gid.x >= d.x || gid.y >= d.y) { return; }
  let r = u.radius;
  let kernel = f32(r * 2 + 1);
  var sum = vec4<f32>(0.0);
  for (var k = -r; k <= r; k = k + 1) {
    let yc = clamp(i32(gid.y) + k, 0, i32(d.y) - 1);
    sum = sum + textureLoad(inputTex, vec2<i32>(i32(gid.x), yc), 0);
  }
  textureStore(outputTex, vec2<i32>(i32(gid.x), i32(gid.y)), sum / kernel);
}
`;

// --------------------------------------------------------------------------
// Single-dispatch op runners. They take a *source* GPUTexture, allocate (or
// reuse) a destination texture, and return it. Source is left intact so the
// caller can free / reuse it.
// --------------------------------------------------------------------------

interface RunCtx {
  readonly device: unknown;
  readonly width: number;
  readonly height: number;
  readonly source: unknown;
}

function runUnary(
  ctx: RunCtx,
  cacheKey: string,
  shader: string,
  uniforms?: unknown
): unknown {
  const dest = createImageGpuTexture(ctx.device, ctx.width, ctx.height, cacheKey);
  const p = getOrCreateImageGpuPipeline(ctx.device, cacheKey, shader);
  runImageGpuPass(
    ctx.device,
    p,
    ctx.source,
    dest,
    ctx.width,
    ctx.height,
    uniforms,
    { x: WORKGROUP, y: WORKGROUP }
  );
  return dest;
}

export function gpuSepia(ctx: RunCtx): unknown {
  return runUnary(ctx, "sepia", SEPIA_SHADER);
}
export function gpuInvert(ctx: RunCtx): unknown {
  return runUnary(ctx, "invert", INVERT_SHADER);
}
export function gpuGrayscale(ctx: RunCtx): unknown {
  return runUnary(ctx, "grayscale", GRAYSCALE_SHADER);
}
export function gpuFlipH(ctx: RunCtx): unknown {
  return runUnary(ctx, "flipH", FLIP_H_SHADER);
}
export function gpuFlipV(ctx: RunCtx): unknown {
  return runUnary(ctx, "flipV", FLIP_V_SHADER);
}

export function gpuBrightness(ctx: RunCtx, amount: number): unknown {
  const u = createImageGpuUniformBuffer(ctx.device, [amount, 0, 0, 0]);
  return runUnary(ctx, "brightness", BRIGHTNESS_SHADER, u);
}
export function gpuContrast(ctx: RunCtx, factor: number): unknown {
  const u = createImageGpuUniformBuffer(ctx.device, [factor, 0, 0, 0]);
  return runUnary(ctx, "contrast", CONTRAST_SHADER, u);
}
export function gpuPosterize(ctx: RunCtx, levels: number): unknown {
  const u = createImageGpuUniformBuffer(ctx.device, [levels, 0, 0, 0]);
  return runUnary(ctx, "posterize", POSTERIZE_SHADER, u);
}
export function gpuThreshold(ctx: RunCtx, threshold: number): unknown {
  const u = createImageGpuUniformBuffer(ctx.device, [threshold, 0, 0, 0]);
  return runUnary(ctx, "threshold", THRESHOLD_SHADER, u);
}
export function gpuTint(ctx: RunCtx, r: number, g: number, b: number, amount: number): unknown {
  const u = createImageGpuUniformBuffer(ctx.device, [r, g, b, amount]);
  return runUnary(ctx, "tint", TINT_SHADER, u);
}
export function gpuTransparency(ctx: RunCtx, opacity: number): unknown {
  const u = createImageGpuUniformBuffer(ctx.device, [opacity, 0, 0, 0]);
  return runUnary(ctx, "transparency", TRANSPARENCY_SHADER, u);
}
export function gpuPixelate(ctx: RunCtx, blockSize: number): unknown {
  const u = createImageGpuUniformIntBuffer(ctx.device, [blockSize, 0, 0, 0]);
  return runUnary(ctx, "pixelate", PIXELATE_SHADER, u);
}

/**
 * Two-pass separable box blur. Allocates an intermediate texture for the
 * horizontal pass, then writes the final vertical pass result. Both passes
 * share their pipeline cache entries.
 */
export function gpuBlur(ctx: RunCtx, radius: number): unknown {
  const inter = createImageGpuTexture(ctx.device, ctx.width, ctx.height, "blur-inter");
  const u = createImageGpuUniformIntBuffer(ctx.device, [radius, 0, 0, 0]);
  const horiz = getOrCreateImageGpuPipeline(ctx.device, "blurH", BLUR_H_SHADER);
  const vert = getOrCreateImageGpuPipeline(ctx.device, "blurV", BLUR_V_SHADER);
  runImageGpuPass(ctx.device, horiz, ctx.source, inter, ctx.width, ctx.height, u);
  const dest = createImageGpuTexture(ctx.device, ctx.width, ctx.height, "blur-out");
  runImageGpuPass(ctx.device, vert, inter, dest, ctx.width, ctx.height, u);
  // Free the intermediate now that the GPU has consumed it. submit() above is
  // recorded into command buffers; the runtime keeps the texture alive until
  // those finish so calling destroy here is safe.
  (inter as { destroy?: () => void }).destroy?.();
  return dest;
}
