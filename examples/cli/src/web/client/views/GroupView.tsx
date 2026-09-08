/** @jsxImportSource preact */
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from "preact";
import type { WebCommandNode } from "../../commandTree";
import { CommandBadges, CommandNote, RunsMarker } from "./CommandTree";

/**
 * A group's own page: what it is, and what is under it.
 *
 * A group has no action — there is nothing to run and no form to fill — but it
 * is still a command with a description, and the rail is 266px wide and spends
 * that on names. Here every line reads at the width it was written for: the
 * group's own, and one per child, which is what the rail gave up to keep its
 * names legible.
 */
export function GroupView({
  node,
  onSelect,
}: {
  node: WebCommandNode;
  onSelect: (node: WebCommandNode) => void;
}): JSX.Element {
  return (
    <div className="wrap">
      {node.description ? <p className="lede">{node.description}</p> : null}
      <CommandNote badges={node.badges} note={node.note} />
      <h2 className="sec">
        {node.children.length} {node.children.length === 1 ? "command" : "commands"}
      </h2>
      <div className="card grouplist">
        {node.children.map((child) => (
          <button key={child.path.join(".")} className="cmd" onClick={() => onSelect(child)}>
            <span className="cmd-n">{child.name}</span>
            <span className="cmd-d">{child.description}</span>
            <RunsMarker node={child} />
            <CommandBadges badges={child.badges} />
          </button>
        ))}
      </div>
    </div>
  );
}
