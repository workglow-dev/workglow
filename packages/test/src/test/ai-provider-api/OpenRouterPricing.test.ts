/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/openrouter/ai";
import { describe, expect, it } from "vitest";

const provider = new _testOnly.OpenRouterQueuedProvider();

function priceOf(pricing: unknown): unknown {
  return provider.modelPricing({
    model_id: "openai/gpt-4o",
    provider: "OPENROUTER",
    provider_config: { model_name: "openai/gpt-4o" },
    metadata: pricing === undefined ? {} : { pricing },
  } as never);
}

/**
 * OpenRouter routes to whichever upstream is cheapest or available, so a
 * per-token rate is not something a caller can reconstruct locally. It quotes
 * one per model, and the search already stored it — this reads that rather than
 * leaving the model unpriced for a vendor table to guess at.
 */
describe("OpenRouter prices from the rate it quoted", () => {
  it("converts the API's per-token strings to the per-1M convention", () => {
    expect(
      priceOf({ prompt: "0.0000025", completion: "0.00001", input_cache_read: "0.00000125" })
    ).toEqual({ currency: "USD", input: 2.5, output: 10, cached: 1.25 });
  });

  it("treats a free model as free, not as unpriced", () => {
    // `"0"` is a real quote and it is falsy, so the check has to be on the
    // parse rather than on the value.
    expect(priceOf({ prompt: "0", completion: "0" })).toEqual({
      currency: "USD",
      input: 0,
      output: 0,
      cached: undefined,
    });
  });

  it("reports no card when the rate varies by upstream", () => {
    // OpenRouter writes `-1` for "varies", which is finite and would otherwise
    // become a negative rate.
    expect(priceOf({ prompt: "-1", completion: "-1" })).toBeUndefined();
  });

  it("reports no card when the record carries no quote at all", () => {
    expect(priceOf(undefined)).toBeUndefined();
    expect(priceOf(null)).toBeUndefined();
    expect(priceOf("nonsense")).toBeUndefined();
    expect(priceOf({ completion: "0.00001" })).toBeUndefined();
  });

  it("declines a record belonging to another provider", () => {
    expect(
      provider.modelPricing({
        model_id: "claude-sonnet-5",
        provider: "ANTHROPIC",
        provider_config: { model_name: "claude-sonnet-5" },
        metadata: {},
      } as never)
    ).toBeUndefined();
  });
});
