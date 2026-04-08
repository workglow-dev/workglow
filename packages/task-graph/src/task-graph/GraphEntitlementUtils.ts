/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type EntitlementId,
  type TaskEntitlement,
  type TaskEntitlements,
  type TrackedTaskEntitlement,
  type TrackedTaskEntitlements,
  EMPTY_ENTITLEMENTS,
  mergeEntitlementPair,
} from "../task/TaskEntitlements";
import type { TaskIdType } from "../task/TaskTypes";
import { TaskStatus } from "../task/TaskTypes";
import type { TaskGraph } from "./TaskGraph";

// ========================================================================
// Options
// ========================================================================

export interface GraphEntitlementOptions {
  /**
   * When true, annotate each entitlement with the source task IDs that require it.
   */
  readonly trackOrigins?: boolean;
  /**
   * Controls which ConditionalTask branches are included.
   * - "all" (default): Include entitlements from ALL branches (conservative, pre-execution analysis)
   * - "active": Only include entitlements from currently active branches (runtime, after conditions evaluated)
   */
  readonly conditionalBranches?: "all" | "active";
}

// ========================================================================
// Graph Entitlement Computation
// ========================================================================

/**
 * Computes the aggregated entitlements for a TaskGraph.
 * Returns the union of all task entitlements in the graph.
 *
 * When `trackOrigins` is true, returns TrackedTaskEntitlements with source task IDs.
 */
export function computeGraphEntitlements(
  graph: TaskGraph,
  options?: GraphEntitlementOptions & { readonly trackOrigins: true }
): TrackedTaskEntitlements;
export function computeGraphEntitlements(
  graph: TaskGraph,
  options?: GraphEntitlementOptions
): TaskEntitlements;
export function computeGraphEntitlements(
  graph: TaskGraph,
  options?: GraphEntitlementOptions
): TaskEntitlements | TrackedTaskEntitlements {
  const tasks = graph.getTasks();
  if (tasks.length === 0) return EMPTY_ENTITLEMENTS;

  const trackOrigins = options?.trackOrigins ?? false;
  const conditionalBranches = options?.conditionalBranches ?? "all";

  // Accumulate entitlements by ID
  const merged = new Map<
    EntitlementId,
    { entitlement: TaskEntitlement; sourceTaskIds: TaskIdType[] }
  >();

  for (const task of tasks) {
    // For ConditionalTask with "active" mode, skip disabled tasks
    if (conditionalBranches === "active" && task.status !== undefined) {
      if (task.status === TaskStatus.DISABLED) continue;
    }

    const taskEntitlements = task.entitlements();
    for (const entitlement of taskEntitlements.entitlements) {
      const existing = merged.get(entitlement.id);
      if (existing) {
        // Merge: optional=false wins, resources are unioned
        existing.entitlement = mergeEntitlementPair(existing.entitlement, entitlement);
        if (trackOrigins) {
          existing.sourceTaskIds.push(task.id);
        }
      } else {
        merged.set(entitlement.id, {
          entitlement,
          sourceTaskIds: trackOrigins ? [task.id] : [],
        });
      }
    }
  }

  if (merged.size === 0) return EMPTY_ENTITLEMENTS;

  if (trackOrigins) {
    const entitlements: TrackedTaskEntitlement[] = [];
    for (const { entitlement, sourceTaskIds } of merged.values()) {
      entitlements.push({ ...entitlement, sourceTaskIds });
    }
    return { entitlements };
  }

  return { entitlements: Array.from(merged.values()).map((e) => e.entitlement) };
}
