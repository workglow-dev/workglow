/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { EntitlementPolicy, EntitlementRule } from "./EntitlementPolicy";
import { evaluatePolicy } from "./EntitlementPolicy";
import type { IEntitlementResolver } from "./EntitlementResolver";
import { PERMISSIVE_RESOLVER } from "./EntitlementResolver";
import type { ITask } from "./ITask";
import type { Task } from "./Task";
import type { EntitlementGrant, TaskEntitlement, TaskEntitlements } from "./TaskEntitlements";

// ========================================================================
// Denial Type
// ========================================================================

/**
 * Why an entitlement was denied.
 * - `policy-deny`: matched a deny rule
 * - `default-deny`: no rule covered the entitlement
 * - `user-deny`: matched an ask rule and the resolver returned "deny"
 */
export type EntitlementDenialReason = "policy-deny" | "default-deny" | "user-deny";

/**
 * A single denied entitlement with the reason and the matching rule (if any).
 * Returned by `IEntitlementEnforcer` to give callers enough context to build
 * actionable error messages without re-running policy evaluation.
 *
 * Discriminated union on `reason`:
 * - `policy-deny`: `matchedRule` is always present (it is the deny rule that matched).
 * - `user-deny`:   `matchedRule` is always present (it is the ask rule that matched).
 * - `default-deny`: no rule matched at all; `matchedRule` is absent.
 */
export type EntitlementDenial =
  | {
      readonly entitlement: TaskEntitlement;
      readonly reason: "policy-deny";
      /** The deny rule that explicitly blocked this entitlement. */
      readonly matchedRule: EntitlementRule;
    }
  | {
      readonly entitlement: TaskEntitlement;
      readonly reason: "default-deny";
    }
  | {
      readonly entitlement: TaskEntitlement;
      readonly reason: "user-deny";
      /** The ask rule that triggered the user prompt. */
      readonly matchedRule: EntitlementRule;
    };

/** Format a denial for inclusion in an error message. */
export function formatEntitlementDenial(denial: EntitlementDenial): string {
  switch (denial.reason) {
    case "policy-deny":
      return `${denial.entitlement.id} (denied by rule ${denial.matchedRule.id})`;
    case "user-deny":
      return `${denial.entitlement.id} (denied by user)`;
    case "default-deny":
      return `${denial.entitlement.id} (no matching grant)`;
  }
}

// ========================================================================
// Enforcer Interface
// ========================================================================

/**
 * Interface for checking whether required entitlements are granted.
 * Register a custom implementation via the ServiceRegistry to enforce entitlements.
 *
 * Methods are async because resolving "ask" verdicts may require user interaction.
 */
export interface IEntitlementEnforcer {
  /**
   * Preflight check: evaluate all required entitlements against the policy.
   * Resolves "ask" verdicts via the resolver (prompt + save).
   * Returns the list of denials (non-optional entitlements only) — empty array when all granted.
   */
  checkAll(required: TaskEntitlements): Promise<readonly EntitlementDenial[]>;

  /**
   * Runtime check: evaluate a single task's dynamic entitlements.
   * Called during execution for tasks with `hasDynamicEntitlements`.
   */
  checkTask(task: ITask): Promise<readonly EntitlementDenial[]>;
}

// ========================================================================
// Default Enforcers
// ========================================================================

/** Default permissive enforcer — grants everything. */
export const PERMISSIVE_ENFORCER: IEntitlementEnforcer = {
  checkAll: async () => [],
  checkTask: async () => [],
};

/**
 * Creates an enforcer from a unified entitlement policy with deny/grant/ask rules.
 *
 * Evaluation order: Deny → Grant → Ask → Default(deny).
 *
 * @param policy - The policy defining deny, grant, and ask rules
 * @param resolver - Pluggable resolver for handling "ask" verdicts. Defaults to PERMISSIVE_RESOLVER.
 */
export function createPolicyEnforcer(
  policy: EntitlementPolicy,
  resolver: IEntitlementResolver = PERMISSIVE_RESOLVER
): IEntitlementEnforcer {
  async function resolveAsks(
    required: TaskEntitlements,
    taskType?: string,
    taskId?: unknown
  ): Promise<readonly EntitlementDenial[]> {
    const results = evaluatePolicy(policy, required);
    const denied: EntitlementDenial[] = [];

    for (const result of results) {
      if (result.verdict === "denied") {
        if (result.matchedRule) {
          denied.push({ entitlement: result.entitlement, reason: "policy-deny", matchedRule: result.matchedRule });
        } else {
          denied.push({ entitlement: result.entitlement, reason: "default-deny" });
        }
      } else if (result.verdict === "ask") {
        const request = {
          entitlement: result.entitlement,
          taskType: taskType ?? "unknown",
          taskId: taskId ?? "unknown",
        };
        // Check saved answer first; otherwise prompt and save
        let answer = resolver.lookup(request);
        if (answer === undefined) {
          answer = await resolver.prompt(request);
          resolver.save(request, answer);
        }
        if (answer === "deny") {
          // ask verdicts always have a matchedRule (the ask rule that fired)
          if (!result.matchedRule) {
            throw new Error(
              `Invariant violation: ask verdict for "${result.entitlement.id}" is missing matchedRule`
            );
          }
          denied.push({ entitlement: result.entitlement, reason: "user-deny", matchedRule: result.matchedRule });
        }
      }
      // "granted" — nothing to do
    }

    return denied;
  }

  return {
    async checkAll(required: TaskEntitlements): Promise<readonly EntitlementDenial[]> {
      return resolveAsks(required);
    },

    async checkTask(task: ITask): Promise<readonly EntitlementDenial[]> {
      const entitlements = task.entitlements();
      return resolveAsks(entitlements, (task.constructor as typeof Task).type, task.id);
    },
  };
}

/**
 * Creates an enforcer from scoped grants that support resource-level matching.
 * This is a convenience wrapper around `createPolicyEnforcer` with no deny or ask rules.
 *
 * Optional entitlements are never denied.
 */
export function createScopedEnforcer(grants: readonly EntitlementGrant[]): IEntitlementEnforcer {
  return createPolicyEnforcer({ deny: [], grant: grants, ask: [] });
}

/**
 * Creates an enforcer from a list of entitlement ID strings (broad grants).
 * Entitlement hierarchy is respected: granting "network" covers "network:http".
 * All grants are broad (no resource scoping). Optional entitlements are never denied.
 */
export function createGrantListEnforcer(grants: readonly string[]): IEntitlementEnforcer {
  return createScopedEnforcer(grants.map((id) => ({ id })));
}

// ========================================================================
// Service Token
// ========================================================================

/** Service token for registering an entitlement enforcer in the ServiceRegistry */
export const ENTITLEMENT_ENFORCER = createServiceToken<IEntitlementEnforcer>(
  "workglow.entitlementEnforcer"
);
