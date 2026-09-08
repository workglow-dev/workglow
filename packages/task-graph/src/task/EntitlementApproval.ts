/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EntitlementId, TaskEntitlement, TaskEntitlements } from "./TaskEntitlements";
import { Entitlements } from "./TaskEntitlements";

/**
 * The two statics this rule reads.
 *
 * Deliberately narrower than `ITaskConstructor`: a host that holds a task's
 * class metadata — a catalog entry, a registry lookup — can ask the question
 * without satisfying the whole task interface.
 */
export interface EntitlementDeclaringTaskClass {
  /**
   * Whether this class's entitlements come from tasks it contains. Absent is
   * read as false — see {@link taskClassNeedsApproval} for who owns the gap.
   */
  readonly entitlementsFromChildren?: boolean | undefined;
  entitlements(): TaskEntitlements;
}

/**
 * Entitlements a caller that is already running a model necessarily holds.
 *
 * The default ambient set for the approval rule below. Running inference is
 * what such a caller is *for*, so a task that only runs a model reaches nothing
 * the caller did not already reach, and asking a human to approve it would put
 * a click in front of ordinary work. Everything else is reach the caller does
 * not otherwise have: a host and a request body, a path on disk, code, an MCP
 * server, a browser, stored data, a credential.
 */
export const INFERENCE_ENTITLEMENTS: ReadonlySet<EntitlementId> = new Set<EntitlementId>([
  Entitlements.AI,
  Entitlements.AI_MODEL,
  Entitlements.AI_INFERENCE,
]);

/**
 * The declared entitlements that fall outside `ambient`.
 *
 * Membership is exact, and matching is deliberately NOT hierarchical even
 * though {@link entitlementCovers} sits next door and would look like the
 * natural choice. An ambient `ai` must not silently cover an `ai:*` id minted
 * later: the allowlist is the whole rule, so an entitlement added to the
 * taxonomy gates the tasks declaring it instead of inheriting a pass from its
 * parent. Fail-closed on a new capability is the property this exists for; a
 * caller that genuinely wants a broader pass names the id in `ambient`.
 */
export function entitlementsBeyond(
  declared: readonly TaskEntitlement[],
  ambient: ReadonlySet<EntitlementId> = INFERENCE_ENTITLEMENTS
): readonly TaskEntitlement[] {
  return declared.filter((entitlement) => !ambient.has(entitlement.id));
}

/**
 * What running this task class reaches, beyond what the caller already holds.
 *
 * Read from the CLASS, so it is answerable before anything is instantiated or
 * run. A task whose reach widens at run time (`hasDynamicEntitlements`) only
 * ever widens within a family its static declaration already names — a URL
 * fetcher adds `network:private` on top of `network:http`, an AI task adds
 * `ai:model` scoped to the model it resolved — so the static answer is coarser
 * than the truth but never more permissive than it.
 */
export function taskClassReach(
  taskClass: EntitlementDeclaringTaskClass,
  ambient: ReadonlySet<EntitlementId> = INFERENCE_ENTITLEMENTS
): readonly TaskEntitlement[] {
  return entitlementsBeyond(taskClass.entitlements().entitlements, ambient);
}

/**
 * Whether a human should approve before this task class runs.
 *
 * Two questions, in order:
 *
 * 1. Does the static declaration name reach beyond `ambient`? Then yes.
 * 2. It does not — but is that empty answer about this task at all? Not when
 *    the reach lives in tasks it contains.
 *
 * The second is the one that is easy to miss. A composed task computes its
 * aggregate on the INSTANCE, so the static declaration of a graph wrapping a
 * URL fetcher is empty and a class-only check certifies it as pure.
 *
 * `hasDynamicEntitlements` is deliberately NOT what this turns on, though it
 * looks like the same question. A task is dynamic when it refines what it
 * already declares, and every AI task is dynamic for exactly that reason —
 * it attaches the resolved model id to `ai:model`. Gating on the flag would put
 * an approval in front of running a model at all, which is the one thing a
 * caller in {@link INFERENCE_ENTITLEMENTS} was always going to do.
 *
 * A class that composes without inheriting the marker — one a host synthesized
 * around saved content, say — reads as false here. That gap belongs to the
 * host: only it knows which of its classes it wrote.
 */
export function taskClassNeedsApproval(
  taskClass: EntitlementDeclaringTaskClass,
  ambient: ReadonlySet<EntitlementId> = INFERENCE_ENTITLEMENTS
): boolean {
  if (taskClassReach(taskClass, ambient).length > 0) return true;
  return taskClass.entitlementsFromChildren === true;
}

function describeEntitlement(entitlement: TaskEntitlement): string {
  const scope = entitlement.resources?.length ? ` → ${entitlement.resources.join(", ")}` : "";
  return entitlement.reason
    ? `${entitlement.id} (${entitlement.reason})${scope}`
    : `${entitlement.id}${scope}`;
}

/** What a composed class's reach amounts to, whatever else it declares. */
const UNDECLARED_REACH = "not declared up front — it depends on the tasks this one runs";

/**
 * `network:http (Fetches data from URLs via HTTP/HTTPS)` — one line an approval
 * prompt can show for why this task is being confirmed at all.
 *
 * Three answers, and the third is why the caveat is appended rather than chosen
 * between. A class declaring nothing and composing nothing says so plainly. A
 * class gated only by rule 2 above reports that its reach is undeclared rather
 * than reporting the empty static set as "reaches nothing", which is the one
 * reading that would make the prompt actively misleading. A composed class that
 * ALSO declares reach statically declares only its wrapper's share, so it gets
 * both — printing just that list is the same misleading reading in a second
 * spelling.
 */
export function describeTaskClassReach(
  taskClass: EntitlementDeclaringTaskClass,
  ambient: ReadonlySet<EntitlementId> = INFERENCE_ENTITLEMENTS
): string {
  const reach = taskClassReach(taskClass, ambient);
  const declared = reach.map(describeEntitlement).join("; ");
  if (taskClass.entitlementsFromChildren !== true) {
    return reach.length > 0 ? declared : "(nothing beyond running a model)";
  }
  return reach.length > 0 ? `${declared}; plus more ${UNDECLARED_REACH}` : UNDECLARED_REACH;
}
