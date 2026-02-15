/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  EmbeddingModelV3,
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Result,
  ImageModelV3,
  ImageModelV3CallOptions,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { globalServiceRegistry, WORKER_MANAGER } from "@workglow/util";
import type { ModelConfig } from "./ModelSchema";

// ── Factory types ─────────────────────────────────────────────────────────────

export type LanguageModelFactory = (config: ModelConfig) => LanguageModelV3;
export type EmbeddingModelFactory = (config: ModelConfig) => EmbeddingModelV3;
export type ImageModelFactory = (config: ModelConfig) => ImageModelV3;

/** Inferred return type of {@link ImageModelV3.doGenerate}. */
export type ImageModelV3GenerateResult = Awaited<ReturnType<ImageModelV3["doGenerate"]>>;

// ── ModelInstanceFactory ──────────────────────────────────────────────────────

export class ModelInstanceFactory {
  private languageModelFactories = new Map<string, LanguageModelFactory>();
  private embeddingModelFactories = new Map<string, EmbeddingModelFactory>();
  private imageModelFactories = new Map<string, ImageModelFactory>();

  registerLanguageModel(provider: string, factory: LanguageModelFactory): void {
    this.languageModelFactories.set(provider, factory);
  }

  registerEmbeddingModel(provider: string, factory: EmbeddingModelFactory): void {
    this.embeddingModelFactories.set(provider, factory);
  }

  registerImageModel(provider: string, factory: ImageModelFactory): void {
    this.imageModelFactories.set(provider, factory);
  }

  hasLanguageModel(provider: string): boolean {
    return this.languageModelFactories.has(provider);
  }

  hasEmbeddingModel(provider: string): boolean {
    return this.embeddingModelFactories.has(provider);
  }

  hasImageModel(provider: string): boolean {
    return this.imageModelFactories.has(provider);
  }

  getLanguageModel(config: ModelConfig): LanguageModelV3 {
    const factory = this.languageModelFactories.get(config.provider);
    if (!factory) {
      throw new Error(`No language model factory found for provider ${config.provider}`);
    }
    return factory(config);
  }

  getEmbeddingModel(config: ModelConfig): EmbeddingModelV3 {
    const factory = this.embeddingModelFactories.get(config.provider);
    if (!factory) {
      throw new Error(`No embedding model factory found for provider ${config.provider}`);
    }
    return factory(config);
  }

  getImageModel(config: ModelConfig): ImageModelV3 {
    const factory = this.imageModelFactories.get(config.provider);
    if (!factory) {
      throw new Error(`No image model factory found for provider ${config.provider}`);
    }
    return factory(config);
  }

  unregisterLanguageModel(provider: string): boolean {
    return this.languageModelFactories.delete(provider);
  }

  unregisterEmbeddingModel(provider: string): boolean {
    return this.embeddingModelFactories.delete(provider);
  }

  unregisterImageModel(provider: string): boolean {
    return this.imageModelFactories.delete(provider);
  }

  clear(): void {
    this.languageModelFactories.clear();
    this.embeddingModelFactories.clear();
    this.imageModelFactories.clear();
  }
}

let modelInstanceFactory: ModelInstanceFactory;
export function getModelInstanceFactory(): ModelInstanceFactory {
  if (!modelInstanceFactory) modelInstanceFactory = new ModelInstanceFactory();
  return modelInstanceFactory;
}

export function setModelInstanceFactory(factory: ModelInstanceFactory): void {
  modelInstanceFactory = factory;
}

// ── Worker proxy classes ──────────────────────────────────────────────────────

export class WorkerLanguageModelProxy implements LanguageModelV3 {
  readonly specificationVersion = "v3";
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  constructor(
    provider: string,
    private readonly modelConfig: ModelConfig
  ) {
    this.provider = provider;
    this.modelId = modelConfig.model_id || modelConfig.provider;
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
    const { abortSignal, ...serializableOptions } = options;
    return await workerManager.callWorkerFunction<LanguageModelV3GenerateResult>(
      this.provider,
      "LanguageModelV3.doGenerate",
      [this.modelConfig, serializableOptions],
      { signal: abortSignal }
    );
  }

  async doStream(_options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    throw new UnsupportedFunctionalityError({
      functionality: `streaming via worker (provider: ${this.provider})`,
    });
  }
}

export class WorkerEmbeddingModelProxy implements EmbeddingModelV3 {
  readonly specificationVersion = "v3";
  readonly provider: string;
  readonly modelId: string;
  readonly maxEmbeddingsPerCall = undefined;
  readonly supportsParallelCalls = false;

  constructor(
    provider: string,
    private readonly modelConfig: ModelConfig
  ) {
    this.provider = provider;
    this.modelId = modelConfig.model_id || modelConfig.provider;
  }

  async doEmbed(options: EmbeddingModelV3CallOptions): Promise<EmbeddingModelV3Result> {
    const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
    const { abortSignal, ...serializableOptions } = options;
    return await workerManager.callWorkerFunction<EmbeddingModelV3Result>(
      this.provider,
      "EmbeddingModelV3.doEmbed",
      [this.modelConfig, serializableOptions],
      { signal: abortSignal }
    );
  }
}

export class WorkerImageModelProxy implements ImageModelV3 {
  readonly specificationVersion = "v3";
  readonly provider: string;
  readonly modelId: string;
  readonly maxImagesPerCall = undefined;

  constructor(
    provider: string,
    private readonly modelConfig: ModelConfig
  ) {
    this.provider = provider;
    this.modelId = modelConfig.model_id || modelConfig.provider;
  }

  async doGenerate(options: ImageModelV3CallOptions): Promise<ImageModelV3GenerateResult> {
    const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
    const { abortSignal, ...serializableOptions } = options;
    return await workerManager.callWorkerFunction<ImageModelV3GenerateResult>(
      this.provider,
      "ImageModelV3.doGenerate",
      [this.modelConfig, serializableOptions],
      { signal: abortSignal }
    );
  }
}
