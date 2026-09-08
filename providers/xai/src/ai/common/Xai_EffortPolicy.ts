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

const REASONING = {
  supported: MODEL_EFFORTS,
  default: "medium",
} as const satisfies ModelEffortPolicy;

/**
 * Ids xAI serves as image generation rather than text.
 *
 * Exported because pricing needs the same answer and must not keep a second
 * copy of it: these models bill per image, so the per-1M-token card the
 * pricing table would otherwise hand them (a dash is a legal suffix boundary,
 * so `grok-2-image-1212` matches `grok-2`) is a fabricated unit. One matcher,
 * so the two cannot drift.
 */
export const XAI_IMAGE_MODEL = /(?:^|-)image(?:-|$)/i;

/**
 * xAI serves reasoning only on the Grok text ids, and rejects
 * `reasoning_effort` elsewhere, so an id outside them keeps the plain path.
 */
export const xaiEffortPolicy: ModelEffortPolicyFn = makeEffortPolicy({
  rules: [
    { when: [XAI_IMAGE_MODEL, /non-reasoning/i], policy: EFFORT_POLICY_NONE },
    { when: /^grok/i, policy: REASONING },
  ],
  fallback: EFFORT_POLICY_NONE,
});
