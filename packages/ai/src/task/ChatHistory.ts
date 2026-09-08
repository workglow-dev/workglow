/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChatMessage } from "./ChatMessage";

/** Concatenates the text blocks of a message, ignoring every other block kind. */
function messageText(message: ChatMessage): string {
  return message.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Returns a copy of `history` that strict chat templates will accept.
 *
 * HuggingFace's `apply_chat_template` throws
 * `Conversation roles must alternate user/assistant/...` on consecutive user
 * messages, and this library ships the providers that hit it. A host driving a
 * multi-turn conversation reaches that state honestly: a turn stopped while the
 * model was still thinking leaves `[..., user]`, and the next thing the person
 * types makes it `user, user`.
 *
 * Consecutive user messages are merged into one so both texts still reach the
 * model. A `tool` result left without the assistant reply that would normally
 * follow it gets a neutral assistant bridge, since the same templates reject
 * `tool, user` for the same reason.
 *
 * Non-text blocks on a merged message are dropped: the merge exists to keep a
 * template from throwing, and an image cannot be concatenated into a string.
 * Callers who must preserve them should avoid producing the sequence instead.
 */
export function normalizeHistoryForModel(history: readonly ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of history) {
    const last = out[out.length - 1];
    if (message.role === "user" && last?.role === "user") {
      const previous = messageText(last);
      const next = messageText(message);
      const merged =
        previous.length > 0 && next.length > 0 ? `${previous}\n\n${next}` : previous + next;
      out[out.length - 1] = { role: "user", content: [{ type: "text", text: merged }] };
      continue;
    }
    if (message.role === "user" && last?.role === "tool") {
      out.push({ role: "assistant", content: [{ type: "text", text: "Acknowledged." }] });
    }
    out.push(message);
  }
  return out;
}

/**
 * Default character budget for a message list handed to a model.
 *
 * Characters rather than tokens on purpose: this module has no tokenizer and a
 * wrong tokenizer is worse than an honest approximation. Size it well under the
 * context window it is protecting.
 */
export const DEFAULT_MAX_HISTORY_CHARS = 120_000;

function messageChars(message: ChatMessage): number {
  try {
    return JSON.stringify(message).length;
  } catch {
    return 0;
  }
}

/**
 * Caps `history` at `max` characters by dropping whole turns from the front.
 *
 * A turn starts at a `user` message and owns every assistant and tool message
 * after it, so cutting only at those boundaries keeps each `tool_result` with
 * the `tool_use` it answers — providers reject a `tool_result` whose `tool_use`
 * is missing, which is a harder failure than being over budget.
 *
 * The newest turn is kept even when it alone exceeds the budget: there would
 * otherwise be nothing for the model to answer, and silently returning an empty
 * list turns "this turn is too long" into "the conversation is gone".
 */
export function trimHistoryForModel(
  history: readonly ChatMessage[],
  max: number = DEFAULT_MAX_HISTORY_CHARS
): ChatMessage[] {
  const sizes = history.map(messageChars);
  let total = sizes.reduce((sum, n) => sum + n, 0);
  if (total <= max) return [...history];

  const turnStarts: number[] = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i]?.role === "user") turnStarts.push(i);
  }

  let cut = 0;
  for (const start of turnStarts.slice(1)) {
    for (let i = cut; i < start; i++) total -= sizes[i] ?? 0;
    cut = start;
    if (total <= max) break;
  }
  return history.slice(cut);
}
