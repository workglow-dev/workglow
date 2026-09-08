/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebCommandNode, WebRunsMembership, WebRunsOrder } from "./commandTree";

/**
 * What a downstream package says ABOUT a command or a field it already has.
 *
 * The other seams contribute new surface — a panel, a widget, a schema. This
 * one annotates surface that already exists, which is what a commander-based
 * CLI needs: `sec query facts <cik>` declares a positional string, and nothing
 * in commander can say that the string is a CIK, that a picker exists for it,
 * or that `db reset` drops tables. Every field of an annotation is optional and
 * additive, so a command nobody annotates renders exactly as it does today.
 */

/** Tones a badge or a status line can carry. Rendered, never interpreted. */
export type WebTone = "ok" | "warn" | "fail" | "info" | "idle";

/**
 * What running this command costs, in the terms an operator weighs before
 * pressing a button they cannot take back.
 *
 * `ai` spends model quota, `network` goes out to a rate-limited third party,
 * `slow` runs longer than someone will sit and watch, `writes` changes stored
 * data, and `destructive` destroys some of it. They compose: a backfill is
 * every one of them at once.
 */
export const COMMAND_BADGES = ["ai", "network", "slow", "writes", "destructive"] as const;
export type WebCommandBadge = (typeof COMMAND_BADGES)[number];

/**
 * One sibling an `all`-style command runs, in the position it runs it.
 *
 * `name` is the sibling's own command name, as the tree shows it — not a path:
 * an `all` runs what sits beside it, and nothing else can be named here.
 */
export interface WebRunsMember {
  readonly name: string;
  /**
   * The condition, in one phrase, when this member does not run every time —
   * `"only with --download-docs"`, `"unless --skip-ingest"`. Undefined means it
   * always runs.
   */
  readonly when?: string;
}

export interface WebCommandAnnotation {
  /**
   * Command path to match. A `"*"` segment matches exactly one segment and a
   * trailing `"**"` matches the rest, so `["version", "**"]` covers a group
   * without restating its leaves.
   */
  readonly path: readonly string[];
  /** Package name, so an annotation says who owns it. */
  readonly source: string;
  readonly badges?: readonly WebCommandBadge[];
  /** One line shown above the form: what this run will actually do. */
  readonly note?: string;
  /**
   * Text of a confirmation the page requires before it will start a run.
   *
   * Reserved for a command whose damage survives the run — dropping a version
   * slot, resetting a database. A run that merely costs money says so with the
   * `ai` badge instead; a dialog on every extraction is a dialog nobody reads.
   */
  readonly confirm?: string;
  /**
   * The siblings this command runs, in the order it runs them.
   *
   * Declared on the `all` itself and stamped onto both sides by
   * {@link annotateCommandTree}, which is what keeps the two readings of one
   * fact from drifting: the members are told which step of which `all` they
   * are, and the `all` is told which siblings it leaves out.
   *
   * That last half is the reason this exists. `all` reads as "everything
   * listed here" and routinely is not — `sync all` skips the ad-hoc sweeper
   * beside it — and commander carries nothing that says so, so the console
   * offered a button whose scope could only be learned by reading the source.
   */
  readonly runs?: readonly WebRunsMember[];
}

export interface WebFieldAnnotation {
  /**
   * The widget hook. Names a `WebFieldWidget` format, which is how a positional
   * argument gets the picker a schema field gets from its own `format`.
   */
  readonly format?: string;
  readonly label?: string;
  readonly description?: string;
  readonly choices?: readonly string[];
  readonly placeholder?: string;
  /** Moves a field behind the fold, or pulls one out from behind it. */
  readonly advanced?: boolean;
  /**
   * The field takes a comma-separated list, so picking from the widget appends
   * rather than replaces. `--models` names several models; `--cik` names one.
   */
  readonly multiple?: boolean;
}

export interface CommandFieldAnnotations {
  /** Same matching rules as {@link WebCommandAnnotation.path}. */
  readonly path: readonly string[];
  readonly source: string;
  /** Keyed by field key: an argument's name, or an option's long flag. */
  readonly fields: Readonly<Record<string, WebFieldAnnotation>>;
}

const commandAnnotations: WebCommandAnnotation[] = [];
const fieldAnnotations: CommandFieldAnnotations[] = [];

/**
 * Whether a pattern matches a path, and how specifically.
 *
 * Returns the number of literal segments matched, or -1 for no match, so the
 * caller can apply the general annotation before the particular one and let
 * the particular one win.
 */
export function matchPathSpecificity(pattern: readonly string[], path: readonly string[]): number {
  let literals = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index];
    if (segment === "**") {
      // `**` means "the rest", so anything written after it is a segment the
      // author expected to constrain the match and that nothing can honor.
      // Matching regardless would silently apply the annotation far wider than
      // the pattern reads; refusing makes it match nothing instead, which the
      // downstream guard tests — every registered pattern must reach at least
      // one real command — turn into a failure that names the pattern.
      return index === pattern.length - 1 ? literals : -1;
    }
    if (index >= path.length) return -1;
    if (segment === "*") continue;
    if (segment !== path[index]) return -1;
    literals += 1;
  }
  return pattern.length === path.length ? literals : -1;
}

function matching<T extends { readonly path: readonly string[] }>(
  entries: readonly T[],
  path: readonly string[]
): T[] {
  return entries
    .map((entry) => ({ entry, rank: matchPathSpecificity(entry.path, path) }))
    .filter((candidate) => candidate.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((candidate) => candidate.entry);
}

export function registerCommandAnnotation(annotation: WebCommandAnnotation): void {
  const key = annotation.path.join(" ");
  const at = commandAnnotations.findIndex((entry) => entry.path.join(" ") === key);
  if (at >= 0) commandAnnotations[at] = annotation;
  else commandAnnotations.push(annotation);
}

export function registerCommandFieldAnnotations(annotations: CommandFieldAnnotations): void {
  const key = annotations.path.join(" ");
  const at = fieldAnnotations.findIndex((entry) => entry.path.join(" ") === key);
  if (at >= 0) fieldAnnotations[at] = annotations;
  else fieldAnnotations.push(annotations);
}

/** The badges, note, confirmation and run order that apply to one command path. */
export function resolveCommandAnnotation(path: readonly string[]): {
  readonly badges: readonly WebCommandBadge[];
  readonly note: string | undefined;
  readonly confirm: string | undefined;
  readonly runs: readonly WebRunsMember[] | undefined;
} {
  const badges = new Set<WebCommandBadge>();
  let note: string | undefined;
  let confirm: string | undefined;
  // Not unioned the way badges are: an order is one statement about one
  // command, and merging a group's with a leaf's would invent a sequence
  // nothing runs. The most specific annotation wins outright.
  let runs: readonly WebRunsMember[] | undefined;
  for (const annotation of matching(commandAnnotations, path)) {
    for (const badge of annotation.badges ?? []) badges.add(badge);
    if (annotation.note !== undefined) note = annotation.note;
    if (annotation.confirm !== undefined) confirm = annotation.confirm;
    if (annotation.runs !== undefined) runs = annotation.runs;
  }
  return { badges: [...badges], note, confirm, runs };
}

/** The annotations for one command's fields, keyed by field key. */
export function resolveFieldAnnotations(
  path: readonly string[]
): ReadonlyMap<string, WebFieldAnnotation> {
  const merged = new Map<string, WebFieldAnnotation>();
  for (const entry of matching(fieldAnnotations, path)) {
    for (const [key, annotation] of Object.entries(entry.fields)) {
      merged.set(key, { ...merged.get(key), ...annotation });
    }
  }
  return merged;
}

/**
 * The siblings an `all` runs, and the ones it does not — its own half.
 *
 * A member naming no sibling — a command since renamed or removed — stays in
 * the order, where it reads as a step that runs nothing rather than vanishing,
 * and is named in `unrunMembers` for a guard test to assert is empty.
 */
function runOrderAmong(
  runner: WebCommandNode,
  siblings: readonly WebCommandNode[],
  runs: readonly WebRunsMember[]
): WebRunsOrder {
  const named = new Set(runs.map((member) => member.name));
  return {
    members: runs,
    skipped: siblings
      .filter((sibling) => sibling.name !== runner.name && !named.has(sibling.name))
      .map((sibling) => sibling.name),
    unrunMembers: runs
      .filter((member) => !siblings.some((sibling) => sibling.name === member.name))
      .map((member) => member.name),
  };
}

/**
 * What each command in one sibling set is told about the `all` that runs it.
 *
 * Read off the same declaration the `all` carries, so what a member says and
 * what the `all` counts cannot disagree — `skipped` travels with each member
 * for that reason: whether membership is worth marking at all depends on
 * whether anything beside it is left out, which no member can see for itself.
 */
function membershipsAmong(
  siblings: readonly WebCommandNode[]
): ReadonlyMap<string, WebRunsMembership> {
  const memberships = new Map<string, WebRunsMembership>();
  const names = new Set(siblings.map((sibling) => sibling.name));
  for (const runner of siblings) {
    const { runs } = resolveCommandAnnotation(runner.path);
    if (runs === undefined) continue;
    const skipped = runOrderAmong(runner, siblings, runs).skipped.length;
    runs.forEach((member, index) => {
      // Numbered from the declaration, so a member that names nothing still
      // costs its position rather than renumbering the ones behind it.
      if (!names.has(member.name) || member.name === runner.name) return;
      memberships.set(member.name, {
        command: runner.name,
        step: index + 1,
        of: runs.length,
        skipped,
        ...(member.when !== undefined ? { when: member.when } : {}),
      });
    });
  }
  return memberships;
}

/**
 * Decorates a command tree with its annotations, in place of the caller
 * walking it. Applied where the tree is served rather than where it is built,
 * so `buildCommandTree` stays a pure reading of the commander program.
 */
export function annotateCommandTree(nodes: readonly WebCommandNode[]): readonly WebCommandNode[] {
  // One sibling set at a time, because an `all` is a statement about the
  // commands beside it: the member rows are stamped from the runner's own
  // declaration, which no per-node walk could reach.
  const memberships = membershipsAmong(nodes);
  return nodes.map((node) => {
    const { badges, note, confirm, runs } = resolveCommandAnnotation(node.path);
    const membership = memberships.get(node.name);
    return {
      ...node,
      children: annotateCommandTree(node.children),
      ...(badges.length > 0 ? { badges } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(confirm !== undefined ? { confirm } : {}),
      ...(runs !== undefined ? { runsInOrder: runOrderAmong(node, nodes, runs) } : {}),
      ...(membership !== undefined ? { runsIn: membership } : {}),
    };
  });
}

export function resetWebAnnotationsForTesting(): void {
  commandAnnotations.length = 0;
  fieldAnnotations.length = 0;
}
