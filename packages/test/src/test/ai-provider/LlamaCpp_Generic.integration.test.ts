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
import { LOCAL_LLAMACPP, type LlamaCppModelRecord } from "@workglow/ai-provider/llamacpp";
import {
  disposeLlamaCppResources,
  registerLlamaCppInline,
} from "@workglow/ai-provider/llamacpp/runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericAiProviderTests } from "./genericAiProviderTests";

const RUN = true;

const LLM_MODEL_ID = "llamacpp:SmolLM2-135M-Instruct:Q4_K_M";
const TOOL_MODEL_ID = "llamacpp:unsloth/functiongemma-270m-it-GGUF:Q8_0";

const llmModel: LlamaCppModelRecord = {
  model_id: LLM_MODEL_ID,
  title: "SmolLM2 135M Instruct",
  description: "A 135M parameter instruction-following model, quantized Q4_K_M (~85 MB)",
  tasks: ["DownloadModelTask", "TextGenerationTask", "TextRewriterTask", "TextSummaryTask"],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "./models/SmolLM2-135M-Instruct-Q4_K_M.gguf",
    model_url: "hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q4_K_M",
    models_dir: "./models",
    context_size: 512,
    flash_attention: false,
  },
  metadata: {},
};

const toolModel: LlamaCppModelRecord = {
  model_id: TOOL_MODEL_ID,
  title: "FunctionGemma 270M Instruct",
  description:
    "A 270M parameter instruction-following model with tool calling support, quantized Q8_0",
  tasks: [
    "DownloadModelTask",
    "TextGenerationTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "StructuredGenerationTask",
  ],
  provider: LOCAL_LLAMACPP,
  provider_config: {
    model_path: "./models/hf_unslothfunctiongemma-270m-it-GGUF.Q8_0.gguf",
    model_url: "hf:unsloth/functiongemma-270m-it-GGUF:Q8_0",
    models_dir: "./models",
    context_size: 2048,
    flash_attention: false,
    seed: 42,
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
    await registerLlamaCppInline();

    await getGlobalModelRepository().addModel(llmModel);
    await getGlobalModelRepository().addModel(toolModel);

    for (const modelId of [LLM_MODEL_ID, TOOL_MODEL_ID]) {
      const download = new DownloadModelTask({ model: modelId });
      download.on("progress", (progress, _message, details) => {
        logger.info(
          `Download ${modelId}: ${progress}% | ${details?.file || "?"} @ ${(details?.progress || 0).toFixed(1)}%`
        );
      });
      await download.run();
    }
  },
  teardown: async () => {
    await disposeLlamaCppResources();
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  },
  textGenerationModel: LLM_MODEL_ID,
  structuredGenerationModel: TOOL_MODEL_ID,
  maxTokens: 200,
  timeout: 10 * 60 * 1000, // 10 min: download (~85 MB) + inference
});
