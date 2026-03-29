/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCalls } from "@workglow/ai";

function parseFunctionGemmaArgumentValue(rawValue: string): unknown {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric) && /^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return numeric;
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to raw string.
    }
  }

  return trimmed;
}

function parseFunctionGemmaLooseObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return {};
  }

  const result: Record<string, unknown> = {};
  const pairs = inner.matchAll(/([A-Za-z0-9_]+)\s*:\s*('[^']*'|"[^"]*"|[^,}]+)/g);

  for (const [_, rawKey, rawValue] of pairs) {
    const key = rawKey.trim();
    const valueText = rawValue.trim().replace(/^'([^']*)'$/, '"$1"');
    result[key] = parseFunctionGemmaArgumentValue(valueText);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseFunctionGemmaToolCalls(responseText: string): ToolCalls {
  const matches = responseText.matchAll(
    /(?:<start_function_call>\s*)?call:([^{\s]+)\{([\s\S]*?)\}(?:\s*<end_function_call>)?/g
  );
  const toolCalls: ToolCalls = [];

  for (const [_, rawName, rawArgs] of matches) {
    const parsedInput: Record<string, unknown> = {};
    const argMatches = rawArgs.matchAll(
      /([A-Za-z0-9_]+)\s*:\s*(?:<escape>([\s\S]*?)<escape>|([^,}]+))/g
    );

    for (const [__, rawParamName, escapedValue, unescapedValue] of argMatches) {
      const paramName = rawParamName.trim();
      const valueText = (escapedValue ?? unescapedValue ?? "").trim();
      parsedInput[paramName] = parseFunctionGemmaArgumentValue(valueText);
    }

    toolCalls.push({
      id: `call_${toolCalls.length}`,
      name: rawName.trim(),
      input: parsedInput,
    });
  }

  if (toolCalls.length > 0) {
    return toolCalls;
  }

  const looseObject = parseFunctionGemmaLooseObject(responseText);
  if (!looseObject) {
    return [];
  }

  return [
    {
      id: "call_0",
      name: "",
      input: looseObject,
    },
  ];
}

/**
 * Parse tool calls from model-generated text.
 *
 * Many instruct models (Qwen, Llama, Hermes, etc.) emit tool calls in one of
 * these formats:
 *
 * 1. `<tool_call>{"name":"fn","arguments":{...}}</tool_call>` (Qwen/Hermes)
 * 2. Plain JSON objects with a "name" + "arguments" key
 * 3. `{"function":{"name":"fn","arguments":{...}}}`
 *
 * This function extracts all such tool calls from the raw response text
 * and returns both the cleaned text (with tool-call markup removed) and
 * the parsed ToolCall array.
 */
export function parseToolCallsFromText(responseText: string): {
  text: string;
  toolCalls: ToolCalls;
} {
  const functionGemmaCalls = parseFunctionGemmaToolCalls(responseText);
  if (functionGemmaCalls.length > 0) {
    const cleanedText = responseText
      .replace(
        /(?:<start_function_call>\s*)?call:[^{\s]+\{[\s\S]*?\}(?:\s*<end_function_call>)?/g,
        ""
      )
      .trim();
    return { text: cleanedText, toolCalls: functionGemmaCalls };
  }

  const toolCalls: ToolCalls = [];
  let callIndex = 0;
  let cleanedText = responseText;

  // Pattern 1: <tool_call>...</tool_call> blocks (Qwen, Hermes, etc.)
  const toolCallTagRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let tagMatch;
  while ((tagMatch = toolCallTagRegex.exec(responseText)) !== null) {
    try {
      const parsed = JSON.parse(tagMatch[1].trim());
      const id = `call_${callIndex++}`;
      toolCalls.push({
        id,
        name: parsed.name ?? parsed.function?.name ?? "",
        input: (parsed.arguments ??
          parsed.function?.arguments ??
          parsed.parameters ??
          {}) as Record<string, unknown>,
      });
    } catch {
      // Not valid JSON inside the tag, skip
    }
  }

  if (toolCalls.length > 0) {
    // Remove tool_call tags from the text output
    cleanedText = responseText.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
    return { text: cleanedText, toolCalls };
  }

  // Pattern 2: Use a brace-balanced scanner to correctly handle nested JSON objects.
  const jsonCandidates: Array<{ text: string; start: number; end: number }> = [];
  (function collectBalancedJsonBlocks(source: string) {
    const length = source.length;
    let i = 0;
    while (i < length) {
      if (source[i] !== "{") {
        i++;
        continue;
      }
      let depth = 1;
      let j = i + 1;
      let inString = false;
      let escape = false;
      while (j < length && depth > 0) {
        const ch = source[j];
        if (inString) {
          if (escape) {
            escape = false;
          } else if (ch === "\\") {
            escape = true;
          } else if (ch === '"') {
            inString = false;
          }
        } else {
          if (ch === '"') {
            inString = true;
          } else if (ch === "{") {
            depth++;
          } else if (ch === "}") {
            depth--;
          }
        }
        j++;
      }
      if (depth === 0) {
        jsonCandidates.push({ text: source.slice(i, j), start: i, end: j });
        i = j;
      } else {
        break;
      }
    }
  })(responseText);

  const matchedRanges: Array<{ start: number; end: number }> = [];
  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate.text);
      if (parsed.name && (parsed.arguments !== undefined || parsed.parameters !== undefined)) {
        const id = `call_${callIndex++}`;
        toolCalls.push({
          id,
          name: parsed.name as string,
          input: (parsed.arguments ?? parsed.parameters ?? {}) as Record<string, unknown>,
        });
        matchedRanges.push({ start: candidate.start, end: candidate.end });
      } else if (parsed.function?.name) {
        let functionArgs: unknown = parsed.function.arguments ?? {};
        if (typeof functionArgs === "string") {
          try {
            functionArgs = JSON.parse(functionArgs);
          } catch (innerError) {
            console.warn("Failed to parse tool call function.arguments as JSON", innerError);
            functionArgs = {};
          }
        }
        const id = `call_${callIndex++}`;
        toolCalls.push({
          id,
          name: parsed.function.name as string,
          input: (functionArgs ?? {}) as Record<string, unknown>,
        });
        matchedRanges.push({ start: candidate.start, end: candidate.end });
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  if (toolCalls.length > 0) {
    // Remove only the matched JSON portions, preserving surrounding text
    let result = "";
    let lastIndex = 0;
    for (const range of matchedRanges) {
      result += responseText.slice(lastIndex, range.start);
      lastIndex = range.end;
    }
    result += responseText.slice(lastIndex);
    cleanedText = result.trim();
  }

  return { text: cleanedText, toolCalls };
}

/**
 * State machine that filters `<tool_call>…</tool_call>` markup out of a
 * stream of text-delta tokens. Tokens that are clearly outside markup are
 * flushed immediately; tokens that *might* be the start of a tag are held
 * in a lookahead buffer until they can be disambiguated.
 *
 * This only handles the XML-tag pattern (Pattern 1 in parseToolCallsFromText).
 * Bare-JSON tool calls (Pattern 2) cannot be reliably detected token-by-token
 * and are still cleaned up via the post-hoc `parseToolCallsFromText` pass on
 * the finish event.
 */
export function createToolCallMarkupFilter(emit: (text: string) => void) {
  const OPEN_TAG = "<tool_call>";
  const CLOSE_TAG = "</tool_call>";

  /** "text" = normal output, "tag" = inside a tool_call block */
  let state: "text" | "tag" = "text";
  /** Buffered text that might be a partial tag prefix */
  let pending = "";

  function feed(token: string) {
    if (state === "tag") {
      // Inside a tool_call block — suppress everything until we see the close tag
      pending += token;
      const closeIdx = pending.indexOf(CLOSE_TAG);
      if (closeIdx !== -1) {
        // End of the tool_call block; resume normal output after the close tag
        const afterClose = pending.slice(closeIdx + CLOSE_TAG.length);
        pending = "";
        state = "text";
        if (afterClose.length > 0) {
          feed(afterClose);
        }
      }
      // else: still inside the tag block, keep suppressing
      return;
    }

    // state === "text"
    const combined = pending + token;

    // Check for a complete open tag
    const openIdx = combined.indexOf(OPEN_TAG);
    if (openIdx !== -1) {
      // Emit everything before the tag
      const before = combined.slice(0, openIdx);
      if (before.length > 0) {
        emit(before);
      }
      // Switch to tag state; feed the remainder (after the open tag) back through
      pending = "";
      state = "tag";
      const afterOpen = combined.slice(openIdx + OPEN_TAG.length);
      if (afterOpen.length > 0) {
        feed(afterOpen);
      }
      return;
    }

    // Check if the tail of `combined` could be the start of "<tool_call>"
    // e.g. combined ends with "<", "<t", "<to", ..., "<tool_call"
    let prefixLen = 0;
    for (let len = Math.min(combined.length, OPEN_TAG.length - 1); len >= 1; len--) {
      if (combined.endsWith(OPEN_TAG.slice(0, len))) {
        prefixLen = len;
        break;
      }
    }

    if (prefixLen > 0) {
      // The tail is ambiguous — hold it back, flush the rest
      const safe = combined.slice(0, combined.length - prefixLen);
      if (safe.length > 0) {
        emit(safe);
      }
      pending = combined.slice(combined.length - prefixLen);
    } else {
      // No ambiguity — flush everything
      if (combined.length > 0) {
        emit(combined);
      }
      pending = "";
    }
  }

  /** Flush any remaining buffered text (called when the stream ends). */
  function flush() {
    if (pending.length > 0 && state === "text") {
      emit(pending);
      pending = "";
    }
    // If state === "tag", the pending content is suppressed tool-call markup
    pending = "";
    state = "text";
  }

  return { feed, flush };
}
