/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { describe, expect, test, vi } from "vitest";
import { createShaderCache, SHADER_SRC, type ShaderName } from "@workglow/util/media";

describe("ShaderRegistry", () => {
  test("compiles a shader once per source string (cached by source)", () => {
    const compile = vi.fn((src: string) => ({ src }));
    const fakeDevice = { createShaderModule: ({ code }: { code: string }) => compile(code) } as unknown as GPUDevice;
    const cache = createShaderCache(fakeDevice);
    const a = cache.get("@@SRC@@");
    const b = cache.get("@@SRC@@");
    expect(a).toBe(b);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  test("different sources compile separately", () => {
    const compile = vi.fn((src: string) => ({ src }));
    const fakeDevice = { createShaderModule: ({ code }: { code: string }) => compile(code) } as unknown as GPUDevice;
    const cache = createShaderCache(fakeDevice);
    cache.get("A");
    cache.get("B");
    expect(compile).toHaveBeenCalledTimes(2);
  });

  test("SHADER_SRC contains all 13 named shaders with non-empty WGSL text", () => {
    const expectedNames: ShaderName[] = [
      "passthrough", "flip", "sepia", "grayscale", "invert", "blur", "posterize", "border", "pixelate", "textOverlay",
      "crop", "resize", "rotate",
    ];
    for (const name of expectedNames) {
      expect(typeof SHADER_SRC[name]).toBe("string");
      expect(SHADER_SRC[name].length).toBeGreaterThan(0);
      expect(SHADER_SRC[name]).toMatch(/@vertex/);
      expect(SHADER_SRC[name]).toMatch(/@fragment/);
    }
  });
});
