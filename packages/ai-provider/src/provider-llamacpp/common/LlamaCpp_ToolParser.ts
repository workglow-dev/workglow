/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCallingTaskInput, ToolCalls, ToolDefinition } from "@workglow/ai";
import {
  parseFunctionGemma,
  parseFunctionGemmaLooseObject,
  parseHermes,
  parseLlama,
  parseLiquid,
  parseQwen35Xml,
  type ToolCallParserResult,
} from "../../common/ToolCallParsers";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";

// ============================================================================
// Model text candidates
// ============================================================================

export function getModelTextCandidates(model: LlamaCppModelConfig): string[] {
  return [
    model.model_id,
    model.title,
    model.description,
    model.provider_config.model_url,
    model.provider_config.model_path,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase());
}

// ============================================================================
// Tool choice utilities
// ============================================================================

export function toolChoiceForcesToolCall(toolChoice: ToolCallingTaskInput["toolChoice"]): boolean {
  return (
    toolChoice === "required" ||
    (toolChoice !== undefined && toolChoice !== "auto" && toolChoice !== "none")
  );
}

function forcedToolChoiceName(toolChoice: ToolCallingTaskInput["toolChoice"]): string | undefined {
  if (
    typeof toolChoice !== "string" ||
    toolChoice === "auto" ||
    toolChoice === "none" ||
    toolChoice === "required"
  ) {
    return undefined;
  }
  return toolChoice;
}

export function forcedToolSelection(input: ToolCallingTaskInput): string | undefined {
  const explicitToolName = forcedToolChoiceName(input.toolChoice);
  if (explicitToolName !== undefined) {
    return explicitToolName;
  }
  if (input.toolChoice === "required" && input.tools.length === 1) {
    return input.tools[0]?.name;
  }
  return undefined;
}

export function resolveParsedToolName(name: string, input: ToolCallingTaskInput): string {
  if (input.tools.some((tool) => tool.name === name)) {
    return name;
  }
  return forcedToolSelection(input) ?? name;
}

// ============================================================================
// FunctionGemma detection & prompt building
// ============================================================================

function detectFunctionGemmaModel(model: LlamaCppModelConfig): boolean {
  return getModelTextCandidates(model).some((value) => value.includes("functiongemma"));
}

function functionGemmaDeclarationSchema(schema: Record<string, unknown> | undefined): string {
  if (!schema) {
    return "{type: OBJECT}";
  }

  const type = typeof schema.type === "string" ? schema.type.toUpperCase() : "OBJECT";
  const description =
    typeof schema.description === "string" ? `description: ${schema.description} ,` : "";

  if (type === "OBJECT") {
    const properties =
      schema.properties && typeof schema.properties === "object"
        ? Object.entries(schema.properties as Record<string, unknown>)
            .map(([key, value]) => {
              const property = (value ?? {}) as Record<string, unknown>;
              const propertyType =
                typeof property.type === "string" ? property.type.toUpperCase() : "STRING";
              const propertyDescription =
                typeof property.description === "string"
                  ? `description: ${property.description} ,`
                  : "";
              return `${key}:{${propertyDescription}type: ${propertyType}}`;
            })
            .join(",")
        : "";
    const required = Array.isArray(schema.required) ? schema.required.join(",") : "";
    return `{${description}parameters:{properties:{${properties}},required:[${required}],type: OBJECT}}`;
  }

  return `{${description}type: ${type}}`;
}

function buildFunctionGemmaDeclarations(tools: ReadonlyArray<ToolDefinition>): string {
  return tools
    .map((tool) => {
      const description = tool.description?.trim() ?? "";
      return (
        `declaration:${tool.name}\n` +
        `{description: ${description} ,parameters:` +
        `${functionGemmaDeclarationSchema(tool.inputSchema as Record<string, unknown>).slice(1, -1)}}`
      );
    })
    .join("\n");
}

function buildFunctionGemmaDeveloperPrompt(
  baseSystemPrompt: string | undefined,
  required: boolean
): string {
  const lines = [
    baseSystemPrompt,
    "You are a model that can do function calling with the following functions",
    required ? "You must call at least one function from the provided list." : undefined,
    "If you call a function, output only the function call and nothing else.",
    "If tool results are already available and no further function call is needed, answer the user normally.",
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return lines.join("\n");
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return String(content ?? "");
  }
  return content
    .filter(
      (block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text"
    )
    .map((block) => String((block as { text?: unknown }).text ?? ""))
    .join("");
}

function serializeFunctionGemmaValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    Array.isArray(value) ||
    typeof value === "object"
  ) {
    return JSON.stringify(value);
  }
  return JSON.stringify(String(value));
}

function serializeFunctionGemmaToolCall(name: string, input: Record<string, unknown>): string {
  const args = Object.entries(input)
    .map(([key, value]) => `${key}:${serializeFunctionGemmaValue(value)}`)
    .join(",");
  return `call:${name}{${args}}`;
}

function buildFunctionGemmaConversationPrompt(input: ToolCallingTaskInput): string {
  if (!input.messages || input.messages.length === 0) {
    return String(input.prompt);
  }

  const turns: string[] = [];
  const toolNamesById = new Map<string, string>();

  for (const message of input.messages) {
    if (message.role === "user") {
      turns.push("user", extractMessageText(message.content));
      continue;
    }

    if (message.role === "assistant" && Array.isArray(message.content)) {
      const toolUses = message.content.filter(
        (
          block
        ): block is {
          type: "tool_use";
          id: string;
          name: string;
          input: Record<string, unknown>;
        } => block.type === "tool_use"
      );
      const serializedCalls = toolUses.map((block) => {
        toolNamesById.set(block.id, block.name);
        return serializeFunctionGemmaToolCall(block.name, block.input);
      });
      const text = message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
      const serializedCallText = serializedCalls.join("\n").trim();

      if (
        text &&
        text !== serializedCallText &&
        !serializedCalls.some((call) => text.includes(call))
      ) {
        turns.push("model", text);
      }
      if (serializedCalls.length > 0) {
        turns.push("model", serializedCalls.join("\n"));
      }
      continue;
    }

    if (message.role === "tool" && Array.isArray(message.content)) {
      for (const block of message.content) {
        const toolName = toolNamesById.get(block.tool_use_id) ?? "tool";
        const resultText = extractMessageText(block.content);
        turns.push(
          "user",
          `The function ${toolName} already returned this result: ${resultText}\n` +
            `Do not call ${toolName} again just to repeat the same lookup.\n` +
            `If this result answers the user's request, reply with the final answer.\n` +
            `Only call another function if a different function is still needed to complete the request.`
        );
      }
    }
  }

  return turns.join("\n");
}

function buildFunctionGemmaRawPrompt(
  input: ToolCallingTaskInput,
  systemPrompt: string | undefined
): string {
  const hasMessages = input.messages && input.messages.length > 0;
  const userPrompt = buildFunctionGemmaConversationPrompt(input);

  const parts = [
    "developer",
    buildFunctionGemmaDeveloperPrompt(systemPrompt, input.toolChoice === "required"),
    buildFunctionGemmaDeclarations(input.tools),
  ];

  if (hasMessages) {
    // buildFunctionGemmaConversationPrompt already includes role markers
    parts.push(userPrompt);
  } else {
    parts.push("user", userPrompt);
  }

  parts.push("model");
  return parts.join("\n");
}

/**
 * If the model requires a raw completion prompt (bypassing LlamaChatSession),
 * returns the prompt string. Otherwise returns `undefined` and the caller
 * should use the normal LlamaChatSession path.
 */
export function buildRawCompletionPrompt(
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig,
  systemPrompt: string | undefined
): string | undefined {
  if (detectFunctionGemmaModel(model) && input.toolChoice !== "none") {
    return buildFunctionGemmaRawPrompt(input, systemPrompt);
  }
  return undefined;
}

/**
 * Whether the model supports LlamaChatSession's native function calling API.
 * Models that require a raw completion prompt (e.g. FunctionGemma) do not.
 */
export function supportsNativeFunctions(
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig
): boolean {
  return input.toolChoice !== "none" && !detectFunctionGemmaModel(model);
}

/**
 * Whether the text likely contains tool call markup worth parsing.
 */
export function hasToolCallMarkers(text: string): boolean {
  return (
    text.includes("<tool_call>") ||
    text.includes("<start_function_call>") ||
    text.includes("<|tool_call_start|>") ||
    /\[\w+\(/.test(text)
  );
}

/**
 * Truncate raw completion output at turn boundary markers.
 * FunctionGemma and similar raw-prompt models may generate past their turn,
 * echoing conversation structure (`\nuser\n...`, `\ndeveloper\n...`).
 */
export function truncateAtTurnBoundary(text: string): string {
  const markers = ["\nuser\n", "\ndeveloper\n"];
  let truncateAt = text.length;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx !== -1 && idx < truncateAt) {
      truncateAt = idx;
    }
  }
  return text.slice(0, truncateAt).trim();
}

// ============================================================================
// Qwen detection
// ============================================================================

export function detectQwenToolCallingVariation(
  model: LlamaCppModelConfig
): "3" | "3.5" | undefined {
  const candidates = getModelTextCandidates(model);

  if (
    candidates.some((value) =>
      /\bqwen(?:[\s._-]?|)3(?:[\s._-]?|)5\b|\bqwen(?:[\s._-]?|)3\.5\b/.test(value)
    )
  ) {
    return "3.5";
  }

  if (candidates.some((value) => /\bqwen(?:[\s._-]?|)3\b/.test(value))) {
    return "3";
  }

  return undefined;
}

// ============================================================================
// Tool call extraction using shared parsers
// ============================================================================

function adaptParserResult(result: ToolCallParserResult, input: ToolCallingTaskInput): ToolCalls {
  return result.tool_calls.map((call, index) => ({
    id: call.id ?? `call_${index}`,
    name: resolveParsedToolName(call.name, input),
    input: call.arguments,
  }));
}

export function extractToolCallsFromText(
  text: string,
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig
): ToolCalls {
  // FunctionGemma models: try dedicated parser first
  if (detectFunctionGemmaModel(model)) {
    const functionGemmaResult = parseFunctionGemma(text);
    if (functionGemmaResult && functionGemmaResult.tool_calls.length > 0) {
      return adaptParserResult(functionGemmaResult, input);
    }

    // FunctionGemma loose-object fallback (requires forced tool name)
    const forcedToolName = forcedToolSelection(input);
    const looseObject = forcedToolName ? parseFunctionGemmaLooseObject(text) : undefined;
    if (forcedToolName && looseObject) {
      return [{ id: "call_0", name: forcedToolName, input: looseObject }];
    }
  }

  // Try Liquid/LFM format: <|tool_call_start|>[func(args)]<|tool_call_end|> or [func(args)]
  const liquidResult = parseLiquid(text);
  if (liquidResult && liquidResult.tool_calls.length > 0) {
    return adaptParserResult(liquidResult, input);
  }

  // Try Hermes/JSON format: <tool_call>{"name":...}</tool_call>
  const hermesResult = parseHermes(text);
  if (hermesResult && hermesResult.tool_calls.length > 0) {
    return adaptParserResult(hermesResult, input);
  }

  // Try Qwen 3.5 XML format: <tool_call><function=name><parameter=...></tool_call>
  const qwen35Result = parseQwen35Xml(text);
  if (qwen35Result && qwen35Result.tool_calls.length > 0) {
    return adaptParserResult(qwen35Result, input);
  }

  // Try Llama/bare JSON format: {"name": "func", "parameters"|"arguments": {...}}
  const llamaResult = parseLlama(text);
  if (llamaResult && llamaResult.tool_calls.length > 0) {
    return adaptParserResult(llamaResult, input);
  }

  return [];
}
