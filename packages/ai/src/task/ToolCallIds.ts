/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChatMessage, ContentBlockToolResult, ContentBlockToolUse } from "./ChatMessage";
import type { ToolCall } from "./ToolCallingUtils";

/**
 * Ids a model returns for tool calls are unique only within one model run.
 * Gemini synthesizes `call_0`, `call_1`, … from zero on every run, and the
 * provider's own message conversion already compensates by resolving each
 * `tool_result` against the most recent preceding `tool_use` with that id.
 *
 * That fixes what reaches the provider. It does not fix what a caller keeps:
 * a host running several rounds in one conversation holds every round's calls
 * in one list, and the second round collides with the first. The failure is
 * not a crash — patches land on the wrong entry, UI keys duplicate, and a
 * pending answer resolves the wrong call.
 *
 * These helpers make the ids durable on the caller's side. Ids are opaque to
 * providers, which rebuild their own id→name map from the messages each run,
 * so renaming both halves of a pair is invisible downstream.
 */

/** Every `tool_use` id already present in `history`. */
export function collectToolUseIds(history: readonly ChatMessage[]): Set<string> {
  const seen = new Set<string>();
  for (const message of history) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type === "tool_use") seen.add(block.id);
    }
  }
  return seen;
}

/**
 * Renames any call whose id is already in `seen`, so a round's ids stay unique
 * across the whole conversation. `seen` is not mutated.
 */
export function uniquifyToolCallIds(
  calls: readonly ToolCall[],
  seen: Iterable<string> = []
): ToolCall[] {
  const used = new Set(seen);
  return calls.map((call) => {
    if (!used.has(call.id)) {
      used.add(call.id);
      return call;
    }
    let suffix = 2;
    while (used.has(`${call.id}_${suffix}`)) suffix++;
    const renamed = { ...call, id: `${call.id}_${suffix}` };
    used.add(renamed.id);
    return renamed;
  });
}

function renameForOccurrence(seen: Map<string, number>, id: string): string {
  const occurrence = (seen.get(id) ?? 0) + 1;
  seen.set(id, occurrence);
  return occurrence === 1 ? id : `${id}_${occurrence}`;
}

/**
 * Tracks which renamed `tool_use` id each `tool_result` should answer.
 *
 * Counting the two sides independently only pairs them while every call has
 * exactly one result. A history holding a `tool_use` whose result never
 * arrived — an interrupted round, a turn stored before the dangling call was
 * dropped — puts the counters one apart, and from there every later result for
 * that id is renamed onto the wrong call.
 *
 * Results are matched against the calls of the most recent assistant message
 * that made any, because that is what a round is: an assistant turn asking for
 * tools, then the results answering it. A second assistant turn asking again
 * supersedes anything the first left unanswered.
 */
class ToolCallRenames {
  private readonly occurrences = new Map<string, number>();
  /** The newest rename minted for an id, whichever round made it. */
  private readonly latest = new Map<string, string>();
  private round = new Map<string, string[]>();

  /** A new assistant turn asked for tools; its calls are what results answer now. */
  beginRound(): void {
    this.round = new Map();
  }

  forToolUse(id: string): string {
    const renamed = renameForOccurrence(this.occurrences, id);
    this.latest.set(id, renamed);
    const queue = this.round.get(id);
    if (queue) queue.push(renamed);
    else this.round.set(id, [renamed]);
    return renamed;
  }

  /**
   * The rename of the oldest call in this round still unanswered.
   *
   * With none left — a second result for one call, in a history nothing else
   * would have produced — the newest rename for that id is the fallback. The
   * raw id looks like the safe answer and is the one wrong one: occurrence 1
   * keeps the id unchanged, so returning it silently re-answers the FIRST call
   * ever made with that id, several rounds back. An id never renamed at all is
   * its own latest, so the ordinary case is unaffected.
   */
  forToolResult(id: string): string {
    return this.round.get(id)?.shift() ?? this.latest.get(id) ?? id;
  }
}

/**
 * Repairs a stored conversation whose tool-call ids are not unique — one
 * written before the caller started uniquifying them, say.
 *
 * The k-th occurrence of an id becomes `<id>_<k>` consistently across
 * `tool_use` and `tool_result` blocks. A result takes the rename of the oldest
 * call with that id it has not answered yet, which is what keeps a pair
 * together even where a call has no result at all — within one conversation a
 * round's results are appended after its calls.
 *
 * An already-unique history passes through with only shallow copies.
 */
export function repairDuplicateToolCallIds(history: readonly ChatMessage[]): ChatMessage[] {
  const renames = new ToolCallRenames();
  return history.map((message) => {
    if (message.role === "assistant") {
      if (message.content.some((block) => block.type === "tool_use")) renames.beginRound();
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === "tool_use"
            ? ({
                ...block,
                id: renames.forToolUse(block.id),
              } satisfies ContentBlockToolUse)
            : block
        ),
      };
    }
    if (message.role === "tool") {
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === "tool_result"
            ? ({
                ...block,
                tool_use_id: renames.forToolResult(block.tool_use_id),
              } satisfies ContentBlockToolResult)
            : block
        ),
      };
    }
    return message;
  });
}
