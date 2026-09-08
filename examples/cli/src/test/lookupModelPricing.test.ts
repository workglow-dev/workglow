/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { estimateCost, getAiProviderRegistry, getGlobalModelRepository } from "@workglow/ai";
import { afterEach, describe, expect, it } from "vitest";
import { clearModelPricingCache, lookupModelPricing } from "../ui/rows/lookupModelPricing";

const TEST_MODEL_ID = "test-explicit-pricing-model";
const TABLE_MODEL_ID = "claude-sonnet-5";
// A Gemini Pro card carries the published over-200K rows, so this is the model
// whose provider tiers can contradict a negotiated base rate.
const TIERED_MODEL_ID = "gemini-3.1-pro-preview";
// An OpenRouter route whose id is exactly what OpenAI's table strips a prefix
// from, which is what made the fall-through report a wrong number as a cost.
const ROUTED_MODEL_ID = "openai/gpt-4o";
const QUOTED_MODEL_ID = "anthropic/claude-sonnet-5";

describe("lookupModelPricing", () => {
  // The model repository is a process-wide singleton, so a record added here
  // outlives the file unless it is removed again.
  afterEach(async () => {
    clearModelPricingCache();
    getAiProviderRegistry().unregisterProvider("OPENROUTER");
    // `removeModel` throws when the id is absent, which most cases here are.
    for (const id of [
      TEST_MODEL_ID,
      TABLE_MODEL_ID,
      TIERED_MODEL_ID,
      ROUTED_MODEL_ID,
      QUOTED_MODEL_ID,
    ]) {
      await getGlobalModelRepository()
        .removeModel(id)
        .catch(() => {});
    }
  });

  it("returns undefined for empty or undefined modelId", async () => {
    expect(await lookupModelPricing(undefined)).toBeUndefined();
    expect(await lookupModelPricing("")).toBeUndefined();
  });

  it("returns repository pricing when a model record defines pricing", async () => {
    await getGlobalModelRepository().addModel({
      model_id: TEST_MODEL_ID,
      title: "custom",
      description: "custom pricing",
      provider: "ANTHROPIC",
      capabilities: ["text.generation"],
      provider_config: { model_name: TEST_MODEL_ID },
      metadata: {},
      pricing: {
        currency: "USD",
        input: 99,
        output: 199,
      },
    });

    const pricing = await lookupModelPricing(TEST_MODEL_ID);
    expect(pricing).toEqual({
      currency: "USD",
      input: 99,
      output: 199,
    });
  });

  it("prices a model added from a search result off the provider's current table", async () => {
    // This is the record `model add` / `model find` write: what the search
    // result carried, with no rate card of its own. Nothing persisted can then
    // shadow the table, so a corrected rate reaches a model added months ago.
    await getGlobalModelRepository().addModel({
      model_id: TABLE_MODEL_ID,
      title: TABLE_MODEL_ID,
      description: "",
      provider: "ANTHROPIC",
      capabilities: [],
      provider_config: { model_name: TABLE_MODEL_ID },
      metadata: {},
    });

    const pricing = await lookupModelPricing(TABLE_MODEL_ID);
    expect(pricing?.input).toBe(2);
    expect(pricing?.output).toBe(10);
  });

  it("fills the rates a record leaves unset from the provider's card", async () => {
    // Someone enters one negotiated input rate on a model the provider does
    // price. Everything they did not type must keep its published rate rather
    // than becoming an unpriced counter.
    await getGlobalModelRepository().addModel({
      model_id: TABLE_MODEL_ID,
      title: TABLE_MODEL_ID,
      description: "",
      provider: "ANTHROPIC",
      capabilities: [],
      provider_config: { model_name: TABLE_MODEL_ID },
      metadata: {},
      pricing: { currency: "USD", input: 1.25 },
    });

    const pricing = await lookupModelPricing(TABLE_MODEL_ID);
    expect(pricing?.input).toBe(1.25);
    expect(pricing?.output).toBe(10);
    expect(pricing?.cached).toBe(0.2);
    expect(pricing?.cacheWrite).toEqual({ cacheWrite5m: 2.5, cacheWrite1h: 4 });
    expect(pricing?.batch).toEqual({
      input: 1,
      output: 5,
      cached: 0.1,
      cacheWrite: { cacheWrite5m: 1.25, cacheWrite1h: 2 },
    });
  });

  it("charges a record's own rate for a prompt the provider's tiers would reprice", async () => {
    // The published card doubles `input` past 200K. Inherited whole, that tier
    // would put the list rate back on exactly the long prompts a negotiated
    // rate is entered for; only the rates the record is silent about carry over.
    await getGlobalModelRepository().addModel({
      model_id: TIERED_MODEL_ID,
      title: TIERED_MODEL_ID,
      description: "",
      provider: "GOOGLE_GEMINI",
      capabilities: [],
      provider_config: { model_name: TIERED_MODEL_ID },
      metadata: {},
      pricing: { currency: "USD", input: 1 },
    });

    const pricing = await lookupModelPricing(TIERED_MODEL_ID);
    const cost = estimateCost(
      {
        input: 250_000,
        output: 1_000,
        cached: undefined,
        cacheWrite: undefined,
        reasoning: undefined,
        total: undefined,
        extra: undefined,
      },
      pricing
    );
    // 250_000 × $1/M input, plus the tier's own $18/M output.
    expect(cost?.amount).toBeCloseTo(0.25 + 0.018, 10);
    expect(cost?.unpriced).toEqual([]);
  });

  it("falls back to provider list pricing when unconfigured in the repository", async () => {
    const sonnet = await lookupModelPricing("claude-sonnet-5");
    expect(sonnet).toBeDefined();
    expect(sonnet?.currency).toBe("USD");
    expect(sonnet?.input).toBe(2);
    expect(sonnet?.output).toBe(10);

    const gpt = await lookupModelPricing("gpt-5.5");
    expect(gpt).toBeDefined();
    expect(gpt?.currency).toBe("USD");
    expect(gpt?.input).toBe(5);
    expect(gpt?.output).toBe(30);
  });

  it("does not price an OpenRouter route from the direct vendor's card", async () => {
    // The failure this closes: OpenRouter ids are exactly the shape the vendor
    // tables strip a prefix from, so `openai/gpt-4o` resolved OpenAI's own list
    // rates — for a route OpenRouter bills at whichever upstream it picked, and
    // whose per-token rate the package's own comment says a caller cannot
    // reconstruct locally. A provider that declines is asserting "no card", not
    // referring the question on.
    await getGlobalModelRepository().addModel({
      model_id: ROUTED_MODEL_ID,
      title: "gpt-4o via OpenRouter",
      description: "routed",
      provider: "OPENROUTER",
      capabilities: ["text.generation"],
      provider_config: { model_name: ROUTED_MODEL_ID },
      metadata: {},
    });

    expect(await lookupModelPricing(ROUTED_MODEL_ID)).toBeUndefined();
  });

  it("returns a registered provider's own card for a record naming it", async () => {
    // The other half of the rule: a provider that ANSWERS is answered from,
    // rather than the id's shape. Exercises the registered path, which the
    // unregistered case below reaches `undefined` through a different branch.
    getAiProviderRegistry().registerProvider({
      name: "OPENROUTER",
      modelPricing: () => ({ currency: "USD", input: 2.5, output: 10 }),
    } as never);
    await getGlobalModelRepository().addModel({
      model_id: QUOTED_MODEL_ID,
      title: "quoted route",
      description: "routed",
      provider: "OPENROUTER",
      capabilities: ["text.generation"],
      provider_config: { model_name: QUOTED_MODEL_ID },
      metadata: {},
    });

    expect(await lookupModelPricing(QUOTED_MODEL_ID)).toMatchObject({ input: 2.5, output: 10 });
  });

  it("does not fall through to a vendor table when a registered provider declines", async () => {
    // The assertion the fix is actually about: `openai/gpt-4o` is exactly the
    // shape OpenAI's table strips a prefix from, so before the fix a declining
    // OpenRouter provider handed the question on and got OpenAI's list rates
    // back — reported as a cost for a route billed by someone else.
    getAiProviderRegistry().registerProvider({
      name: "OPENROUTER",
      modelPricing: () => undefined,
    } as never);
    await getGlobalModelRepository().addModel({
      model_id: ROUTED_MODEL_ID,
      title: "gpt-4o via OpenRouter",
      description: "routed",
      provider: "OPENROUTER",
      capabilities: ["text.generation"],
      provider_config: { model_name: ROUTED_MODEL_ID },
      metadata: {},
    });

    expect(await lookupModelPricing(ROUTED_MODEL_ID)).toBeUndefined();
  });
});
