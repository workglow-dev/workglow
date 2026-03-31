/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { filterValidToolCalls } from "@workglow/ai/worker";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCalls,
  ToolDefinition,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  getLlamaCppSdk,
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  loadSdk,
} from "./LlamaCpp_Runtime";

function buildLlamaCppPrompt(input: ToolCallingTaskInput): string {
  const inputMessages = input.messages;
  if (!inputMessages || inputMessages.length === 0) {
    return input.prompt as string;
  }

  const parts: string[] = [];
  for (const msg of inputMessages) {
    if (msg.role === "user") {
      parts.push(`User: ${msg.content}`);
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const text = msg.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      if (text) parts.push(`Assistant: ${text}`);
    } else if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        parts.push(`Tool Result: ${block.content}`);
      }
    }
  }
  return parts.join("\n\n");
}

function getModelTextCandidates(model: LlamaCppModelConfig): string[] {
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
  const userPrompt = buildFunctionGemmaConversationPrompt(input);

  return [
    "developer",
    buildFunctionGemmaDeveloperPrompt(systemPrompt, input.toolChoice === "required"),
    buildFunctionGemmaDeclarations(input.tools),
    "user",
    userPrompt,
    "model",
  ].join("\n");
}

function canUseRawFunctionGemmaPrompt(
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig
): boolean {
  return detectFunctionGemmaModel(model) && input.toolChoice !== "none";
}

function buildSystemPrompt(input: ToolCallingTaskInput): string | undefined {
  const base = input.systemPrompt;
  if (input.toolChoice === "required") {
    const instruction =
      "You must call at least one tool from the provided tool list when answering.";
    return base ? `${base}\n\n${instruction}` : instruction;
  }
  return base || undefined;
}

function toolChoiceForcesToolCall(toolChoice: ToolCallingTaskInput["toolChoice"]): boolean {
  return (
    toolChoice === "required" ||
    (toolChoice !== undefined && toolChoice !== "auto" && toolChoice !== "none")
  );
}

function detectQwenToolCallingVariation(model: LlamaCppModelConfig): "3" | "3.5" | undefined {
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

function forcedToolSelection(input: ToolCallingTaskInput): string | undefined {
  const explicitToolName = forcedToolChoiceName(input.toolChoice);
  if (explicitToolName !== undefined) {
    return explicitToolName;
  }
  if (input.toolChoice === "required" && input.tools.length === 1) {
    return input.tools[0]?.name;
  }
  return undefined;
}

function llamaCppForcedToolResponsePrefix(
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig
): string | undefined {
  if (!toolChoiceForcesToolCall(input.toolChoice)) {
    return undefined;
  }

  const variation = detectQwenToolCallingVariation(model);
  if (!variation) {
    return undefined;
  }

  const toolName = forcedToolSelection(input);
  if (variation === "3.5") {
    return toolName
      ? `<tool_call>\n<function=${toolName}>\n<parameter=`
      : "<tool_call>\n<function=";
  }

  return toolName
    ? `<tool_call>\n{"name": ${JSON.stringify(toolName)}, "arguments": `
    : '<tool_call>\n{"name": "';
}

function resolveParsedToolName(name: string, input: ToolCallingTaskInput): string {
  if (input.tools.some((tool) => tool.name === name)) {
    return name;
  }
  return forcedToolSelection(input) ?? name;
}

function parseJsonToolCalls(text: string, input: ToolCallingTaskInput): ToolCalls {
  const matches = text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g);
  const calls: ToolCalls = [];
  for (const [_, body] of matches) {
    const trimmed = body.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as { name?: unknown; arguments?: unknown };
      if (typeof parsed.name !== "string") {
        continue;
      }
      const inputObject =
        parsed.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)
          ? (parsed.arguments as Record<string, unknown>)
          : {};
      calls.push({
        id: `call_${calls.length}`,
        name: resolveParsedToolName(parsed.name, input),
        input: inputObject,
      });
    } catch {
      // Ignore malformed tool call text and fall back to other parsers.
    }
  }
  return calls;
}

function parseXmlToolCalls(text: string, input: ToolCallingTaskInput): ToolCalls {
  const toolCallMatches = text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g);
  const calls: ToolCalls = [];
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
    calls.push({
      id: `call_${calls.length}`,
      name: resolveParsedToolName(rawName.trim(), input),
      input: parsedInput,
    });
  }
  return calls;
}

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

function parseFunctionGemmaToolCalls(text: string, input: ToolCallingTaskInput): ToolCalls {
  const matches = text.matchAll(
    /(?:<start_function_call>\s*)?call:([^{\s]+)\{([\s\S]*?)\}(?:\s*<end_function_call>)?/g
  );
  const calls: ToolCalls = [];

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

    calls.push({
      id: `call_${calls.length}`,
      name: resolveParsedToolName(rawName.trim(), input),
      input: parsedInput,
    });
  }

  if (calls.length === 0) {
    const forcedToolName = forcedToolSelection(input);
    const looseObject = forcedToolName ? parseFunctionGemmaLooseObject(text) : undefined;
    if (forcedToolName && looseObject) {
      calls.push({
        id: "call_0",
        name: forcedToolName,
        input: looseObject,
      });
    }
  }

  return calls;
}

function extractToolCallsFromText(
  text: string,
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig
): ToolCalls {
  if (detectFunctionGemmaModel(model)) {
    const functionGemmaCalls = parseFunctionGemmaToolCalls(text, input);
    if (functionGemmaCalls.length > 0) {
      return functionGemmaCalls;
    }
  }
  const jsonCalls = parseJsonToolCalls(text, input);
  if (jsonCalls.length > 0) {
    return jsonCalls;
  }
  return parseXmlToolCalls(text, input);
}

/**
 * Sampling and related options for {@link LlamaChatSession.prompt}.
 * When the caller forces tool use (`required` or a specific tool name) but did not set
 * `temperature`, node-llama-cpp still uses greedy decoding (temperature 0). Small models
 * often prefer a direct text answer over tool syntax under greedy decoding, so we default
 * to a modest temperature in that case.
 */
function llamaCppToolCallingPromptOptions(
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig
): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    ...llamaCppSeedPromptSpread(model.provider_config),
  };
  if (input.maxTokens !== undefined) {
    opts.maxTokens = input.maxTokens;
  }
  if (input.temperature !== undefined) {
    opts.temperature = input.temperature;
  } else if (toolChoiceForcesToolCall(input.toolChoice)) {
    opts.temperature = 0.2;
  }
  const responsePrefix = llamaCppForcedToolResponsePrefix(input, model);
  if (responsePrefix !== undefined) {
    opts.responsePrefix = responsePrefix;
  }
  return opts;
}

function buildLlamaCppFunctions(
  tools: ReadonlyArray<ToolDefinition>,
  capturedCalls: Array<{ name: string; input: Record<string, unknown> }>
) {
  const { defineChatSessionFunction } = getLlamaCppSdk();
  const functions: Record<string, any> = {};
  for (const tool of tools) {
    const toolName = tool.name;
    functions[toolName] = defineChatSessionFunction({
      description: tool.description,
      params: tool.inputSchema as any,
      handler(params: any) {
        capturedCalls.push({ name: toolName, input: (params ?? {}) as Record<string, unknown> });
        return "OK";
      },
    } as any);
  }
  return functions;
}

export const LlamaCpp_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal) => {
  if (!model) throw new Error("Model config is required for ToolCallingTask.");

  await loadSdk();

  update_progress(0, "Loading model");
  const context = await getOrCreateTextContext(model);

  const capturedCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const useNativeFunctions = input.toolChoice !== "none" && !detectFunctionGemmaModel(model);
  const functions = useNativeFunctions
    ? buildLlamaCppFunctions(input.tools, capturedCalls)
    : undefined;

  update_progress(10, "Running tool calling");
  const sequence = context.getSequence();
  const { LlamaChatSession, LlamaCompletion } = getLlamaCppSdk();
  const promptText = buildLlamaCppPrompt(input);
  const systemPrompt = buildSystemPrompt(input);

  if (canUseRawFunctionGemmaPrompt(input, model)) {
    const completion = new LlamaCompletion({ contextSequence: sequence });
    try {
      const text = await completion.generateCompletion(
        buildFunctionGemmaRawPrompt(input, systemPrompt),
        {
          signal,
          ...llamaCppToolCallingPromptOptions(input, model),
        }
      );

      const toolCalls = filterValidToolCalls(
        extractToolCallsFromText(text, input, model),
        input.tools
      );
      update_progress(100, "Tool calling complete");
      return { text, toolCalls };
    } finally {
      completion.dispose({ disposeSequence: false });
      sequence.dispose();
    }
  }

  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
    ...(systemPrompt && { systemPrompt }),
  });

  try {
    const text = await session.prompt(promptText, {
      signal,
      ...llamaCppToolCallingPromptOptions(input, model),
      ...(functions && {
        functions,
        ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
      }),
    });

    const toolCalls: ToolCalls = [];
    capturedCalls.forEach((call, index) => {
      const id = `call_${index}`;
      toolCalls.push({ id, name: call.name, input: call.input });
    });
    if (
      toolCalls.length === 0 &&
      (text.includes("<tool_call>") || text.includes("<start_function_call>"))
    ) {
      toolCalls.push(...extractToolCallsFromText(text, input, model));
    }

    update_progress(100, "Tool calling complete");
    return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
  } finally {
    session.dispose({ disposeSequence: false });
    sequence.dispose();
  }
};

export const LlamaCpp_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  LlamaCppModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  if (!model) throw new Error("Model config is required for ToolCallingTask.");

  await loadSdk();

  const context = await getOrCreateTextContext(model);

  const capturedCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const functions =
    input.toolChoice === "none" ? undefined : buildLlamaCppFunctions(input.tools, capturedCalls);

  const sequence = context.getSequence();
  const { LlamaChatSession, LlamaCompletion } = getLlamaCppSdk();
  const promptText = buildLlamaCppPrompt(input);
  const systemPrompt = buildSystemPrompt(input);

  if (canUseRawFunctionGemmaPrompt(input, model)) {
    const completion = new LlamaCompletion({ contextSequence: sequence });
    const queue: string[] = [];
    let isComplete = false;
    let completionError: unknown;
    let resolveWait: (() => void) | null = null;
    let accumulatedText = "";

    const notifyWaiter = () => {
      resolveWait?.();
      resolveWait = null;
    };

    const completionPromise = completion
      .generateCompletion(buildFunctionGemmaRawPrompt(input, systemPrompt), {
        signal,
        ...llamaCppToolCallingPromptOptions(input, model),
        onTextChunk: (chunk: string) => {
          queue.push(chunk);
          notifyWaiter();
        },
      })
      .then(() => {
        isComplete = true;
        notifyWaiter();
      })
      .catch((err: unknown) => {
        completionError = err;
        isComplete = true;
        notifyWaiter();
      });

    try {
      while (true) {
        while (queue.length > 0) {
          const chunk = queue.shift()!;
          accumulatedText += chunk;
          yield { type: "text-delta", port: "text", textDelta: chunk };
        }
        if (isComplete) break;
        await new Promise<void>((r) => {
          resolveWait = r;
        });
      }
      while (queue.length > 0) {
        const chunk = queue.shift()!;
        accumulatedText += chunk;
        yield { type: "text-delta", port: "text", textDelta: chunk };
      }
    } finally {
      await completionPromise.catch(() => {});
      completion.dispose({ disposeSequence: false });
      sequence.dispose();
    }

    if (completionError) {
      if (!signal.aborted) throw completionError;
      return;
    }

    const validToolCalls = filterValidToolCalls(
      extractToolCallsFromText(accumulatedText, input, model),
      input.tools
    );

    if (validToolCalls.length > 0) {
      yield { type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] };
    }

    yield {
      type: "finish",
      data: { text: accumulatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
    };
    return;
  }

  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
    ...(systemPrompt && { systemPrompt }),
  });

  const queue: string[] = [];
  let isComplete = false;
  let completionError: unknown;
  let resolveWait: (() => void) | null = null;

  const notifyWaiter = () => {
    resolveWait?.();
    resolveWait = null;
  };

  let accumulatedText = "";
  const promptPromise = session
    .prompt(promptText, {
      signal,
      ...llamaCppToolCallingPromptOptions(input, model),
      ...(functions && {
        functions,
        ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
      }),
      onTextChunk: (chunk: string) => {
        queue.push(chunk);
        notifyWaiter();
      },
    })
    .then(() => {
      isComplete = true;
      notifyWaiter();
    })
    .catch((err: unknown) => {
      completionError = err;
      isComplete = true;
      notifyWaiter();
    });

  try {
    while (true) {
      while (queue.length > 0) {
        const chunk = queue.shift()!;
        accumulatedText += chunk;
        yield { type: "text-delta", port: "text", textDelta: chunk };
      }
      if (isComplete) break;
      await new Promise<void>((r) => {
        resolveWait = r;
      });
    }
    while (queue.length > 0) {
      const chunk = queue.shift()!;
      accumulatedText += chunk;
      yield { type: "text-delta", port: "text", textDelta: chunk };
    }
  } finally {
    await promptPromise.catch(() => {});
    session.dispose({ disposeSequence: false });
    sequence.dispose();
  }

  if (completionError) {
    if (!signal.aborted) throw completionError;
    return;
  }

  const toolCalls: ToolCalls = [];
  capturedCalls.forEach((call, index) => {
    const id = `call_${index}`;
    toolCalls.push({ id, name: call.name, input: call.input });
  });
  if (toolCalls.length === 0 && accumulatedText.includes("<tool_call>")) {
    toolCalls.push(...extractToolCallsFromText(accumulatedText, input, model));
  }
  const validToolCalls = filterValidToolCalls(toolCalls, input.tools);

  if (validToolCalls.length > 0) {
    yield { type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] };
  }

  yield {
    type: "finish",
    data: { text: accumulatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
  };
};
