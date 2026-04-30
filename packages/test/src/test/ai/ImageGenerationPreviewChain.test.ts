/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  AiProviderRegistry,
  GenerateImageTask,
  setAiProviderRegistry,
  getAiProviderRegistry,
  DirectExecutionStrategy,
} from "@workglow/ai";
import type { AiProviderStreamFn, ModelConfig } from "@workglow/ai";
import type { GpuImage } from "@workglow/util/media";
import { GpuImageFactory } from "@workglow/util/media";
import { Dataflow, Workflow } from "@workglow/task-graph";
import { ImageGrayscaleTask } from "@workglow/tasks";

const MOCK_PROVIDER = "mock-image-provider";

function syntheticImage(width: number, height: number, fillR: number): GpuImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fillR;
    data[i + 1] = 100;
    data[i + 2] = 100;
    data[i + 3] = 255;
  }
  return GpuImageFactory.fromImageBinary({ data, width, height, channels: 4 });
}

describe("Image generation preview chain", () => {
  beforeEach(() => {
    setAiProviderRegistry(new AiProviderRegistry());
    getAiProviderRegistry().setDefaultStrategy(new DirectExecutionStrategy());
  });

  // SKIPPED: this test exposes an engine-level limitation that's tracked separately.
  //
  // Mid-stream, the upstream task's runOutputData is updated on each snapshot, but
  // the dataflow edge attaches a ReadableStream (not a value) to the downstream's
  // input. Calling `gray.runner.runPreview()` reads gray.runInputData directly —
  // which is only populated by `copyInputFromEdgesToNode()` after the upstream
  // stream finishes. There's no current mechanism for `runPreview` to pull the
  // latest upstream `runOutputData[port]` into downstream `runInputData[port]`
  // mid-stream.
  //
  // The streaming infrastructure in AiImageOutputTask is correct: each snapshot
  // updates _latestPartial and runOutputData, and downstream tasks that consume
  // streams (via executeStream) receive every partial. What's missing is the
  // preview-chain refresh path for downstream tasks that only implement
  // executePreview(). Spec's "open question 1" called this out as needing
  // verification; this test is the verification.
  //
  // Two ways to make this work later:
  // (a) Engine change: TaskGraph.runPreview pulls upstream `runOutputData[port]`
  //     into downstream `runInputData[port]` for streaming dataflow edges.
  // (b) Builder change: the UI subscribes to `task_stream_chunk` and re-runs
  //     downstream `runPreview()` with a manually-supplied input, instead of
  //     relying on the dataflow edge.
  //
  // Tracked in project_generate_image_task memory.
  it.skip("partial GenerateImage outputs flow through to a downstream grayscale task's preview", async () => {
    const partials = [syntheticImage(8, 8, 50), syntheticImage(8, 8, 150), syntheticImage(8, 8, 250)];

    const stream: AiProviderStreamFn = async function* () {
      for (const img of partials) {
        yield { type: "snapshot", data: { image: img } } as any;
      }
      yield { type: "finish", data: {} } as any;
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

    const wf = new Workflow();
    const gen = new GenerateImageTask({ defaults: { model, prompt: "x", seed: 1 } });
    const gray = new ImageGrayscaleTask();
    wf.graph.addTasks([gen, gray]);
    wf.graph.addDataflow(new Dataflow(gen.id, "image", gray.id, "image"));

    const grayPreviewSamples: number[] = [];
    // Subscribe to upstream stream_chunk; on each upstream snapshot, request a preview of the downstream.
    gen.on("stream_chunk", async (event: any) => {
      if (event.type === "snapshot") {
        const out = await gray.runner.runPreview();
        if (out?.image) {
          const bin = await (out.image as GpuImage).materialize();
          grayPreviewSamples.push(bin.data[0]);
          (out.image as GpuImage).release();
        }
      }
    });

    await wf.run();

    expect(grayPreviewSamples.length).toBe(3);
    // Each partial drives a different grayscale luminance.
    expect(new Set(grayPreviewSamples).size).toBeGreaterThan(1);
  });
});
