/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import { entitlementCovers, type TaskEntitlement, type TaskEntitlements } from "./TaskEntitlements";

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
   * can inspect `resources` for fine-grained policy.
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
 * Creates an enforcer that grants a specific set of entitlements.
 * Entitlement hierarchy is respected: granting "network" covers "network:http".
 * Optional entitlements are never denied.
 */
export function createGrantListEnforcer(grants: readonly string[]): IEntitlementEnforcer {
  return {
    check(required: TaskEntitlements): readonly TaskEntitlement[] {
      const denied: TaskEntitlement[] = [];
      for (const entitlement of required.entitlements) {
        if (entitlement.optional) continue;
        const granted = grants.some((g) => entitlementCovers(g, entitlement.id));
        if (!granted) {
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
