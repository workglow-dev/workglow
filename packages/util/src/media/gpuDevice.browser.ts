/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

let cached: Promise<GPUDevice | null> | null = null;

export async function getGpuDevice(): Promise<GPUDevice | null> {
  if (cached) return cached;
  cached = (async () => {
    if (typeof navigator === "undefined" || !("gpu" in navigator)) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    device.lost.then(() => {
      cached = null;
    });
    return device;
  })();
  return cached;
}

export function resetGpuDeviceForTests(): void {
  cached = null;
}
