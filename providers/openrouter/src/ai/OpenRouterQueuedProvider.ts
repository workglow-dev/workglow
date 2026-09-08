/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Capability,
  ModelConfig,
  ModelEffortPolicy,
  ModelPricing,
  ModelRecord,
} from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import { createCloudProviderClass } from "@workglow/ai/provider-utils";
import {
  inferOpenRouterCapabilities,
  openRouterWorkerRunFnSpecs,
} from "./common/OpenRouter_Capabilities";
import { OPENROUTER } from "./common/OpenRouter_Constants";
import { openrouterEffortPolicy } from "./common/OpenRouter_EffortPolicy";
import type { OpenRouterModelConfig } from "./common/OpenRouter_ModelSchema";

/** Main-thread registration shell for OpenRouter (inline + worker-proxy). */
export class OpenRouterQueuedProvider extends createCloudProviderClass<OpenRouterModelConfig>(
  AiProvider,
  { name: OPENROUTER, displayName: "OpenRouter" }
) {
  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferOpenRouterCapabilities(model);
  }

  override effortPolicy(model: OpenRouterModelConfig): ModelEffortPolicy | undefined {
    return openrouterEffortPolicy(model);
  }

  /**
   * The rate OpenRouter itself quoted for this model, from the record the
   * search already populated.
   *
   * More honest than a table could be: OpenRouter routes to whichever upstream
   * is cheapest or available, so per-token pricing is not something a caller can
   * reconstruct locally — and without an answer here the resolver falls through
   * to the direct-vendor tables, where `openai/gpt-4o` matches OpenAI's own card
   * and reports a rate this route was never billed at.
   *
   * The API quotes USD per token as strings. `"0"` is a real answer (free
   * models) and falsy, so the check is on the parse, not the value; `"-1"` means
   * the rate varies by upstream, which is unpriced rather than negative.
   */
  override modelPricing(model?: ModelConfig): ModelPricing | undefined {
    if (model && model.provider !== this.name) return undefined;
    const raw = (model as { metadata?: { pricing?: unknown } } | undefined)?.metadata?.pricing;
    if (raw === null || typeof raw !== "object") return undefined;
    const quoted = raw as Record<string, unknown>;
    const perMillion = (value: unknown): number | undefined => {
      if (typeof value !== "string" && typeof value !== "number") return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) return undefined;
      return parsed * 1e6;
    };
    const input = perMillion(quoted.prompt);
    if (input === undefined) return undefined;
    return {
      currency: "USD",
      input,
      output: perMillion(quoted.completion) ?? 0,
      cached: perMillion(quoted.input_cache_read),
    };
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return openRouterWorkerRunFnSpecs();
  }
}
