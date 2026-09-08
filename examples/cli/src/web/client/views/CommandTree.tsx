/** @jsxImportSource preact */
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from "preact";
import type { WebCommandBadge } from "../../annotations";
import type { WebCommandNode } from "../../commandTree";

/**
 * The one-glyph form of a cost badge.
 *
 * A rail 266px wide has no room for the word, and the point of the badge is
 * that it is visible BEFORE you click into a command — a `db reset` that
 * announces itself only once you are looking at its Run button has announced
 * itself too late.
 */
const BADGE_GLYPH: Readonly<Record<WebCommandBadge, string>> = {
  ai: "AI",
  network: "NET",
  slow: "SLOW",
  writes: "W",
  destructive: "!",
};

/**
 * The `all` marker, on both sides of an order.
 *
 * On the `all` itself it is a count, because the name is the thing that
 * misleads: `4/5` says four of the five commands beside it, and the one it
 * leaves out is named in the tooltip and in the form.
 *
 * A member is marked only where that count leaves the question open — where
 * the `all` skips something, so which rows it covers is a real question, or
 * where this member runs only under a flag. An `all` that runs its whole group
 * has already said so on its own row, and a chip repeated down every row under
 * it is one nobody reads.
 */
export function RunsMarker({ node }: { node: WebCommandNode }): JSX.Element | null {
  const group = node.path.slice(0, -1).join(" ");
  if (node.runsInOrder) {
    const { members, skipped } = node.runsInOrder;
    const of = members.length + skipped.length;
    return (
      <span className="badges">
        <span
          className={`cb cb-all${skipped.length > 0 ? " partial" : ""}`}
          title={
            `Runs ${members.length} of the ${of} commands under \`${group}\`, in order: ` +
            `${members.map((member) => member.name).join(" → ")}` +
            (skipped.length > 0 ? `. Not run: ${skipped.join(", ")}` : "")
          }
        >
          ALL {members.length}/{of}
        </span>
      </span>
    );
  }
  if (node.runsIn && (node.runsIn.skipped > 0 || node.runsIn.when !== undefined)) {
    const { command, step, of, when } = node.runsIn;
    return (
      <span className="badges">
        <span
          className="cb cb-all"
          title={
            `Step ${step} of ${of} of \`${[group, command].filter(Boolean).join(" ")}\`` +
            (when ? ` — ${when}` : "")
          }
        >
          {when ? "ALL?" : "ALL"}
        </span>
      </span>
    );
  }
  return null;
}

export function CommandBadges({
  badges,
  className = "",
}: {
  badges: readonly WebCommandBadge[] | undefined;
  className?: string;
}): JSX.Element | null {
  if (!badges || badges.length === 0) return null;
  return (
    <span className={`badges ${className}`.trim()}>
      {badges.map((badge) => (
        <span key={badge} className={`cb cb-${badge}`} title={badge}>
          {BADGE_GLYPH[badge]}
        </span>
      ))}
    </span>
  );
}

/**
 * One row: the command, and what it costs to run.
 *
 * The rail carries the NAME and nothing else. A description clipped to what a
 * 266px rail has left over is a sentence nobody can read and a column that
 * pushes the badges — the part that has to be legible before you click — into
 * whatever is left; the full line reads in the options pane, and on the row's
 * tooltip.
 */
/**
 * The badges-and-note strip a command carries above whatever it is about to do.
 *
 * Shared by the form and the group page rather than written twice: both are
 * the same claim — what this costs, and what to know before pressing Run — and
 * two copies would have drifted the first time either grew a field.
 */
export function CommandNote({
  badges,
  note,
}: {
  badges: readonly WebCommandBadge[] | undefined;
  note: string | undefined;
}): JSX.Element | null {
  if ((badges === undefined || badges.length === 0) && note === undefined) return null;
  return (
    <div className={`cnote${badges?.includes("destructive") ? " danger" : ""}`}>
      <CommandBadges badges={badges} />
      {note ? <span>{note}</span> : null}
    </div>
  );
}

function NodeRow({
  node,
  depth,
  open,
  selectedPath,
  onToggle,
  onSelect,
}: {
  node: WebCommandNode;
  depth: number;
  open: ReadonlySet<string>;
  selectedPath: readonly string[];
  onToggle: (key: string) => void;
  onSelect: (node: WebCommandNode) => void;
}): JSX.Element {
  const key = node.path.join(".");
  const isOpen = open.has(key);

  if (node.children.length === 0) {
    const current = selectedPath.join(".") === key;
    return (
      <button
        className="cmd"
        aria-current={current}
        title={node.description}
        onClick={() => onSelect(node)}
      >
        <span className="cmd-n">{node.name}</span>
        <RunsMarker node={node} />
        <CommandBadges badges={node.badges} />
      </button>
    );
  }

  // Children live in their own box, indented and ruled down the left, so a leaf
  // that FOLLOWS a collapsed sub-group reads as the sub-group's sibling and not
  // as its child. Depth carried by padding alone could not say which it was.
  const children = isOpen ? (
    <div className="kids">
      {node.children.map((child) => (
        <NodeRow
          key={child.path.join(".")}
          node={child}
          depth={depth + 1}
          open={open}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  ) : null;

  return (
    <>
      {depth === 0 ? (
        <button
          className="grp-h"
          aria-current={selectedPath.join(".") === key}
          title={node.description}
          onClick={() => {
            onToggle(key);
            onSelect(node);
          }}
        >
          <span className="caret">{isOpen ? "▾" : "▸"}</span>
          <span>{node.name}</span>
        </button>
      ) : (
        <button
          className="cmd sub"
          aria-expanded={isOpen}
          aria-current={selectedPath.join(".") === key}
          title={node.description}
          // Opens the subtree AND selects the group, because a group is a page
          // now: it has no action to run, but it is where its own description
          // and its children's read at a width that fits them.
          onClick={() => {
            onToggle(key);
            onSelect(node);
          }}
        >
          <span className="caret">{isOpen ? "▾" : "▸"}</span>
          <span className="cmd-n">{node.name}</span>
          {/* A sub-group can itself be a member — `sync forms` is one step of
              `sync all` — and the marker has to survive the row being closed,
              which is exactly when nobody can see its `all` beneath it. */}
          <RunsMarker node={node} />
        </button>
      )}
      {children}
    </>
  );
}

/** The rail: the program's own tree, nested to whatever depth it has. */
export function CommandTree({
  nodes,
  open,
  selectedPath,
  onToggle,
  onSelect,
}: {
  nodes: readonly WebCommandNode[];
  open: ReadonlySet<string>;
  selectedPath: readonly string[];
  onToggle: (key: string) => void;
  onSelect: (node: WebCommandNode) => void;
}): JSX.Element {
  return (
    <nav className="tree">
      {nodes.map((node) => (
        <div className="grp" key={node.path.join(".")}>
          <NodeRow
            node={node}
            depth={0}
            open={open}
            selectedPath={selectedPath}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        </div>
      ))}
    </nav>
  );
}
