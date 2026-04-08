/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { TaskEntitlement } from "./TaskEntitlements";
import type { TaskIdType } from "./TaskTypes";

// ========================================================================
// Resolver Types
// ========================================================================

/**
 * A request to the resolver for a user decision on an entitlement.
 */
export interface EntitlementAskRequest {
  /** The entitlement that needs a decision */
  readonly entitlement: TaskEntitlement;
  /** The task type requesting the entitlement */
  readonly taskType: string;
  /** The task instance ID requesting the entitlement */
  readonly taskId: TaskIdType;
}

/**
 * A user's answer to an entitlement ask.
 */
export type EntitlementAnswer = "grant" | "deny";

// ========================================================================
// Resolver Interface
// ========================================================================

/**
 * Pluggable interface for handling "ask" entitlement verdicts.
 *
 * The resolver is responsible for:
 * - Checking if a saved answer exists (`lookup`)
 * - Prompting the user for a decision (`prompt`)
 * - Persisting the user's answer for future lookups (`save`)
 *
 * Implementations vary by environment:
 * - Builder app: shows a dialog, persists answers per-project
 * - CLI: prints to terminal, saves in config
 * - Tests: use PERMISSIVE_RESOLVER or DENY_ALL_RESOLVER
 */
export interface IEntitlementResolver {
  /** Check if there's a saved answer for this ask. Returns undefined if not saved. */
  lookup(request: EntitlementAskRequest): EntitlementAnswer | undefined;
  /** Prompt the user and return their answer. May block on UI. */
  prompt(request: EntitlementAskRequest): Promise<EntitlementAnswer>;
  /** Save a user's answer for future lookups. */
  save(request: EntitlementAskRequest, answer: EntitlementAnswer): void;
}

// ========================================================================
// Built-in Resolvers
// ========================================================================

/** Grants all asks without prompting. Useful for tests and permissive environments. */
export const PERMISSIVE_RESOLVER: IEntitlementResolver = {
  lookup: () => "grant",
  prompt: async () => "grant",
  save: () => {},
};

/** Denies all asks without prompting. Useful for locked-down environments. */
export const DENY_ALL_RESOLVER: IEntitlementResolver = {
  lookup: () => "deny",
  prompt: async () => "deny",
  save: () => {},
};

// ========================================================================
// Service Token
// ========================================================================

/** Service token for registering an entitlement resolver in the ServiceRegistry */
export const ENTITLEMENT_RESOLVER = createServiceToken<IEntitlementResolver>(
  "workglow.entitlementResolver"
);
