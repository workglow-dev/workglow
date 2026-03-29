/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// ========================================================================
// Entitlement Types
// ========================================================================

/**
 * Hierarchical entitlement identifier.
 * Uses colon-separated namespacing: "network", "network:http", "network:websocket"
 * A grant of "network" implicitly covers "network:http" and "network:websocket".
 */
export type EntitlementId = string;

/**
 * A single entitlement declaration.
 */
export interface TaskEntitlement {
  /** Hierarchical identifier, e.g. "network:http", "credential:anthropic", "code-execution:javascript" */
  readonly id: EntitlementId;
  /** Human-readable reason why this entitlement is needed */
  readonly reason?: string;
  /** Whether this entitlement is optional (task can degrade gracefully without it) */
  readonly optional?: boolean;
  /**
   * Specific resources this entitlement applies to.
   * E.g. URL patterns for network, model IDs for ai:model, server names for mcp.
   * When undefined, the entitlement applies broadly.
   */
  readonly resources?: readonly string[];
}

/**
 * Complete entitlement declaration for a task or graph.
 */
export interface TaskEntitlements {
  /** List of entitlements required */
  readonly entitlements: readonly TaskEntitlement[];
}

/**
 * An entitlement with origin tracking (which task(s) require it).
 */
export interface TrackedTaskEntitlement extends TaskEntitlement {
  /** Task IDs that require this entitlement */
  readonly sourceTaskIds: readonly unknown[];
}

/**
 * Entitlements with optional origin tracking.
 */
export interface TrackedTaskEntitlements {
  readonly entitlements: readonly TrackedTaskEntitlement[];
}

// ========================================================================
// Well-Known Entitlement Constants
// ========================================================================

/**
 * Well-known entitlement categories. Tasks may also use custom IDs beyond these.
 */
export const Entitlements = {
  // Network
  NETWORK: "network",
  NETWORK_HTTP: "network:http",
  NETWORK_WEBSOCKET: "network:websocket",
  NETWORK_PRIVATE: "network:private",

  // File system
  FILESYSTEM: "filesystem",
  FILESYSTEM_READ: "filesystem:read",
  FILESYSTEM_WRITE: "filesystem:write",

  // Code execution
  CODE_EXECUTION: "code-execution",
  CODE_EXECUTION_JS: "code-execution:javascript",

  // Credentials
  CREDENTIAL: "credential",

  // AI models
  AI_MODEL: "ai:model",
  AI_INFERENCE: "ai:inference",

  // MCP
  MCP: "mcp",
  MCP_TOOL_CALL: "mcp:tool-call",
  MCP_RESOURCE_READ: "mcp:resource-read",
  MCP_PROMPT_GET: "mcp:prompt-get",

  // Storage / database
  STORAGE: "storage",
  STORAGE_READ: "storage:read",
  STORAGE_WRITE: "storage:write",
} as const;

// ========================================================================
// Empty Entitlements Singleton
// ========================================================================

/** Shared empty entitlements object to avoid unnecessary allocations */
export const EMPTY_ENTITLEMENTS: TaskEntitlements = Object.freeze({
  entitlements: Object.freeze([]),
});

// ========================================================================
// Utility Functions
// ========================================================================

/**
 * Check if a granted entitlement covers a required entitlement.
 * "network" covers "network:http" (parent covers child in hierarchy).
 */
export function entitlementCovers(granted: EntitlementId, required: EntitlementId): boolean {
  return required === granted || required.startsWith(granted + ":");
}

/**
 * Merge two TaskEntitlements into a union (deduplicating by ID).
 * If the same ID appears in both, optional is false if either is false (most restrictive wins).
 * Resources are merged (union of all resource arrays for the same ID).
 */
export function mergeEntitlements(a: TaskEntitlements, b: TaskEntitlements): TaskEntitlements {
  if (a.entitlements.length === 0) return b;
  if (b.entitlements.length === 0) return a;

  const merged = new Map<EntitlementId, TaskEntitlement>();

  for (const entitlement of a.entitlements) {
    merged.set(entitlement.id, entitlement);
  }

  for (const entitlement of b.entitlements) {
    const existing = merged.get(entitlement.id);
    if (existing) {
      merged.set(entitlement.id, mergeEntitlementPair(existing, entitlement));
    } else {
      merged.set(entitlement.id, entitlement);
    }
  }

  return { entitlements: Array.from(merged.values()) };
}

/**
 * Merge two entitlements with the same ID.
 * - optional: false wins (most restrictive)
 * - reason: first non-empty wins
 * - resources: union
 */
function mergeEntitlementPair(a: TaskEntitlement, b: TaskEntitlement): TaskEntitlement {
  const optional = (a.optional ?? true) && (b.optional ?? true) ? true : undefined;
  const reason = a.reason ?? b.reason;
  const resources = mergeResources(a.resources, b.resources);

  const result: Record<string, unknown> = { id: a.id };
  if (reason !== undefined) result.reason = reason;
  if (optional === true) result.optional = true;
  if (resources !== undefined) result.resources = resources;
  return result as unknown as TaskEntitlement;
}

function mergeResources(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined
): readonly string[] | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  const set = new Set([...a, ...b]);
  return Array.from(set);
}
