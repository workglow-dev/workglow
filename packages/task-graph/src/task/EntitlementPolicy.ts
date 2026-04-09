/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  EntitlementGrant,
  EntitlementId,
  TaskEntitlement,
  TaskEntitlements,
} from "./TaskEntitlements";
import { entitlementCovers, grantCoversResources } from "./TaskEntitlements";

// ========================================================================
// Policy Types
// ========================================================================

/**
 * A rule matching entitlements by ID and optional resource patterns.
 * Used for deny and ask rules. Same shape as EntitlementGrant.
 */
export interface EntitlementRule {
  readonly id: EntitlementId;
  /** Resource patterns (glob-style). When undefined, matches broadly. */
  readonly resources?: readonly string[];
}

/**
 * A unified entitlement policy combining deny, grant, and ask rules.
 *
 * Evaluation order: Deny → Grant → Ask → Default(deny).
 * - Deny rules override everything — if matched, the entitlement is denied.
 * - Grant rules auto-allow without prompting.
 * - Ask rules trigger a resolver to prompt the user.
 * - If no rule matches, the entitlement is denied.
 */
export interface EntitlementPolicy {
  /** Hard denials — checked first, override grants */
  readonly deny: readonly EntitlementRule[];
  /** Grants — auto-allowed without prompting */
  readonly grant: readonly EntitlementGrant[];
  /** Ask rules — require user approval via a resolver */
  readonly ask: readonly EntitlementRule[];
}

/**
 * The result of evaluating a single entitlement against a policy.
 */
export type EntitlementVerdict = "granted" | "denied" | "ask";

/**
 * Per-entitlement result from policy evaluation.
 */
export interface EntitlementCheckResult {
  readonly verdict: EntitlementVerdict;
  readonly entitlement: TaskEntitlement;
  /** The rule that produced this verdict (for debugging/UI). Undefined when default-denied. */
  readonly matchedRule?: EntitlementRule;
}

/** An empty policy that denies everything (no grants, no denies, no asks). */
export const EMPTY_POLICY: EntitlementPolicy = Object.freeze({
  deny: Object.freeze([]),
  grant: Object.freeze([]),
  ask: Object.freeze([]),
});

// ========================================================================
// Policy Evaluation
// ========================================================================

/**
 * Check if a rule covers a required entitlement.
 * Uses the same hierarchy and resource matching as grants:
 * - Rule ID must cover the entitlement ID (via `entitlementCovers`)
 * - Rule resources must cover the entitlement resources (via `grantCoversResources`)
 */
function ruleCovers(rule: EntitlementRule, required: TaskEntitlement): boolean {
  if (!entitlementCovers(rule.id, required.id)) return false;
  return grantCoversResources(rule as EntitlementGrant, required);
}

/**
 * Evaluates a policy against a set of required entitlements.
 *
 * For each required entitlement (skipping optional ones):
 * 1. If any deny rule matches → `"denied"`
 * 2. If any grant rule matches → `"granted"`
 * 3. If any ask rule matches → `"ask"`
 * 4. Otherwise → `"denied"` (default deny)
 *
 * This is a pure function with no side effects.
 */
export function evaluatePolicy(
  policy: EntitlementPolicy,
  required: TaskEntitlements
): readonly EntitlementCheckResult[] {
  const results: EntitlementCheckResult[] = [];

  for (const entitlement of required.entitlements) {
    if (entitlement.optional) continue;

    // 1. Check deny rules first
    const denyMatch = policy.deny.find((rule) => ruleCovers(rule, entitlement));
    if (denyMatch) {
      results.push({ verdict: "denied", entitlement, matchedRule: denyMatch });
      continue;
    }

    // 2. Check grant rules
    const grantMatch = policy.grant.find((rule) => ruleCovers(rule, entitlement));
    if (grantMatch) {
      results.push({ verdict: "granted", entitlement, matchedRule: grantMatch });
      continue;
    }

    // 3. Check ask rules
    const askMatch = policy.ask.find((rule) => ruleCovers(rule, entitlement));
    if (askMatch) {
      results.push({ verdict: "ask", entitlement, matchedRule: askMatch });
      continue;
    }

    // 4. Default deny
    results.push({ verdict: "denied", entitlement });
  }

  return results;
}
