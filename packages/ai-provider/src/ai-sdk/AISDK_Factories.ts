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
import type { ModelConfig } from "@workglow/ai";
import { getModelInstanceFactory, type ImageModelV3GenerateResult } from "@workglow/ai";
import type { AiSdkProviderId } from "./AISDK_Constants";
import { AI_SDK_PROVIDER_IDS } from "./AISDK_Constants";
import type { AiSdkModelConfig } from "./AISDK_ModelSchema";

// ── Provider types ────────────────────────────────────────────────────────────

/** Model factory methods exposed by AI SDK provider instances. */
interface AiSdkProviderInstance {
  languageModel?(modelId: string): LanguageModelV3;
  embeddingModel?(modelId: string): EmbeddingModelV3;
  imageModel?(modelId: string): ImageModelV3;
}

/**
 * Some AI SDK providers are callable: `provider(modelId)` as a
 * shorthand for `provider.languageModel(modelId)`.
 */
type AiSdkCallableProvider = ((modelId: string) => LanguageModelV3) & AiSdkProviderInstance;

type AiSdkProvider = AiSdkProviderInstance | AiSdkCallableProvider;

// ── Per-provider capability map ───────────────────────────────────────────────

interface ProviderCapabilities {
  languageModel: boolean;
  embeddingModel: boolean;
  imageModel: boolean;
}

const PROVIDER_CAPABILITIES: Record<AiSdkProviderId, ProviderCapabilities> = {
  openai: { languageModel: true, embeddingModel: true, imageModel: true },
  anthropic: { languageModel: true, embeddingModel: false, imageModel: false },
  google: { languageModel: true, embeddingModel: true, imageModel: true },
  ollama: { languageModel: true, embeddingModel: true, imageModel: false },
};

// ── Provider loading ──────────────────────────────────────────────────────────

const providerCache = new Map<string, AiSdkProvider>();

function hashForCacheKey(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}

async function loadProvider(config: AiSdkModelConfig): Promise<AiSdkProvider> {
  const providerId = config.provider as AiSdkProviderId;
  const keyHash = config.provider_config?.api_key
    ? hashForCacheKey(config.provider_config.api_key)
    : "";
  const cacheKey = `${providerId}:${keyHash}:${config.provider_config?.base_url ?? ""}`;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;

  let provider: AiSdkProvider;
  switch (providerId) {
    case "openai": {
      const mod = await import("@ai-sdk/openai");
      const createFn = mod.createOpenAI || mod.openai || mod.default;
      provider = createFn({
        apiKey: config.provider_config?.api_key,
        baseURL: config.provider_config?.base_url,
      }) as AiSdkProvider;
      break;
    }
    case "anthropic": {
      const mod = await import("@ai-sdk/anthropic");
      const createFn = mod.createAnthropic || mod.anthropic || mod.default;
      provider = createFn({
        apiKey: config.provider_config?.api_key,
      }) as AiSdkProvider;
      break;
    }
    case "google": {
      const mod = await import("@ai-sdk/google");
      const createFn = mod.createGoogleGenerativeAI || mod.google || mod.default;
      provider = createFn({
        apiKey: config.provider_config?.api_key,
      }) as AiSdkProvider;
      break;
    }
    case "ollama": {
      const mod = await import("ai-sdk-ollama");
      const createFn = mod.createOllama || mod.ollama;
      const result =
        typeof createFn === "function"
          ? createFn({
              apiKey: config.provider_config?.api_key,
              baseURL: config.provider_config?.base_url,
            })
          : createFn;
      provider = result as AiSdkProvider;
      break;
    }
    default:
      throw new Error(`Unsupported AI SDK provider: ${providerId}`);
  }

  providerCache.set(cacheKey, provider);
  return provider;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveModelId(config: AiSdkModelConfig): string {
  return config.provider_config?.model_id || config.model_id || "";
}

// ── Model classes ─────────────────────────────────────────────────────────────

class AiSdkLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3";
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  constructor(private readonly config: AiSdkModelConfig) {
    this.provider = config.provider;
    this.modelId = resolveModelId(config);
  }

  private async getDelegate(): Promise<LanguageModelV3> {
    const provider = await loadProvider(this.config);
    if (typeof provider === "function") {
      return provider(this.modelId);
    }
    if (provider.languageModel) {
      return provider.languageModel(this.modelId);
    }
    throw new Error(`Provider ${this.provider} does not expose languageModel()`);
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const delegate = await this.getDelegate();
    return await delegate.doGenerate(options);
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const delegate = await this.getDelegate();
    return await delegate.doStream(options);
  }
}

class AiSdkEmbeddingModel implements EmbeddingModelV3 {
  readonly specificationVersion = "v3";
  readonly provider: string;
  readonly modelId: string;
  readonly maxEmbeddingsPerCall = undefined;
  readonly supportsParallelCalls = true;

  constructor(private readonly config: AiSdkModelConfig) {
    this.provider = config.provider;
    this.modelId = resolveModelId(config);
  }

  private async getDelegate(): Promise<EmbeddingModelV3> {
    const provider = await loadProvider(this.config);
    if (provider.embeddingModel) {
      return provider.embeddingModel(this.modelId);
    }
    throw new Error(`Provider ${this.provider} does not expose embeddingModel()`);
  }

  async doEmbed(options: EmbeddingModelV3CallOptions): Promise<EmbeddingModelV3Result> {
    const delegate = await this.getDelegate();
    return await delegate.doEmbed(options);
  }
}

class AiSdkImageModel implements ImageModelV3 {
  readonly specificationVersion = "v3";
  readonly provider: string;
  readonly modelId: string;
  readonly maxImagesPerCall = undefined;

  constructor(private readonly config: AiSdkModelConfig) {
    this.provider = config.provider;
    this.modelId = resolveModelId(config);
  }

  private async getDelegate(): Promise<ImageModelV3> {
    const provider = await loadProvider(this.config);
    if (provider.imageModel) {
      return provider.imageModel(this.modelId);
    }
    throw new Error(`Provider ${this.provider} does not expose imageModel()`);
  }

  async doGenerate(options: ImageModelV3CallOptions): Promise<ImageModelV3GenerateResult> {
    const delegate = await this.getDelegate();
    return await delegate.doGenerate(options);
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

export { PROVIDER_CAPABILITIES };

export function registerCloudProviderFactories(): void {
  const factory = getModelInstanceFactory();
  for (const provider of AI_SDK_PROVIDER_IDS) {
    const caps = PROVIDER_CAPABILITIES[provider];
    if (caps.languageModel) {
      factory.registerLanguageModel(
        provider,
        (config: ModelConfig) => new AiSdkLanguageModel(config as AiSdkModelConfig)
      );
    }
    if (caps.embeddingModel) {
      factory.registerEmbeddingModel(
        provider,
        (config: ModelConfig) => new AiSdkEmbeddingModel(config as AiSdkModelConfig)
      );
    }
    if (caps.imageModel) {
      factory.registerImageModel(
        provider,
        (config: ModelConfig) => new AiSdkImageModel(config as AiSdkModelConfig)
      );
    }
  }
}
