/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pre-built entitlement grant profiles for common runtime environments.
 * The library has no concept of Electron, brands, or deployment targets —
 * only capability profiles expressed as entitlement grants.
 */

import type { EntitlementGrant } from "./TaskEntitlements";
import { createScopedEnforcer, type IEntitlementEnforcer } from "./EntitlementEnforcer";

// ========================================================================
// Grant Profiles
// ========================================================================

/**
 * Browser environment grants.
 * No filesystem access, no code execution, no stdio MCP.
 */
export const BROWSER_GRANTS: readonly EntitlementGrant[] = [
  { id: "network" },
  { id: "ai" },
  { id: "mcp:tool-call" },
  { id: "mcp:resource-read" },
  { id: "mcp:prompt-get" },
  { id: "storage" },
  { id: "credential" },
];

/**
 * Desktop environment grants (e.g., Electron with Node.js main process).
 * Adds filesystem, code execution, and stdio MCP on top of browser grants.
 */
export const DESKTOP_GRANTS: readonly EntitlementGrant[] = [
  ...BROWSER_GRANTS,
  { id: "filesystem" },
  { id: "code-execution" },
  { id: "mcp:stdio" },
];

/**
 * Server environment grants (e.g., cloud deployment).
 * Same as desktop for now; can add resource scoping later.
 */
export const SERVER_GRANTS: readonly EntitlementGrant[] = [
  ...DESKTOP_GRANTS,
];

// ========================================================================
// Profile Factory
// ========================================================================

export type EntitlementProfile = "browser" | "desktop" | "server";

const PROFILE_GRANTS: Record<EntitlementProfile, readonly EntitlementGrant[]> = {
  browser: BROWSER_GRANTS,
  desktop: DESKTOP_GRANTS,
  server: SERVER_GRANTS,
};

/**
 * Creates a scoped entitlement enforcer for the given runtime profile.
 * Tasks requiring entitlements not in the profile will be denied.
 */
export function createProfileEnforcer(profile: EntitlementProfile): IEntitlementEnforcer {
  return createScopedEnforcer(PROFILE_GRANTS[profile]);
}

/**
 * Returns the grant list for a given profile.
 * Useful for inspection or combining with additional grants.
 */
export function getProfileGrants(profile: EntitlementProfile): readonly EntitlementGrant[] {
  return PROFILE_GRANTS[profile];
}
