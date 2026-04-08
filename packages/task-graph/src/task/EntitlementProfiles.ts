/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pre-built entitlement grant profiles for common runtime environments.
 * The library has no concept of Electron, brands, or deployment targets —
 * only capability profiles expressed as entitlement policies.
 */

import { createPolicyEnforcer, type IEntitlementEnforcer } from "./EntitlementEnforcer";
import type { EntitlementPolicy } from "./EntitlementPolicy";
import type { IEntitlementResolver } from "./EntitlementResolver";
import type { EntitlementGrant } from "./TaskEntitlements";
import { Entitlements } from "./TaskEntitlements";

// ========================================================================
// Grant Profiles
// ========================================================================

/**
 * Browser environment grants.
 * No filesystem access, no code execution, no stdio MCP.
 */
export const BROWSER_GRANTS: readonly EntitlementGrant[] = [
  { id: Entitlements.NETWORK },
  { id: Entitlements.AI },
  { id: Entitlements.MCP_TOOL_CALL },
  { id: Entitlements.MCP_RESOURCE_READ },
  { id: Entitlements.MCP_PROMPT_GET },
  { id: Entitlements.STORAGE },
  { id: Entitlements.CREDENTIAL },
];

/**
 * Desktop environment grants (e.g., Electron with Node.js main process).
 * Adds filesystem, code execution, and stdio MCP on top of browser grants.
 */
export const DESKTOP_GRANTS: readonly EntitlementGrant[] = [
  ...BROWSER_GRANTS,
  { id: Entitlements.FILESYSTEM },
  { id: Entitlements.CODE_EXECUTION },
  { id: Entitlements.MCP_STDIO },
];

/**
 * Server environment grants (e.g., cloud deployment).
 * Same as desktop for now; can add resource scoping later.
 */
export const SERVER_GRANTS: readonly EntitlementGrant[] = [...DESKTOP_GRANTS];

// ========================================================================
// Policy Factory
// ========================================================================

export type EntitlementProfile = "browser" | "desktop" | "server";

const PROFILE_GRANTS: Record<EntitlementProfile, readonly EntitlementGrant[]> = {
  browser: BROWSER_GRANTS,
  desktop: DESKTOP_GRANTS,
  server: SERVER_GRANTS,
};

/**
 * Creates an entitlement policy for the given runtime profile.
 * The profile's grants become the policy's grant rules.
 * Deny and ask arrays are empty by default — callers can extend the returned policy.
 */
export function createProfilePolicy(profile: EntitlementProfile): EntitlementPolicy {
  return { deny: [], grant: PROFILE_GRANTS[profile], ask: [] };
}

/**
 * Creates an entitlement enforcer for the given runtime profile.
 * Tasks requiring entitlements not in the profile will be denied.
 *
 * @param profile - The runtime profile to use
 * @param resolver - Optional resolver for handling "ask" verdicts
 */
export function createProfileEnforcer(
  profile: EntitlementProfile,
  resolver?: IEntitlementResolver
): IEntitlementEnforcer {
  return createPolicyEnforcer(createProfilePolicy(profile), resolver);
}

/**
 * Returns the grant list for a given profile.
 * Useful for inspection or combining with additional grants.
 */
export function getProfileGrants(profile: EntitlementProfile): readonly EntitlementGrant[] {
  return PROFILE_GRANTS[profile];
}
