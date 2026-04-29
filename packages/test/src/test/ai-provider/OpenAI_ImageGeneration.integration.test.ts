/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeAll } from "vitest";
import { GenerateImageTask, EditImageTask } from "@workglow/ai";
import { registerOpenAiInline } from "@workglow/ai-provider/openai/runtime";

const RUN = !!process.env.OPENAI_API_KEY;

describe.skipIf(!RUN)("OpenAI image generation (live)", () => {
  beforeAll(async () => {
    await registerOpenAiInline();
  });

  it("generates a 1024x1024 image", async () => {
    const result = await new GenerateImageTask({
      defaults: {
        prompt: "A red apple on a wooden table, photorealistic",
        model: {
          model_id: "gpt-image-2",
          provider: "OPENAI",
          title: "",
          description: "",
          tasks: ["GenerateImageTask"],
          provider_config: { model_name: "gpt-image-2", credential_key: process.env.OPENAI_API_KEY },
          metadata: {},
        } as any,
        aspectRatio: "1:1",
        seed: 42,
      },
    }).run();
    expect(result.image.width).toBeGreaterThan(0);
    expect(result.image.height).toBeGreaterThan(0);
    result.image.release();
  }, 60_000);

  it("edits an image with prompt-only changes", async () => {
    const base = await new GenerateImageTask({
      defaults: {
        prompt: "A blue sphere on a white background",
        model: {
          model_id: "gpt-image-2",
          provider: "OPENAI",
          title: "",
          description: "",
          tasks: ["GenerateImageTask"],
          provider_config: { model_name: "gpt-image-2", credential_key: process.env.OPENAI_API_KEY },
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
          model_id: "gpt-image-2",
          provider: "OPENAI",
          title: "",
          description: "",
          tasks: ["EditImageTask"],
          provider_config: { model_name: "gpt-image-2", credential_key: process.env.OPENAI_API_KEY },
          metadata: {},
        } as any,
        aspectRatio: "1:1",
      },
    }).run();
    expect(edited.image.width).toBeGreaterThan(0);
    base.image.release();
    edited.image.release();
  }, 120_000);
});
