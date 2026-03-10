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
import {
  clearPipelineCache,
  HFT_REACTIVE_TASKS,
  HFT_STREAM_TASKS,
  HFT_TASKS,
} from "@workglow/ai-provider/hf-transformers";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericAiProviderTests } from "./genericAiProviderTests";

const RUN = true;

const MODEL_ID = "onnx:onnx-community/Qwen2.5-1.5B-Instruct:q4";

const model: HfTransformersOnnxModelRecord = {
  model_id: MODEL_ID,
  title: "Qwen2.5-1.5B-Instruct",
  description: "Instruction-tuned model with native tool calling support",
  tasks: ["TextGenerationTask", "ToolCallingTask", "StructuredGenerationTask"],
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "onnx-community/Qwen2.5-1.5B-Instruct",
    dtype: "q4",
  },
  metadata: {},
};

runGenericAiProviderTests({
  name: "HFT (HuggingFace Transformers)",
  skip: !RUN,
  setup: async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    clearPipelineCache();
    await new HuggingFaceTransformersProvider(
      HFT_TASKS,
      HFT_STREAM_TASKS,
      HFT_REACTIVE_TASKS
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
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  },
  textGenerationModel: MODEL_ID,
  toolCallingModel: MODEL_ID,
  // structuredGenerationModel: MODEL_ID, // TODO: Fix this with qwen3.5, right now it works 50/50
  maxTokens: 200,
  timeout: 120000,
});
