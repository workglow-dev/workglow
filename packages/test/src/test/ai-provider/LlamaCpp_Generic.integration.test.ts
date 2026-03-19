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
import { LOCAL_LLAMACPP, type LlamaCppModelRecord } from "@workglow/ai-provider";
import {
  disposeLlamaCppResources,
  LLAMACPP_REACTIVE_TASKS,
  LLAMACPP_STREAM_TASKS,
  LLAMACPP_TASKS,
  LlamaCppProvider,
} from "@workglow/ai-provider/llamacpp";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericAiProviderTests } from "./genericAiProviderTests";

const RUN = true;

const MODEL_ID = "llamacpp:Qwen2.5-1.5B-Instruct:Q4_K_M";

const model: LlamaCppModelRecord = {
  model_id: MODEL_ID,
  title: "Qwen2.5 1.5B Instruct",
  description:
    "A 1.5B parameter instruction-following model with tool calling support, quantized Q4_K_M",
  tasks: [
    "DownloadModelTask",
    "TextGenerationTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "ToolCallingTask",
    "StructuredGenerationTask",
  ],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "./models/hf_bartowski_Qwen2.5-1.5B-Instruct.Q4_K_M.gguf",
    model_url: "hf:bartowski/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M",
    models_dir: "./models",
    context_size: 2048,
    flash_attention: true,
  },
  metadata: {},
};

runGenericAiProviderTests({
  name: "LlamaCpp (node-llama-cpp)",
  skip: !RUN,
  setup: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await new LlamaCppProvider(
      LLAMACPP_TASKS,
      LLAMACPP_STREAM_TASKS,
      LLAMACPP_REACTIVE_TASKS
    ).register({ mode: "inline" });

    await getGlobalModelRepository().addModel(model);

    // Download the model
    const download = new DownloadModelTask({ model: MODEL_ID });
    download.on("progress", (progress, _message, details) => {
      logger.info(
        `Download ${MODEL_ID}: ${progress}% | ${details?.file || "?"} @ ${(details?.progress || 0).toFixed(1)}%`
      );
    });
    await download.run();
  },
  teardown: async () => {
    await disposeLlamaCppResources();
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  },
  textGenerationModel: MODEL_ID,
  toolCallingModel: MODEL_ID,
  structuredGenerationModel: MODEL_ID,
  maxTokens: 200,
  timeout: 10 * 60 * 1000, // 10 min: download (~85 MB) + inference
});
