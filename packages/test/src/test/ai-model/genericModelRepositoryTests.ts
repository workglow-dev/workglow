/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getGlobalModelRepository, ModelRepository, setGlobalModelRepository } from "@workglow/ai";
import { beforeEach, expect, it } from "vitest";

const HF_TRANSFORMERS_ONNX = "HF_TRANSFORMERS_ONNX";

export const runGenericModelRepositoryTests = (
  createRepository: () => Promise<ModelRepository>
) => {
  let repository: ModelRepository;

  beforeEach(async () => {
    repository = await createRepository();
    await (repository as any).setupDatabase?.();
    setGlobalModelRepository(repository);
  });

  it("store and find model by name", async () => {
    await getGlobalModelRepository().addModel({
      model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      title: "LaMini-Flan-T5-783M",
      description: "LaMini-Flan-T5-783M",
      tasks: ["TextGenerationTask", "TextRewriterTask"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "text2text-generation",
        model_path: "Xenova/LaMini-Flan-T5-783M",
        dtype: "q8",
      },
      metadata: {},
    });

    const model = await getGlobalModelRepository().findByName("onnx:Xenova/LaMini-Flan-T5-783M:q8");
    expect(model).toBeDefined();
    expect(model?.model_id).toEqual("onnx:Xenova/LaMini-Flan-T5-783M:q8");

    const nonExistentModel = await getGlobalModelRepository().findByName("onnx:Xenova/no-exist");
    expect(nonExistentModel).toBeUndefined();
  });

  it("store and find tasks by model", async () => {
    await getGlobalModelRepository().addModel({
      model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      title: "LaMini-Flan-T5-783M",
      description: "LaMini-Flan-T5-783M",
      tasks: ["TextGenerationTask", "TextRewriterTask"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "text2text-generation",
        model_path: "Xenova/LaMini-Flan-T5-783M",
        dtype: "q8",
      },
      metadata: {},
    });
    const tasks = await getGlobalModelRepository().findTasksByModel(
      "onnx:Xenova/LaMini-Flan-T5-783M:q8"
    );
    expect(tasks).toBeDefined();
    expect(tasks?.length).toEqual(2);
  });
  it("store and find model by task", async () => {
    const repo = getGlobalModelRepository();

    // Add the model and wait for it to complete
    await repo.addModel({
      model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      title: "LaMini-Flan-T5-783M",
      description: "LaMini-Flan-T5-783M",
      tasks: ["TextGenerationTask", "TextRewriterTask"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "text2text-generation",
        model_path: "Xenova/LaMini-Flan-T5-783M",
        dtype: "q8",
      },
      metadata: {},
    });

    // Search for models by task
    const models = await repo.findModelsByTask("TextGenerationTask");
    expect(models).toBeDefined();
    expect(models?.length).toEqual(1);
    expect(models?.[0].model_id).toEqual("onnx:Xenova/LaMini-Flan-T5-783M:q8");
    expect(models?.[0].tasks).toEqual(["TextGenerationTask", "TextRewriterTask"]);
    expect(models?.[0].provider).toEqual(HF_TRANSFORMERS_ONNX);
    expect(models?.[0].provider_config?.pipeline).toEqual("text2text-generation");
    expect(models?.[0].provider_config?.model_path).toEqual("Xenova/LaMini-Flan-T5-783M");
    expect(models?.[0].provider_config?.dtype).toEqual("q8");
  });
};
