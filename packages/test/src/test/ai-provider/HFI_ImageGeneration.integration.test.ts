/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeAll } from "vitest";
import { GenerateImageTask, EditImageTask } from "@workglow/ai";
import { registerHfInferenceInline } from "@workglow/ai-provider/hf-inference/runtime";

const RUN = !!process.env.HF_TOKEN;

describe.skipIf(!RUN)("HuggingFace Inference image generation (live)", () => {
  beforeAll(async () => {
    await registerHfInferenceInline();
  });

  it("generates an image with FLUX.1-schnell", async () => {
    const result = await new GenerateImageTask({
      defaults: {
        prompt: "A red apple on a wooden table, photorealistic",
        model: {
          model_id: "black-forest-labs/FLUX.1-schnell",
          provider: "HF_INFERENCE",
          title: "",
          description: "",
          tasks: ["GenerateImageTask"],
          provider_config: { model_name: "black-forest-labs/FLUX.1-schnell" },
          metadata: {},
        } as any,
        aspectRatio: "1:1",
        seed: 42,
      },
    }).run();
    expect(result.image.width).toBeGreaterThan(0);
    expect(result.image.height).toBeGreaterThan(0);
    result.image.release();
  }, 120_000);

  it("edits an image with FLUX.1-Kontext-dev (inpaint-capable)", async () => {
    const base = await new GenerateImageTask({
      defaults: {
        prompt: "A blue sphere on a white background",
        model: {
          model_id: "black-forest-labs/FLUX.1-schnell",
          provider: "HF_INFERENCE",
          title: "",
          description: "",
          tasks: ["GenerateImageTask"],
          provider_config: { model_name: "black-forest-labs/FLUX.1-schnell" },
          metadata: {},
        } as any,
        aspectRatio: "1:1",
        seed: 42,
      },
    }).run();
    const edited = await new EditImageTask({
      defaults: {
        prompt: "Make the sphere green",
        image: base.image,
        model: {
          model_id: "black-forest-labs/FLUX.1-Kontext-dev",
          provider: "HF_INFERENCE",
          title: "",
          description: "",
          tasks: ["EditImageTask"],
          provider_config: { model_name: "black-forest-labs/FLUX.1-Kontext-dev" },
          metadata: {},
        } as any,
        aspectRatio: "1:1",
      },
    }).run();
    expect(edited.image.width).toBeGreaterThan(0);
    base.image.release();
    edited.image.release();
  }, 180_000);
});
