/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type StructuredGenerationTaskOutput } from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";
import type { JsonSchema } from "@workglow/util/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ========================================================================
// Setup interface
// ========================================================================

export interface AiProviderTestSetup {
  /** Human-readable name for describe blocks */
  readonly name: string;
  /** Whether to skip (e.g., missing env var) */
  readonly skip: boolean;
  /** Register the provider + add model records. Called in beforeAll. */
  readonly setup: () => Promise<void>;
  /** Cleanup. Called in afterAll. */
  readonly teardown: () => Promise<void>;
  /** Model ID to use for text generation */
  readonly textGenerationModel: string;
  /** Model ID for structured generation (may be same). Omit to skip structured generation tests. */
  readonly structuredGenerationModel?: string;
  /** Model ID for thinking (may be same). Omit to skip thinking tests. */
  readonly thinkingModel?: string;
  /** Max tokens to request (keep small for fast tests) */
  readonly maxTokens: number;
  /** Timeout per test in ms */
  readonly timeout: number;
}

// ========================================================================
// Generic test suite
// ========================================================================

export function runGenericAiProviderTests(setup: AiProviderTestSetup): void {
  describe.skipIf(setup.skip)(`Generic AI Provider: ${setup.name}`, () => {
    beforeAll(async () => {
      await setup.setup();
    }, setup.timeout);

    afterAll(async () => {
      await setup.teardown();
    });

    // ====================================================================
    // TextGeneration — basic smoke test
    // ====================================================================

    describe("TextGeneration", () => {
      it(
        "should generate non-empty text from a prompt",
        async () => {
          const workflow = new Workflow();
          workflow.textGeneration({
            model: setup.textGenerationModel,
            prompt: "Say hello in one sentence.",
            maxTokens: setup.maxTokens,
          });

          const result = (await workflow.run()) as { text: string };

          expect(result).toBeDefined();
          expect(typeof result.text).toBe("string");
          expect(result.text.length).toBeGreaterThan(0);
        },
        setup.timeout
      );
    });

    // ====================================================================
    // StructuredGeneration
    // ====================================================================

    describe.skipIf(!setup.structuredGenerationModel)("StructuredGeneration", () => {
      it(
        "should generate output conforming to a JSON schema",
        async () => {
          const outputSchema = {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "number" },
            },
            required: ["name", "age"],
            additionalProperties: false,
          } as const satisfies JsonSchema;

          const workflow = new Workflow();
          workflow.structuredGeneration({
            model: setup.structuredGenerationModel!,
            prompt:
              "Generate a JSON object with a person's name and age. Use name 'Alice' and age 30.",
            outputSchema,
            maxTokens: setup.maxTokens,
          });

          const result = (await workflow.run()) as StructuredGenerationTaskOutput;

          expect(result).toBeDefined();
          expect(result.object).toBeDefined();
          expect(typeof result.object).toBe("object");
          // Validate shape — fields should exist
          expect(result.object).toHaveProperty("name");
          expect(result.object).toHaveProperty("age");
        },
        setup.timeout
      );
    });

  });
}
