/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AiProviderRegistry,
  GenerateImageTask,
  setAiProviderRegistry,
  getAiProviderRegistry,
  DirectExecutionStrategy,
} from "@workglow/ai";
import type { AiProviderStreamFn, ModelConfig } from "@workglow/ai";
import type { GpuImage } from "@workglow/util/media";

const MOCK_PROVIDER = "mock-image-provider";

function makeFakeImage(label: string): GpuImage {
  let count = 1;
  let released = false;
  return {
    width: 4,
    height: 4,
    channels: 4,
    backend: "cpu",
    previewScale: 1,
    materialize: async () =>
      ({ data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4, channels: 4 }) as any,
    toCanvas: async () => {},
    encode: async () => new Uint8Array(),
    retain(n = 1) {
      if (released) throw new Error(`retain after release: ${label}`);
      count += n;
      return this as any;
    },
    release() {
      if (released) throw new Error(`double release: ${label}`);
      count -= 1;
      if (count <= 0) released = true;
    },
    _released: () => released,
  } as unknown as GpuImage;
}

describe("AiImageOutputTask end-to-end streaming via runStream", () => {
  beforeEach(() => {
    setAiProviderRegistry(new AiProviderRegistry());
    getAiProviderRegistry().setDefaultStrategy(new DirectExecutionStrategy());
  });

  afterEach(() => {
    setAiProviderRegistry(new AiProviderRegistry());
  });

  it("releases each prior partial on the next snapshot, keeps the final retained for the output", async () => {
    const partials = [makeFakeImage("p1"), makeFakeImage("p2"), makeFakeImage("p3")];

    const stream: AiProviderStreamFn = async function* () {
      for (let i = 0; i < partials.length; i++) {
        yield { type: "snapshot", data: { image: partials[i] } } as any;
      }
      yield { type: "finish", data: {} } as any;
    };

    getAiProviderRegistry().registerStreamFn(MOCK_PROVIDER, "GenerateImageTask", stream);

    const model: ModelConfig = {
      model_id: "mock/img-1",
      provider: MOCK_PROVIDER,
      title: "Mock Image Model",
      description: "",
      tasks: ["GenerateImageTask"],
      provider_config: {},
      metadata: {},
    };

    const task = new GenerateImageTask({ defaults: { model, prompt: "x", seed: 7 } });
    const result = await task.run();

    expect(result.image).toBe(partials[2]);
    expect((partials[2] as any)._released()).toBe(false);
    expect((partials[0] as any)._released()).toBe(true);
    expect((partials[1] as any)._released()).toBe(true);
  });

  it("releases the buffered partial on abort", async () => {
    const partial = makeFakeImage("p1");
    const stream: AiProviderStreamFn = async function* (_input, _model, signal) {
      yield { type: "snapshot", data: { image: partial } } as any;
      // Hang until aborted.
      await new Promise<never>((_, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    };

    getAiProviderRegistry().registerStreamFn(MOCK_PROVIDER, "GenerateImageTask", stream);

    const model: ModelConfig = {
      model_id: "mock/img-1",
      provider: MOCK_PROVIDER,
      title: "",
      description: "",
      tasks: ["GenerateImageTask"],
      provider_config: {},
      metadata: {},
    };

    const task = new GenerateImageTask({ defaults: { model, prompt: "x", seed: 7 } });
    const runPromise = task.run();
    setTimeout(() => task.runner.abort(), 20);
    await expect(runPromise).rejects.toBeDefined();
    expect((partial as any)._released()).toBe(true);
  });
});
