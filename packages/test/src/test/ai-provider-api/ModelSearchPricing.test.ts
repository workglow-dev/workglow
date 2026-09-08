/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Anthropic_ModelSearch_Stream, getAnthropicModelPricing } from "@workglow/anthropic/ai";
import { DeepSeek_ModelSearch_Stream, getDeepSeekModelPricing } from "@workglow/deepseek/ai";
import { Gemini_ModelSearch_Stream, getGeminiModelPricing } from "@workglow/google-gemini/ai";
import { OpenAI_ModelSearch_Stream, getOpenAiModelPricing } from "@workglow/openai/ai";
import { Xai_ModelSearch_Stream, getXaiModelPricing } from "@workglow/xai/ai";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

/**
 * `model add` / `model find` persist the record a search result carries, and a
 * persisted rate card is never revisited. A card copied out of the provider's
 * table at search time therefore freezes those rates into the repository: the
 * table is the maintained source and correcting a rate there would no longer
 * reach the model, with nothing on screen to say the figure is old.
 *
 * So a search result describes the model and leaves `pricing` unset. The rate
 * is resolved from the provider's table when a cost is estimated, and a card
 * that IS on a record means someone declared it deliberately.
 */
async function searchRecords(
  fn: (input: any, model: any, signal: any, emit: any) => Promise<void>
): Promise<any[]> {
  const events: any[] = [];
  await fn({ query: "" } as any, undefined as any, undefined as any, (e: any) => events.push(e));
  const results = events.at(-1)!.data.results as any[];
  expect(results.length).toBeGreaterThan(0);
  return results;
}

describe("cloud model search results", () => {
  it("leaves pricing unset on Anthropic records while the table still prices them", async () => {
    const results = await searchRecords(Anthropic_ModelSearch_Stream);
    for (const result of results) {
      expect(result.record.pricing).toBeUndefined();
      expect(getAnthropicModelPricing(result.id)).toBeDefined();
    }
  });

  it("leaves pricing unset on OpenAI records while the table still prices them", async () => {
    const results = await searchRecords(OpenAI_ModelSearch_Stream);
    for (const result of results) {
      expect(result.record.pricing).toBeUndefined();
    }
    expect(results.some((result) => getOpenAiModelPricing(result.id) !== undefined)).toBe(true);
  });

  it("leaves pricing unset on DeepSeek records while the table still prices them", async () => {
    const results = await searchRecords(DeepSeek_ModelSearch_Stream);
    for (const result of results) {
      expect(result.record.pricing).toBeUndefined();
    }
    expect(results.some((result) => getDeepSeekModelPricing(result.id) !== undefined)).toBe(true);
  });

  it("leaves pricing unset on xAI records while the table still prices them", async () => {
    const results = await searchRecords(Xai_ModelSearch_Stream);
    for (const result of results) {
      expect(result.record.pricing).toBeUndefined();
    }
    expect(results.some((result) => getXaiModelPricing(result.id) !== undefined)).toBe(true);
  });

  // Gemini maps the live /models listing through a different function than its
  // credential-free fallback list, and only the live one ever carried a card —
  // so the listing is what this has to exercise.
  it("leaves pricing unset on Gemini records from the live listing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }],
        }),
        { status: 200 }
      )
    );
    const events: any[] = [];
    await Gemini_ModelSearch_Stream(
      { query: "", credential_key: "test-key" } as any,
      undefined as any,
      undefined as any,
      (e: any) => events.push(e)
    );
    const results = events.at(-1)!.data.results as any[];
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("gemini-2.5-pro");
    expect(results[0].record.pricing).toBeUndefined();
    expect(getGeminiModelPricing("gemini-2.5-pro")).toBeDefined();
  });
});

/**
 * Capabilities whose models are not billed per token.
 *
 * A card of per-1M-token rates on one of these is not an approximation, it is a
 * fabricated unit: image generation bills per image. `undefined` is the correct
 * answer for a model a token table cannot price — a sibling's card is not.
 */
const NOT_TOKEN_BILLED = new Set(["image.generation", "audio.speech", "audio.transcription"]);

const PRICED_PROVIDERS = [
  { name: "Anthropic", search: Anthropic_ModelSearch_Stream, resolve: getAnthropicModelPricing },
  { name: "OpenAI", search: OpenAI_ModelSearch_Stream, resolve: getOpenAiModelPricing },
  { name: "DeepSeek", search: DeepSeek_ModelSearch_Stream, resolve: getDeepSeekModelPricing },
  { name: "xAI", search: Xai_ModelSearch_Stream, resolve: getXaiModelPricing },
] as const;

/**
 * The honesty axis the pricing primitive shipped without.
 *
 * Refusal, cache checkpoints and effort each needed a conformance assertion and
 * each got one only after a defect. This one is driven off the provider's own
 * catalogue, so the fixture cannot drift from what the provider reports.
 */
describe("a rate card must match the model's billing unit", () => {
  it.each(PRICED_PROVIDERS)(
    "$name prices no model its own catalogue calls non-token-billed",
    async ({ search, resolve }) => {
      const results = await searchRecords(search);
      const offenders = results
        .filter((result) =>
          ((result.record?.capabilities ?? []) as string[]).some((c) => NOT_TOKEN_BILLED.has(c))
        )
        .filter((result) => resolve(result.id) !== undefined)
        .map((result) => `${result.id} (${(result.record.capabilities as string[]).join(", ")})`);
      expect(offenders).toEqual([]);
    }
  );

  it("is not vacuous: some catalogue really does report a non-token-billed model", async () => {
    // Without this the loop above passes just as well over four catalogues that
    // contain nothing it could ever flag.
    const seen: string[] = [];
    for (const { search } of PRICED_PROVIDERS) {
      for (const result of await searchRecords(search)) {
        const capabilities = (result.record?.capabilities ?? []) as string[];
        if (capabilities.some((c) => NOT_TOKEN_BILLED.has(c))) seen.push(result.id);
      }
    }
    expect(seen).toContain("grok-2-image-1212");
  });

  it("Gemini prices the image models it names and refuses the ones it does not", () => {
    // Gemini's table carries explicit image entries, so the guard must not
    // override them — only stop an unnamed image id taking a text sibling's card.
    expect(getGeminiModelPricing("gemini-3-pro-image")).toBeDefined();
    expect(getGeminiModelPricing("gemini-3.1-flash-image")).toBeDefined();
    expect(getGeminiModelPricing("imagen-4.0-generate-001")).toBeDefined();
    expect(getGeminiModelPricing("gemini-2.5-flash-image-preview")).toBeUndefined();
    expect(getGeminiModelPricing("gemini-2.5-flash")).toBeDefined();
  });
});
