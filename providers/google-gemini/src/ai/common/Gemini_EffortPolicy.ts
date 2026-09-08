/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EFFORT_POLICY_NONE,
  makeEffortPolicy,
  MODEL_EFFORTS,
  type ModelEffortPolicy,
  type ModelEffortPolicyFn,
} from "@workglow/ai/worker";

const TEXT = { supported: MODEL_EFFORTS, default: "none" } as const satisfies ModelEffortPolicy;

/**
 * Ids Gemini serves as image generation rather than text.
 *
 * Exported because pricing needs the same answer and must not keep a second
 * copy of it: these bill per image, so a per-1M-token card borrowed from a
 * text sibling is a fabricated unit. The table names several of them
 * explicitly, and an explicit entry still wins — this only stops the substring
 * walk reaching for a neighbour's card.
 */
export const GEMINI_IMAGE_MODELS: readonly RegExp[] = [/^imagen-/i, /^gemini-.*-image(?:-|$)/i];

/**
 * Gemini rejects `thinkingConfig` on the models that do not think, so an id
 * outside the `gemini-` text families keeps the plain path — including the
 * embedding and image ids denied above, which share that prefix.
 */
export const geminiEffortPolicy: ModelEffortPolicyFn = makeEffortPolicy({
  rules: [
    {
      when: [/^gemini-embedding/i, /^text-embedding/i, /^embedding-/i, ...GEMINI_IMAGE_MODELS],
      policy: EFFORT_POLICY_NONE,
    },
    { when: /^gemini-/i, policy: TEXT },
  ],
  fallback: EFFORT_POLICY_NONE,
});
