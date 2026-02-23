/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DownloadModelTask,
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "@workglow/ai";
import {
  HF_TRANSFORMERS_ONNX,
  type HfTransformersOnnxModelRecord,
  HuggingFaceTransformersProvider,
} from "@workglow/ai-provider";
import { clearPipelineCache, HFT_TASKS } from "@workglow/ai-provider/hf-transformers";
import { getTaskQueueRegistry, setTaskQueueRegistry, TaskStatus } from "@workglow/task-graph";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("DownloadModelTask abort behavior", () => {
  beforeAll(async () => {
    setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    clearPipelineCache();
    await new HuggingFaceTransformersProvider(HFT_TASKS).register({ mode: "inline" });
  });

  afterAll(async () => {
    getTaskQueueRegistry().stopQueues().clearQueues();
    setTaskQueueRegistry(null);
  });

  it("should abort download when task is aborted", async () => {
    // Register a model
    const model: HfTransformersOnnxModelRecord = {
      model_id: "onnx:Supabase/gte-small:q8",
      title: "gte-small",
      description: "Supabase/gte-small quantized to 8bit",
      tasks: ["TextEmbeddingTask"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "feature-extraction",
        model_path: "Supabase/gte-small",
        dtype: "q8",
        native_dimensions: 384,
      },
      metadata: {},
    };

    await getGlobalModelRepository().addModel(model);

    const download = new DownloadModelTask({
      model: "onnx:Supabase/gte-small:q8",
    });

    let progressCount = 0;
    let progressAfterAbort = 0;
    let abortCalled = false;
    let firstProgressSeen = false;

    download.on("progress", () => {
      if (!firstProgressSeen) {
        firstProgressSeen = true;
        // Abort as soon as we see the first progress event
        // This ensures we're aborting during an active download
        setTimeout(() => {
          abortCalled = true;
          download.abort();
        }, 10);
      }
      progressCount++;
      if (abortCalled) {
        progressAfterAbort++;
      }
    });

    // Start the download
    const downloadPromise = download.run();

    // The download should throw an error due to abort
    try {
      await downloadPromise;
      // If we get here, check if it was because the download was too fast
      // (model already cached or very small)
      if (!firstProgressSeen || progressCount < 5) {
        console.log("Note: Download completed too quickly to abort (likely cached)");
        expect(download.status).toBe(TaskStatus.COMPLETED);
      } else {
        // If we saw significant progress but still completed, that's unexpected
        expect.fail("Download should have been aborted after seeing progress events");
      }
    } catch (error: any) {
      // Expected to throw - verify the task is in aborting or error state
      expect([TaskStatus.ABORTING, TaskStatus.FAILED]).toContain(download.status);

      // The error should indicate abort (could be from our code or from the library)
      const errorMessage = error?.message?.toLowerCase() || "";
      const isAbortError =
        errorMessage.includes("abort") ||
        errorMessage.includes("closed") ||
        error?.code === "ERR_INVALID_STATE";

      expect(isAbortError).toBe(true);

      // Give it a moment to settle any in-flight operations
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Progress events after abort should be minimal (maybe a few in-flight ones)
      // If progressAfterAbort is high (e.g., > 20), it means the download continued
      console.log(`Total progress events: ${progressCount}`);
      console.log(`Progress before abort: ${progressCount - progressAfterAbort}`);
      console.log(`Progress after abort: ${progressAfterAbort}`);

      // This is the key assertion - if progress continued significantly after abort,
      // it means the underlying downloads weren't stopped
      // Allow for some in-flight events (up to 20), but not minutes of continued downloading
      expect(progressAfterAbort).toBeLessThan(20);
    }
  }, 30000);
});
