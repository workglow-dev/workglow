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
 * Repairs a stored conversation whose tool-call ids are not unique — one
 * written before the caller started uniquifying them, say.
 *
 * The k-th occurrence of an id becomes `<id>_<k>` consistently across
 * `tool_use` and `tool_result` blocks. The two are paired by occurrence order
 * rather than by matching ids, which is what keeps a pair together: within one
 * conversation the n-th `tool_result` for an id answers the n-th `tool_use` of
 * it, because a round's results are appended after its calls.
 *
 * An already-unique history passes through with only shallow copies.
 */
export function repairDuplicateToolCallIds(history: readonly ChatMessage[]): ChatMessage[] {
  const useSeen = new Map<string, number>();
  const resultSeen = new Map<string, number>();
  return history.map((message) => {
    if (message.role === "assistant") {
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === "tool_use"
            ? ({
                ...block,
                id: renameForOccurrence(useSeen, block.id),
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
                tool_use_id: renameForOccurrence(resultSeen, block.tool_use_id),
              } satisfies ContentBlockToolResult)
            : block
        ),
      };
    }
    return message;
  });
}
