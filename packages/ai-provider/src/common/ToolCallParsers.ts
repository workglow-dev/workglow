/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCalls } from "@workglow/ai";

// ============================================================================
// Types
// ============================================================================

export interface ToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly id: string | null;
}

export interface ToolCallParserResult {
  readonly tool_calls: ReadonlyArray<ToolCall>;
  readonly content: string;
  readonly parser: string;
}

export interface ParseToolCallsOptions {
  readonly tokenizer?: TokenizerLike | null;
  readonly model?: string | null;
  readonly parser?: string | null;
}

/**
 * Minimal tokenizer shape used for model-family detection.
 * Compatible with `PreTrainedTokenizer` from `@huggingface/transformers`.
 */
export interface TokenizerLike {
  readonly config?: {
    readonly name_or_path?: string;
    readonly _name_or_path?: string;
    readonly model_type?: string;
  };
  readonly name_or_path?: string;
}

export type ParserFn = (text: string) => ToolCallParserResult | null;

// ============================================================================
// Text cleanup
// ============================================================================

/**
 * Strip thinking blocks (`<think>...</think>`) and HFT special tokens
 * (`<|im_end|>`, `<|end_of_turn|>`, etc.) from model output.
 * Used to clean up content text returned alongside tool calls.
 */
export function stripModelArtifacts(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\|[a-z_]+\|>/g, "")
    .trim();
}

// ============================================================================
// Shared helpers
// ============================================================================

export function makeToolCall(
  name: string,
  args: Record<string, unknown>,
  id: string | null = null
): ToolCall {
  return { name, arguments: args, id };
}

export function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function parseJsonToolCallArray(
  jsonStr: string,
  nameKey: string = "name",
  argsKeys: ReadonlyArray<string> = ["arguments", "parameters"]
): ReadonlyArray<ToolCall> | undefined {
  const parsed = tryParseJson(jsonStr.trim());
  if (!parsed) return undefined;

  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const calls = arr
    .filter(
      (c): c is Record<string, unknown> =>
        !!c && typeof c === "object" && !!(c as Record<string, unknown>)[nameKey]
    )
    .map((c) => {
      const args = argsKeys.reduce<Record<string, unknown> | undefined>(
        (found, key) => found ?? (c[key] as Record<string, unknown> | undefined),
        undefined
      );
      return makeToolCall(c[nameKey] as string, args ?? {}, (c.id as string | null) ?? null);
    });

  return calls.length > 0 ? calls : undefined;
}

/**
 * Parse key=value argument syntax used by Gorilla, NexusRaven, and Gemma.
 * Handles quoted strings (`"val"`, `'val'`) and bare values.
 */
export function parseKeyValueArgs(argsStr: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (!argsStr) return args;

  const argRegex = /(\w+)\s*=\s*(?:"([^"]*?)"|'([^']*?)'|(\S+?))\s*(?:,|$)/g;
  let match: RegExpExecArray | null;
  while ((match = argRegex.exec(argsStr)) !== null) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    args[key] = coerceArgValue(value);
  }
  return args;
}

export function coerceArgValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !isNaN(Number(value))) return Number(value);
  return value;
}

/**
 * Richer value coercion for FunctionGemma-style arguments.
 * Superset of {@link coerceArgValue}: also handles JSON-quoted strings,
 * objects, and arrays.
 */
export function parseFunctionGemmaArgumentValue(rawValue: string): unknown {
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

/**
 * Parse a loose `{key: value, ...}` object that may not be valid JSON.
 * Used as a FunctionGemma fallback when models emit partial syntax.
 */
export function parseFunctionGemmaLooseObject(
  text: string
): Record<string, unknown> | undefined {
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

// ============================================================================
// Individual parsers for each model family
// ============================================================================

/**
 * Llama 3.1/3.2/3.3 (Meta)
 *
 * Formats:
 * - `<|python_tag|>{"name": "func", "parameters": {"arg": "val"}}`
 * - `<function=func>{"arg": "val"}</function>` (3.2 lightweight 1B/3B)
 * - `{"name": "func", "parameters": {...}}` (bare JSON)
 */
export const parseLlama: ParserFn = (text) => {
  const calls: ToolCall[] = [];
  let content = text;

  // Try <|python_tag|> format first
  const pythonTagMatch = text.match(/<\|python_tag\|>([\s\S]*?)(?:<\|eot_id\|>|<\|eom_id\|>|$)/);
  if (pythonTagMatch) {
    content = text.slice(0, text.indexOf("<|python_tag|>")).trim();
    const jsonSection = pythonTagMatch[1].trim();
    for (const line of jsonSection.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = tryParseJson(trimmed) as Record<string, unknown> | undefined;
      if (parsed?.name) {
        calls.push(
          makeToolCall(
            parsed.name as string,
            (parsed.parameters ?? parsed.arguments ?? {}) as Record<string, unknown>,
            (parsed.id as string | null) ?? null
          )
        );
      }
    }
  }

  // Try <function=name>{args}</function> format (Llama 3.2 lightweight 1B/3B)
  if (calls.length === 0) {
    const funcTagRegex = /<function=(\w+)>([\s\S]*?)<\/function>/g;
    let funcMatch: RegExpExecArray | null;
    while ((funcMatch = funcTagRegex.exec(text)) !== null) {
      const args = tryParseJson(funcMatch[2].trim()) as Record<string, unknown> | undefined;
      if (args) {
        calls.push(makeToolCall(funcMatch[1], args));
      }
    }
    if (calls.length > 0) {
      content = text.replace(/<function=\w+>[\s\S]*?<\/function>/g, "").trim();
    }
  }

  // Check for {"name":...} pattern at end of output (no python_tag)
  if (calls.length === 0) {
    const jsonPattern = /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"(?:parameters|arguments)"\s*:\s*\{[\s\S]*?\}\s*\}/g;
    let match: RegExpExecArray | null;
    while ((match = jsonPattern.exec(text)) !== null) {
      const parsed = tryParseJson(match[0]) as Record<string, unknown> | undefined;
      if (parsed) {
        calls.push(
          makeToolCall(
            parsed.name as string,
            (parsed.parameters ?? parsed.arguments ?? {}) as Record<string, unknown>,
            (parsed.id as string | null) ?? null
          )
        );
      }
    }
    if (calls.length > 0) {
      content = text.slice(0, text.indexOf(calls[0].name) - '{"name": "'.length).trim();
    }
  }

  return calls.length > 0 ? { tool_calls: calls, content, parser: "llama" } : null;
};

/**
 * Mistral / Mixtral (Mistral AI)
 *
 * Format: `[TOOL_CALLS] [{"name": "func", "arguments": {...}, "id": "9charID"}]`
 */
export const parseMistral: ParserFn = (text) => {
  const marker = "[TOOL_CALLS]";
  const idx = text.indexOf(marker);
  if (idx === -1) return null;

  const content = text.slice(0, idx).trim();
  const jsonStr = text.slice(idx + marker.length).trim();
  const calls = parseJsonToolCallArray(jsonStr);

  return calls ? { tool_calls: calls, content, parser: "mistral" } : null;
};

/**
 * Hermes (NousResearch) — also used by Qwen 2.5, Qwen 3, SOLAR, and others
 *
 * Format: `<tool_call>\n{"name": "func", "arguments": {...}}\n</tool_call>`
 */
export const parseHermes: ParserFn = (text) => {
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const parsed = tryParseJson(match[1].trim()) as Record<string, unknown> | undefined;
    if (parsed) {
      calls.push(
        makeToolCall(
          (parsed.name ?? "") as string,
          (parsed.arguments ?? parsed.parameters ?? {}) as Record<string, unknown>,
          (parsed.id as string | null) ?? null
        )
      );
    }
  }

  if (calls.length === 0) return null;

  const content = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
  return { tool_calls: calls, content, parser: "hermes" };
};

/**
 * Cohere Command-R / Command-R+
 *
 * Formats:
 * - `Action: ```json\n[{"tool_name": "func", "parameters": {...}}]\n````
 * - `Action: [{"tool_name": ..., "parameters": ...}]`
 */
export const parseCohere: ParserFn = (text) => {
  const blockMatch = text.match(/Action:\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const inlineMatch = text.match(/Action:\s*(\[[\s\S]*?\])\s*$/m);

  const jsonStr = blockMatch?.[1] ?? inlineMatch?.[1];
  if (!jsonStr) return null;

  const calls = parseJsonToolCallArray(jsonStr, "tool_name", ["parameters", "arguments"]);
  if (!calls) {
    // Retry with "name" key
    const fallbackCalls = parseJsonToolCallArray(jsonStr);
    if (!fallbackCalls) return null;

    const actionIdx = text.indexOf("Action:");
    const content = text.slice(0, actionIdx).trim();
    return { tool_calls: fallbackCalls, content, parser: "cohere" };
  }

  const actionIdx = text.indexOf("Action:");
  const content = text.slice(0, actionIdx).trim();
  return { tool_calls: calls, content, parser: "cohere" };
};

/**
 * DeepSeek V2/V3/V3.1
 *
 * V2 format: `<｜tool▁call▁begin｜>function_name\n```json\n{...}\n```<｜tool▁call▁end｜>`
 * V3.1 format: `<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>name<｜tool▁sep｜>{args}<｜tool▁call▁end｜><｜tool▁calls▁end｜>`
 */
export const parseDeepSeek: ParserFn = (text) => {
  const calls: ToolCall[] = [];

  // Helper to match both fullwidth ｜ and ASCII | bar variants, and ▁ or space
  const bar = "(?:｜|\\|)";
  const sep = "[\\s\u2581]";

  // Try V3.1 format first: name<｜tool▁sep｜>{args}
  const v31Regex = new RegExp(
    `<${bar}tool${sep}call${sep}begin${bar}>\\s*(\\w+)\\s*<${bar}tool${sep}sep${bar}>\\s*([\\s\\S]*?)\\s*<${bar}tool${sep}call${sep}end${bar}>`,
    "g"
  );
  let match: RegExpExecArray | null;
  while ((match = v31Regex.exec(text)) !== null) {
    const args = tryParseJson(match[2].trim()) as Record<string, unknown> | undefined;
    if (args) {
      calls.push(makeToolCall(match[1], args));
    }
  }

  // Try V2 format: name\n```json\n{args}\n```
  if (calls.length === 0) {
    const v2Regex = new RegExp(
      `<${bar}tool${sep}call${sep}begin${bar}>\\s*(\\w+)\\s*\\n\`\`\`(?:json)?\\n([\\s\\S]*?)\\n\`\`\`\\s*<${bar}tool${sep}call${sep}end${bar}>`,
      "g"
    );
    while ((match = v2Regex.exec(text)) !== null) {
      const args = tryParseJson(match[2].trim()) as Record<string, unknown> | undefined;
      if (args) {
        calls.push(makeToolCall(match[1], args));
      }
    }
  }

  if (calls.length === 0) return null;

  const content = text
    .replace(new RegExp(`<${bar}tool${sep}calls?${sep}(?:begin|end)${bar}>`, "g"), "")
    .replace(
      new RegExp(
        `<${bar}tool${sep}call${sep}(?:begin|end)${bar}>[\\s\\S]*?<${bar}tool${sep}call${sep}end${bar}>`,
        "g"
      ),
      ""
    )
    .replace(new RegExp(`<${bar}tool${sep}sep${bar}>`, "g"), "")
    .trim();
  return { tool_calls: calls, content, parser: "deepseek" };
};

/**
 * Phi-4 / Phi-4-mini (Microsoft)
 *
 * Format: `<|tool_calls|>[{"name": "func", "arguments": {...}}]<|/tool_calls|>`
 */
export const parsePhi: ParserFn = (text) => {
  const match = text.match(/<\|tool_calls\|>\s*([\s\S]*?)\s*<\|\/tool_calls\|>/);
  if (!match) return null;

  const calls = parseJsonToolCallArray(match[1]);
  if (!calls) return null;

  const content = text.slice(0, text.indexOf("<|tool_calls|>")).trim();
  return { tool_calls: calls, content, parser: "phi" };
};

/**
 * Phi-3 functools format (legacy)
 *
 * Format: `functools[{"name": "func", "arguments": {...}}]`
 */
export const parsePhiFunctools: ParserFn = (text) => {
  const match = text.match(/functools\s*(\[[\s\S]*?\])/);
  if (!match) return null;

  const calls = parseJsonToolCallArray(match[1]);
  if (!calls) return null;

  const content = text.slice(0, text.indexOf("functools")).trim();
  return { tool_calls: calls, content, parser: "phi_functools" };
};

/**
 * InternLM 2 / 2.5 (Shanghai AI Lab)
 *
 * Format: `<|action_start|><|plugin|>\n{"name": "func", "parameters": {...}}<|action_end|>`
 */
export const parseInternLM: ParserFn = (text) => {
  const regex = /<\|action_start\|>\s*<\|plugin\|>\s*([\s\S]*?)\s*<\|action_end\|>/g;
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const parsed = tryParseJson(match[1].trim()) as Record<string, unknown> | undefined;
    if (parsed) {
      calls.push(
        makeToolCall(
          (parsed.name ?? "") as string,
          (parsed.parameters ?? parsed.arguments ?? {}) as Record<string, unknown>,
          (parsed.id as string | null) ?? null
        )
      );
    }
  }

  if (calls.length === 0) return null;

  const content = text
    .replace(/<\|action_start\|>\s*<\|plugin\|>[\s\S]*?<\|action_end\|>/g, "")
    .trim();
  return { tool_calls: calls, content, parser: "internlm" };
};

/**
 * ChatGLM / GLM-4 (Zhipu AI)
 *
 * Format: function name followed by newline and JSON arguments.
 * `func_name\n{"arg": "val"}`
 */
export const parseChatGLM: ParserFn = (text) => {
  const match = text.match(/^(\w+)\n(\{[\s\S]*\})\s*$/m);
  if (!match) return null;

  const args = tryParseJson(match[2].trim()) as Record<string, unknown> | undefined;
  if (!args) return null;

  return {
    tool_calls: [makeToolCall(match[1], args)],
    content: "",
    parser: "chatglm",
  };
};

/**
 * Functionary (MeetKai)
 *
 * Format: `>>>func_name\n{"arg": "val"}`
 * Uses `all` as a special function name for regular text.
 */
export const parseFunctionary: ParserFn = (text) => {
  const regex = />>>\s*(\w+)\s*\n([\s\S]*?)(?=>>>|$)/g;
  const calls: ToolCall[] = [];
  let content = "";
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const funcName = match[1].trim();
    const body = match[2].trim();

    if (funcName === "all") {
      content += body;
      continue;
    }

    const args = tryParseJson(body) as Record<string, unknown> | undefined;
    calls.push(makeToolCall(funcName, args ?? { content: body }));
  }

  if (calls.length === 0) return null;
  return { tool_calls: calls, content: content.trim(), parser: "functionary" };
};

/**
 * Gorilla (Berkeley)
 *
 * Format: `<<function>>func_name(arg1="val1", arg2=val2)`
 */
export const parseGorilla: ParserFn = (text) => {
  const regex = /<<function>>\s*(\w+)\(([^)]*)\)/g;
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    calls.push(makeToolCall(match[1], parseKeyValueArgs(match[2].trim())));
  }

  if (calls.length === 0) return null;

  const content = text.replace(/<<function>>\s*\w+\([^)]*\)/g, "").trim();
  return { tool_calls: calls, content, parser: "gorilla" };
};

/**
 * NexusRaven (Nexusflow)
 *
 * Format: `Call: func_name(arg1="val1", arg2=val2)\nThought: reasoning...`
 */
export const parseNexusRaven: ParserFn = (text) => {
  const regex = /Call:\s*(\w+)\(([^)]*)\)/g;
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    calls.push(makeToolCall(match[1], parseKeyValueArgs(match[2].trim())));
  }

  if (calls.length === 0) return null;

  const thoughtMatch = text.match(/Thought:\s*([\s\S]*?)(?:Call:|$)/);
  const content = thoughtMatch?.[1]?.trim() ?? text.replace(/Call:\s*\w+\([^)]*\)/g, "").trim();
  return { tool_calls: calls, content, parser: "nexusraven" };
};

/**
 * xLAM (Salesforce)
 *
 * Format: Raw JSON array of tool calls: `[{"name": "func", "arguments": {...}}]`
 * May be wrapped in ```json code blocks.
 */
export const parseXLAM: ParserFn = (text) => {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?(\[[\s\S]*?\])\n?\s*```/);
  const jsonStr = codeBlockMatch?.[1] ?? text.trim();

  if (!jsonStr.trimStart().startsWith("[")) return null;

  const calls = parseJsonToolCallArray(jsonStr);
  if (!calls) return null;

  const content = codeBlockMatch ? text.slice(0, text.indexOf("```")).trim() : "";
  return { tool_calls: calls, content, parser: "xlam" };
};

/**
 * FireFunction (Fireworks AI)
 *
 * Format: `{"tool_calls": [{"function": {"name": "...", "arguments": "..."}}]}`
 */
export const parseFireFunction: ParserFn = (text) => {
  const openaiMatch = text.match(/\{"tool_calls"\s*:\s*(\[[\s\S]*?\])\s*\}/);
  if (!openaiMatch) return null;

  const parsed = tryParseJson(openaiMatch[1]) as Array<Record<string, unknown>> | undefined;
  if (!parsed || !Array.isArray(parsed)) return null;

  const calls: ToolCall[] = [];
  for (const c of parsed) {
    const fn = c.function as Record<string, unknown> | undefined;
    if (!fn?.name) continue;

    let args = fn.arguments ?? {};
    if (typeof args === "string") {
      args = tryParseJson(args) ?? {};
    }
    calls.push(
      makeToolCall(
        fn.name as string,
        args as Record<string, unknown>,
        (c.id as string | null) ?? null
      )
    );
  }

  return calls.length > 0 ? { tool_calls: calls, content: "", parser: "firefunction" } : null;
};

/**
 * Granite (IBM)
 *
 * Format: `<|tool_call|>{"name": "func", "arguments": {...}}<|/tool_call|>` or `<|end_of_text|>`
 */
export const parseGranite: ParserFn = (text) => {
  const regex = /<\|tool_call\|>\s*([\s\S]*?)\s*(?:<\|\/tool_call\|>|<\|end_of_text\|>|$)/g;
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const parsed = tryParseJson(match[1].trim()) as Record<string, unknown> | undefined;
    if (parsed) {
      calls.push(
        makeToolCall(
          (parsed.name ?? "") as string,
          (parsed.arguments ?? parsed.parameters ?? {}) as Record<string, unknown>,
          (parsed.id as string | null) ?? null
        )
      );
    }
  }

  if (calls.length === 0) return null;

  const content = text.replace(/<\|tool_call\|>[\s\S]*?(?:<\|\/tool_call\|>|$)/g, "").trim();
  return { tool_calls: calls, content, parser: "granite" };
};

/**
 * Gemma 2/3 (Google) — prompt-based, no dedicated tokens
 *
 * Formats:
 * - ```tool_code\nfunc(arg=val)\n```
 * - `{"name": "func", "parameters": {...}}`
 */
export const parseGemma: ParserFn = (text) => {
  const codeMatch = text.match(/```tool_code\s*\n([\s\S]*?)\n\s*```/);
  if (!codeMatch) return null;

  const code = codeMatch[1].trim();
  const funcMatch = code.match(/^(\w+)\(([\s\S]*)\)$/);
  if (!funcMatch) return null;

  const content = text.replace(/```tool_code[\s\S]*?```/g, "").trim();
  return {
    tool_calls: [makeToolCall(funcMatch[1], parseKeyValueArgs(funcMatch[2].trim()))],
    content,
    parser: "gemma",
  };
};

/**
 * Parse FunctionGemma-style arguments from the captured string between braces.
 * Handles both `<escape>` delimited and plain `key:value` formats, with a
 * JSON fallback for more complex values.
 */
function parseFunctionGemmaArgs(argsStr: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (!argsStr.trim()) return args;

  // Try <escape>-delimited format first: key:<escape>value<escape>
  const escapeRegex = /([A-Za-z0-9_]+)\s*:\s*<escape>([\s\S]*?)<escape>/g;
  let escapeMatch: RegExpExecArray | null;
  while ((escapeMatch = escapeRegex.exec(argsStr)) !== null) {
    args[escapeMatch[1]] = coerceArgValue(escapeMatch[2]);
  }
  if (Object.keys(args).length > 0) return args;

  // Try plain key:value format (no escape tags): key:value separated by commas
  // Also handles cases where the model generates only a single <escape> tag
  const plainRegex =
    /([A-Za-z0-9_]+)\s*:\s*(?:'([^']*)'|"([^"]*)"|((?:(?![,}]\s*[A-Za-z0-9_]+\s*:)[^,}])+))/g;
  let plainMatch: RegExpExecArray | null;
  while ((plainMatch = plainRegex.exec(argsStr)) !== null) {
    const key = plainMatch[1].trim();
    const value = (plainMatch[2] ?? plainMatch[3] ?? plainMatch[4] ?? "")
      .replace(/<escape>/g, "")
      .trim();
    args[key] = parseFunctionGemmaArgumentValue(value);
  }
  if (Object.keys(args).length > 0) return args;

  // Fallback: try JSON.parse on {argsStr}
  const jsonResult = tryParseJson(`{${argsStr}}`) as Record<string, unknown> | undefined;
  if (jsonResult && typeof jsonResult === "object") return jsonResult;

  return args;
}

/**
 * FunctionGemma (Google, specialized 270M model)
 *
 * Format: `<start_function_call>call:func_name{key:<escape>value<escape>}<end_function_call>`
 * Also handles variants without `<end_function_call>` (e.g., `<end_of_turn>`).
 */
export const parseFunctionGemma: ParserFn = (text) => {
  // Match with explicit end tag. Allow:
  // - Optional <start_function_call> wrapper
  // - `call:name{args}` or just `:name{args}` (model may omit `call` prefix)
  // - Optional whitespace/newlines between name and `{`
  const regex =
    /(?:<start_function_call>\s*)?call:([^{\s]+)\s*\{([\s\S]*?)\}(?:\s*<end_function_call>)?/g;
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    calls.push(makeToolCall(match[1].trim(), parseFunctionGemmaArgs(match[2])));
  }

  // Fallback: handle missing `call` prefix (`:name{args}` at start of text)
  if (calls.length === 0) {
    const fallbackRegex = /^:([A-Za-z_]\w*)\s*\{([\s\S]*?)\}$/;
    const fallbackMatch = text.trim().match(fallbackRegex);
    if (fallbackMatch) {
      calls.push(makeToolCall(fallbackMatch[1].trim(), parseFunctionGemmaArgs(fallbackMatch[2])));
    }
  }

  if (calls.length === 0) return null;

  const content = text
    .replace(
      /(?:<start_function_call>\s*)?(?:call)?:([A-Za-z_]\w*)\s*\{[\s\S]*?\}(?:\s*<end_function_call>)?/g,
      ""
    )
    .trim();
  return { tool_calls: calls, content, parser: "functiongemma" };
};

/**
 * Parse Liquid/LFM-style Pythonic function call arguments.
 * Handles both `key=val, key2=val2` and `params=JSON` patterns.
 * When a single `params` argument contains a JSON object, spreads it.
 */
function parseLiquidArgs(argsStr: string): Record<string, unknown> {
  const trimmed = argsStr.trim();

  // Try params=JSON pattern: params={"key": "val", ...} or params={'key': 'val', ...}
  const paramsMatch = trimmed.match(/^params\s*=\s*(\{[\s\S]*\})$/);
  if (paramsMatch) {
    const jsonStr = paramsMatch[1].replace(/'/g, '"');
    const parsed = tryParseJson(jsonStr) as Record<string, unknown> | undefined;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }

  // Try bare JSON object: { key: "val", ... } (JS-style, keys may be unquoted)
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    // Add quotes around unquoted keys for JSON.parse
    const jsonified = trimmed.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
    const parsed = tryParseJson(jsonified) as Record<string, unknown> | undefined;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }

  // Fall back to key=value parsing
  return parseKeyValueArgs(argsStr);
}

/**
 * Extract Pythonic function calls from text: `func_name(args)` or `[func(args)]`.
 * Handles balanced parentheses so JSON in args doesn't break matching.
 */
function extractPythonicCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const startRegex = /(\w+)\(/g;
  let startMatch: RegExpExecArray | null;
  while ((startMatch = startRegex.exec(text)) !== null) {
    const funcName = startMatch[1];
    const argsStart = startMatch.index + startMatch[0].length;
    // Balance parentheses to find the closing )
    let depth = 1;
    let i = argsStart;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    if (depth === 0) {
      const argsStr = text.slice(argsStart, i - 1);
      calls.push(makeToolCall(funcName, parseLiquidArgs(argsStr)));
      // Advance regex scanning position past this complete call to avoid matching inside args
      startRegex.lastIndex = i;
    }
  }
  return calls;
}

/**
 * LiquidAI LFM / LFM2 / LFM2.5
 *
 * Formats:
 * - `<|tool_call_start|>[func_name(key="value", key2=123)]<|tool_call_end|>`
 * - `[func_name(params={"key": "val"})]` (bracket-only, no special tokens)
 * Parallel calls: `<|tool_call_start|>[func1(a="b"), func2(c="d")]<|tool_call_end|>`
 * Uses Pythonic function call syntax.
 */
export const parseLiquid: ParserFn = (text) => {
  // Try special token format first
  const specialMatch = text.match(/<\|tool_call_start\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>/);
  if (specialMatch) {
    const inner = specialMatch[1].trim();
    const unwrapped = inner.startsWith("[") && inner.endsWith("]") ? inner.slice(1, -1) : inner;
    const calls = extractPythonicCalls(unwrapped);
    if (calls.length > 0) {
      const content = stripModelArtifacts(
        text.replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g, "")
      );
      return { tool_calls: calls, content, parser: "liquid" };
    }
  }

  // Try bracket-only format: [func(args)] without special tokens
  const bracketRegex = /\[(\w+\([^)]*(?:\([^)]*\))*[^)]*\))\]/g;
  const bracketCalls: ToolCall[] = [];
  let bracketMatch: RegExpExecArray | null;
  while ((bracketMatch = bracketRegex.exec(text)) !== null) {
    const inner = bracketMatch[1];
    const calls = extractPythonicCalls(inner);
    bracketCalls.push(...calls);
  }

  if (bracketCalls.length > 0) {
    const content = stripModelArtifacts(
      text.replace(/\[\w+\([^)]*(?:\([^)]*\))*[^)]*\)\]/g, "")
    );
    return { tool_calls: bracketCalls, content, parser: "liquid" };
  }

  // Try ||Call: format (LFM2 text-based variant): ||Call: func_name(args)
  const callPrefixRegex = /\|?\|?Call:\s*/g;
  let callPrefixMatch: RegExpExecArray | null;
  const callCalls: ToolCall[] = [];
  while ((callPrefixMatch = callPrefixRegex.exec(text)) !== null) {
    const afterPrefix = text.slice(callPrefixMatch.index + callPrefixMatch[0].length);
    const calls = extractPythonicCalls(afterPrefix);
    if (calls.length > 0) {
      callCalls.push(calls[0]);
    }
  }

  if (callCalls.length > 0) {
    const content = stripModelArtifacts(
      text.replace(/\|?\|?Call:\s*\w+\([^]*?\)/g, "")
    );
    return { tool_calls: callCalls, content, parser: "liquid" };
  }

  return null;
};

/**
 * Jamba (AI21)
 *
 * Format: `<tool_calls>[{"name": "func", "arguments": {...}}]</tool_calls>`
 * Also supports OpenAI-compatible format via FireFunction fallback.
 */
export const parseJamba: ParserFn = (text) => {
  const tagMatch = text.match(/<tool_calls>\s*([\s\S]*?)\s*<\/tool_calls>/);
  if (tagMatch) {
    const parsed = tryParseJson(tagMatch[1].trim());
    if (parsed) {
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const calls: ToolCall[] = [];
      for (const c of arr as Array<Record<string, unknown>>) {
        if (!c.name) continue;
        let args = c.arguments ?? c.parameters ?? {};
        if (typeof args === "string") {
          args = tryParseJson(args) ?? {};
        }
        calls.push(
          makeToolCall(
            c.name as string,
            args as Record<string, unknown>,
            (c.id as string | null) ?? null
          )
        );
      }
      if (calls.length > 0) {
        const content = text.slice(0, text.indexOf("<tool_calls>")).trim();
        return { tool_calls: calls, content, parser: "jamba" };
      }
    }
  }

  return parseFireFunction(text);
};

/**
 * Qwen 3.5 XML format
 *
 * Format:
 * ```
 * <tool_call>
 * <function=function_name>
 * <parameter=param_name>value</parameter>
 * ...
 * </function>
 * </tool_call>
 * ```
 *
 * The special `params` parameter may contain a JSON object to be spread
 * into the arguments.
 */
export const parseQwen35Xml: ParserFn = (text) => {
  const toolCallMatches = text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g);
  const calls: ToolCall[] = [];
  for (const [_, toolCallBody] of toolCallMatches) {
    const functionMatch = toolCallBody.match(/<function=([^>\n]+)>\s*([\s\S]*?)\s*<\/function>/);
    if (!functionMatch) {
      continue;
    }
    const [, rawName, functionBody] = functionMatch;
    const parsedInput: Record<string, unknown> = {};
    const parameterMatches = functionBody.matchAll(
      /<parameter=([^>\n]+)>\s*([\s\S]*?)\s*<\/parameter>/g
    );
    for (const [__, rawParamName, rawValue] of parameterMatches) {
      const paramName = rawParamName.trim();
      const valueText = rawValue.trim();
      if (paramName === "params") {
        try {
          const parsedValue = JSON.parse(valueText);
          if (parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
            Object.assign(parsedInput, parsedValue);
            continue;
          }
        } catch {
          // Fall back to keeping the raw string.
        }
      }
      parsedInput[paramName] = valueText;
    }
    calls.push(makeToolCall(rawName.trim(), parsedInput));
  }

  if (calls.length === 0) return null;

  const content = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
  return { tool_calls: calls, content, parser: "qwen35xml" };
};

// ============================================================================
// Model family detection
// ============================================================================

const MODEL_PARSERS: Record<string, ReadonlyArray<ParserFn>> = {
  llama: [parseLlama, parseHermes],
  mistral: [parseMistral, parseHermes],
  mixtral: [parseMistral, parseHermes],
  qwen: [parseHermes, parseLlama],
  qwen2: [parseHermes, parseLlama],
  qwen3: [parseHermes, parseQwen35Xml, parseLlama],
  qwen35: [parseQwen35Xml, parseHermes, parseLlama],
  cohere: [parseCohere, parseHermes],
  command: [parseCohere, parseHermes],
  deepseek: [parseDeepSeek, parseHermes],
  hermes: [parseHermes],
  phi: [parsePhi, parsePhiFunctools, parseHermes],
  internlm: [parseInternLM, parseHermes],
  chatglm: [parseChatGLM],
  glm: [parseChatGLM],
  functiongemma: [parseFunctionGemma, parseGemma, parseHermes],
  gemma: [parseFunctionGemma, parseGemma, parseHermes],
  functionary: [parseFunctionary],
  gorilla: [parseGorilla],
  nexusraven: [parseNexusRaven],
  xlam: [parseXLAM],
  firefunction: [parseFireFunction, parsePhiFunctools],
  granite: [parseGranite, parseHermes],
  solar: [parseHermes],
  jamba: [parseJamba, parseHermes],
  liquid: [parseLiquid, parseHermes],
  lfm: [parseLiquid, parseHermes],
  yi: [parseHermes, parseLlama],
  falcon: [parseHermes, parseLlama],
};

/**
 * Default parser chain used when the model family cannot be determined.
 * Ordered by specificity (most distinctive markers first).
 */
const DEFAULT_PARSER_CHAIN: ReadonlyArray<ParserFn> = [
  parsePhi,
  parseMistral,
  parseDeepSeek,
  parseInternLM,
  parseGranite,
  parseFunctionGemma,
  parseQwen35Xml,
  parseHermes,
  parseCohere,
  parseFunctionary,
  parseGorilla,
  parseNexusRaven,
  parseFireFunction,
  parsePhiFunctools,
  parseLiquid,
  parseLlama,
  parseGemma,
  parseXLAM,
];

/**
 * Detect the model family from a tokenizer instance or model name string.
 */
function detectModelFamily(tokenizerOrName: TokenizerLike | string | null): string | null {
  let name = "";

  if (typeof tokenizerOrName === "string") {
    name = tokenizerOrName.toLowerCase();
  } else if (tokenizerOrName) {
    const config = tokenizerOrName.config ?? {};
    name = (
      config.name_or_path ??
      config._name_or_path ??
      config.model_type ??
      tokenizerOrName.name_or_path ??
      ""
    ).toLowerCase();
  }

  if (!name) return null;

  for (const family of Object.keys(MODEL_PARSERS)) {
    if (name.includes(family)) {
      return family;
    }
  }

  return null;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse tool calls from LLM output text.
 *
 * Automatically detects the model family from the tokenizer and applies the
 * appropriate parser(s). Falls back to trying all known formats if the model
 * family cannot be determined.
 */
export function parseToolCalls(
  text: string,
  { tokenizer = null, model = null, parser = null }: ParseToolCallsOptions = {}
): ToolCallParserResult {
  if (!text || typeof text !== "string") {
    return { tool_calls: [], content: text ?? "", parser: "none" };
  }

  let parsersToTry: ReadonlyArray<ParserFn>;

  if (parser) {
    const key = parser.toLowerCase();
    const found = MODEL_PARSERS[key];
    if (!found) {
      throw new Error(
        `Unknown parser "${parser}". Available parsers: ${Object.keys(MODEL_PARSERS).join(", ")}`
      );
    }
    parsersToTry = found;
  } else {
    const family = detectModelFamily(tokenizer ?? model ?? null);
    parsersToTry = family ? MODEL_PARSERS[family]! : DEFAULT_PARSER_CHAIN;
  }

  for (const parserFn of parsersToTry) {
    const result = parserFn(text);
    if (result) return result;
  }

  return { tool_calls: [], content: text, parser: "none" };
}

/**
 * Check if text likely contains tool calls without fully parsing them.
 * Faster than `parseToolCalls` when you only need presence detection.
 */
export function hasToolCalls(text: string): boolean {
  if (!text) return false;
  return (
    text.includes("<tool_call>") ||
    text.includes("[TOOL_CALLS]") ||
    text.includes("<|python_tag|>") ||
    text.includes("<function=") ||
    text.includes("<|tool_calls|>") ||
    text.includes("<tool_calls>") ||
    text.includes("<|action_start|>") ||
    text.includes("<<function>>") ||
    text.includes(">>>") ||
    text.includes("Call:") ||
    text.includes("Action:") ||
    text.includes("functools") ||
    text.includes("<start_function_call>") ||
    text.includes("<|tool_call|>") ||
    text.includes("<|tool_call_start|>") ||
    /tool[\s\u2581]call[\s\u2581]begin/.test(text)
  );
}

/**
 * Get the list of available parser names.
 */
export function getAvailableParsers(): ReadonlyArray<string> {
  return Object.keys(MODEL_PARSERS);
}

/**
 * Get a model-family-specific generation prefix that guides the model to
 * produce tool calls. Appended to the prompt before generation and prepended
 * to the decoded output before parsing.
 *
 * @param family - The detected model family (from `getAvailableParsers` / `detectModelFamily`).
 * @param forcedToolName - When a specific tool is forced, include its name in the prefix.
 * @returns The prefix string, or `undefined` if no prefix is needed.
 */
export function getGenerationPrefix(
  family: string | null,
  forcedToolName: string | undefined
): string | undefined {
  if (!family) return undefined;

  switch (family) {
    case "functiongemma":
      return forcedToolName
        ? `<start_function_call>call:${forcedToolName}{`
        : "<start_function_call>call:";
    default:
      return undefined;
  }
}

// ============================================================================
// High-level parsing returning workglow ToolCalls type
// ============================================================================

/**
 * Parse tool calls from model-generated text, returning the workglow `ToolCalls`
 * type directly (with `input` field instead of `arguments`).
 *
 * Tries, in order:
 * 1. FunctionGemma `call:func{...}` syntax
 * 2. `<tool_call>JSON</tool_call>` tags (Qwen/Hermes)
 * 3. Bare JSON objects with `name` + `arguments`/`parameters` keys
 * 4. `{"function": {"name": ..., "arguments": ...}}` format
 *
 * Returns both the cleaned text (with tool-call markup removed) and the parsed
 * ToolCall array.
 */
export function parseToolCallsFromText(responseText: string): {
  text: string;
  toolCalls: ToolCalls;
} {
  // Try FunctionGemma first
  const functionGemmaResult = parseFunctionGemma(responseText);
  if (functionGemmaResult && functionGemmaResult.tool_calls.length > 0) {
    return {
      text: functionGemmaResult.content,
      toolCalls: functionGemmaResult.tool_calls.map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.name,
        input: call.arguments,
      })),
    };
  }

  // FunctionGemma loose-object fallback (no tool name context available)
  const looseObject = parseFunctionGemmaLooseObject(responseText);
  if (looseObject) {
    return {
      text: "",
      toolCalls: [{ id: "call_0", name: "", input: looseObject }],
    };
  }

  // Try Hermes/Qwen tag-based format
  const hermesResult = parseHermes(responseText);
  if (hermesResult && hermesResult.tool_calls.length > 0) {
    return {
      text: hermesResult.content,
      toolCalls: hermesResult.tool_calls.map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.name,
        input: call.arguments,
      })),
    };
  }

  // Fallback: brace-balanced scanner for bare JSON objects
  const toolCalls: ToolCalls = [];
  let callIndex = 0;

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
          } catch {
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

  let cleanedText = responseText;
  if (toolCalls.length > 0) {
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
