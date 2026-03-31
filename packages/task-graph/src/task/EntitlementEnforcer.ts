/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import {
  entitlementCovers,
  grantCoversResources,
  type EntitlementGrant,
  type TaskEntitlement,
  type TaskEntitlements,
} from "./TaskEntitlements";

// ========================================================================
// Enforcer Interface
// ========================================================================

/**
 * Interface for checking whether required entitlements are granted.
 * Register a custom implementation via the ServiceRegistry to enforce entitlements.
 */
export interface IEntitlementEnforcer {
  /**
   * Check whether the given entitlements are granted.
   * Returns the list of denied (non-optional) entitlements, or empty array if all granted.
   *
   * The enforcer uses `entitlementCovers()` for hierarchical matching and
   * `grantCoversResources()` for resource-level matching.
   */
  check(required: TaskEntitlements): readonly TaskEntitlement[];
}

// ========================================================================
// Default Enforcers
// ========================================================================

/** Default permissive enforcer — grants everything. */
export const PERMISSIVE_ENFORCER: IEntitlementEnforcer = {
  check: () => [],
};

/**
 * Creates an enforcer from a list of entitlement ID strings (broad grants).
 * Entitlement hierarchy is respected: granting "network" covers "network:http".
 * All grants are broad (no resource scoping). Optional entitlements are never denied.
 */
export function createGrantListEnforcer(grants: readonly string[]): IEntitlementEnforcer {
  return createScopedEnforcer(grants.map((id) => ({ id })));
}

/**
 * Creates an enforcer from scoped grants that support resource-level matching.
 *
 * @example
 * ```ts
 * const enforcer = createScopedEnforcer([
 *   // Broad grant — covers all network:http resources
 *   { id: "network:http" },
 *
 *   // Scoped grant — only covers reads under /tmp
 *   { id: "filesystem:read", resources: ["/tmp/*"] },
 *
 *   // Scoped grant — only specific models
 *   { id: "ai:model", resources: ["claude-*", "gpt-4o"] },
 *
 *   // Broad grant for code execution
 *   { id: "code-execution" },
 * ]);
 * ```
 */
export function createScopedEnforcer(grants: readonly EntitlementGrant[]): IEntitlementEnforcer {
  return {
    check(required: TaskEntitlements): readonly TaskEntitlement[] {
      const denied: TaskEntitlement[] = [];
      for (const entitlement of required.entitlements) {
        if (entitlement.optional) continue;

        // Find a grant whose ID covers this entitlement (hierarchy check)
        const matchingGrants = grants.filter((g) => entitlementCovers(g.id, entitlement.id));

        if (matchingGrants.length === 0) {
          denied.push(entitlement);
          continue;
        }

        // At least one matching grant must also cover the required resources
        const resourceCovered = matchingGrants.some((g) =>
          grantCoversResources(g, entitlement)
        );
        if (!resourceCovered) {
          denied.push(entitlement);
        }
      }
      return denied;
    },
  };
}

// ========================================================================
// Service Token
// ========================================================================

/** Service token for registering an entitlement enforcer in the ServiceRegistry */
export const ENTITLEMENT_ENFORCER = createServiceToken<IEntitlementEnforcer>(
  "workglow.entitlementEnforcer"
);
