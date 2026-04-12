/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { EntitlementPolicy } from "./EntitlementPolicy";
import { evaluatePolicy } from "./EntitlementPolicy";
import type { IEntitlementResolver } from "./EntitlementResolver";
import { PERMISSIVE_RESOLVER } from "./EntitlementResolver";
import type { ITask } from "./ITask";
import type { Task } from "./Task";
import type { EntitlementGrant, TaskEntitlement, TaskEntitlements } from "./TaskEntitlements";

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
   * Returns the list of denied (non-optional) entitlements, or empty array if all granted.
   */
  checkAll(required: TaskEntitlements): Promise<readonly TaskEntitlement[]>;

  /**
   * Runtime check: evaluate a single task's dynamic entitlements.
   * Called during execution for tasks with `hasDynamicEntitlements`.
   */
  checkTask(task: ITask): Promise<readonly TaskEntitlement[]>;
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
  ): Promise<readonly TaskEntitlement[]> {
    const results = evaluatePolicy(policy, required);
    const denied: TaskEntitlement[] = [];

    for (const result of results) {
      if (result.verdict === "denied") {
        denied.push(result.entitlement);
      } else if (result.verdict === "ask") {
        const request = {
          entitlement: result.entitlement,
          taskType: taskType ?? "unknown",
          taskId: taskId ?? "unknown",
        };
        // Check saved answer first
        const saved = resolver.lookup(request);
        if (saved !== undefined) {
          if (saved === "deny") {
            denied.push(result.entitlement);
          }
          continue;
        }
        // Prompt user
        const answer = await resolver.prompt(request);
        resolver.save(request, answer);
        if (answer === "deny") {
          denied.push(result.entitlement);
        }
      }
      // "granted" — nothing to do
    }

    return denied;
  }

  return {
    async checkAll(required: TaskEntitlements): Promise<readonly TaskEntitlement[]> {
      return resolveAsks(required);
    },

    async checkTask(task: ITask): Promise<readonly TaskEntitlement[]> {
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
