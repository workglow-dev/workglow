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
  clearPipelineCache,
  HF_TRANSFORMERS_ONNX,
  type HfTransformersOnnxModelRecord,
  registerHuggingFaceTransformersInline,
} from "@workglow/ai-provider/hf-transformers/runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";

import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericAiProviderTests } from "./genericAiProviderTests";

const RUN = true;

const TEXT_MODEL_ID = "onnx:onnx-community/Qwen2.5-1.5B-Instruct:q4";
const TOOL_MODEL_ID = "onnx:onnx-community/functiongemma-270m-it-ONNX:q4f16";

const textModel: HfTransformersOnnxModelRecord = {
  model_id: TEXT_MODEL_ID,
  title: "Qwen2.5-1.5B-Instruct",
  description: "Instruction-tuned model with native tool calling support",
  tasks: ["TextGenerationTask", "StructuredGenerationTask"],
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "onnx-community/Qwen2.5-1.5B-Instruct",
    dtype: "q4",
  },
  metadata: {},
};

const toolModel: HfTransformersOnnxModelRecord = {
  model_id: TOOL_MODEL_ID,
  title: "FunctionGemma 270M IT ONNX",
  description: "Tool-calling-focused ONNX model quantized to q4f16",
  tasks: ["TextGenerationTask", "ToolCallingTask"],
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "onnx-community/functiongemma-270m-it-ONNX",
    dtype: "q4f16",
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
    await registerHuggingFaceTransformersInline();

    await getGlobalModelRepository().addModel(textModel);
    await getGlobalModelRepository().addModel(toolModel);

    for (const modelId of [TEXT_MODEL_ID, TOOL_MODEL_ID]) {
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
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  },
  textGenerationModel: TEXT_MODEL_ID,
  toolCallingModel: TOOL_MODEL_ID,
  // structuredGenerationModel: MODEL_ID, // TODO: Fix this with qwen3.5, right now it works 50/50
  maxTokens: 200,
  timeout: 300000,
});
