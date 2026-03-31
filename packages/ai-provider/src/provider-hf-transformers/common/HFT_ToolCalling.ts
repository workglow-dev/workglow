/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextGenerationOutput, TextGenerationPipeline } from "@huggingface/transformers";
import {
  buildToolDescription,
  filterValidToolCalls,
  toTextFlatMessages,
} from "@workglow/ai/worker";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolDefinition,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, loadTransformersSDK } from "./HFT_Pipeline";
import {
  createStreamEventQueue,
  createStreamingTextStreamer,
  createTextStreamer,
} from "./HFT_Streaming";
import { extractGeneratedText } from "./HFT_TextOutput";
import { createToolCallMarkupFilter, parseToolCallsFromText } from "./HFT_ToolMarkup";

function getModelTextCandidates(model: HfTransformersOnnxModelConfig): string[] {
  return [model.model_id, model.title, model.description, model.provider_config.model_path]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase());
}

function detectFunctionGemmaModel(model: HfTransformersOnnxModelConfig): boolean {
  return getModelTextCandidates(model).some((value) => value.includes("functiongemma"));
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

function forcedToolSelection(input: ToolCallingTaskInput): string | undefined {
  if (
    typeof input.toolChoice === "string" &&
    input.toolChoice !== "auto" &&
    input.toolChoice !== "none"
  ) {
    if (input.toolChoice !== "required") {
      return input.toolChoice;
    }
  }
  if (input.toolChoice === "required" && input.tools.length === 1) {
    return input.tools[0]?.name;
  }
  return undefined;
}

function selectHFTTools(input: ToolCallingTaskInput): ReturnType<typeof mapHFTTools> | undefined {
  if (input.toolChoice === "none") {
    return undefined;
  }

  if (
    typeof input.toolChoice === "string" &&
    input.toolChoice !== "auto" &&
    input.toolChoice !== "required"
  ) {
    const selectedTools = input.tools.filter(
      (tool: ToolDefinition) => tool.name === input.toolChoice
    );
    const toolsToMap = selectedTools.length > 0 ? selectedTools : input.tools;
    return mapHFTTools(toolsToMap);
  }

  return mapHFTTools(input.tools);
}

function parsePossibleToolResponse(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall back to the raw string.
    }
  }
  return content;
}

function buildFunctionGemmaMessages(input: ToolCallingTaskInput): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  const systemLines = [
    input.systemPrompt,
    input.toolChoice === "required"
      ? "You must call at least one tool from the provided tool list when answering."
      : undefined,
    "If tool results are already available and no further function call is needed, answer the user normally.",
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (systemLines.length > 0) {
    messages.push({ role: "system", content: systemLines.join("\n\n") });
  }

  const sourceMessages =
    input.messages && input.messages.length > 0
      ? input.messages
      : [{ role: "user" as const, content: input.prompt }];
  const toolNamesById = new Map<string, string>();

  for (const message of sourceMessages) {
    if (message.role === "user") {
      messages.push({ role: "user", content: extractMessageText(message.content) });
      continue;
    }

    if (message.role === "assistant" && Array.isArray(message.content)) {
      const text = message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");
      const toolCalls = message.content
        .filter(
          (
            block
          ): block is {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
          } => block.type === "tool_use"
        )
        .map((block) => {
          toolNamesById.set(block.id, block.name);
          return {
            function: {
              name: block.name,
              arguments: block.input,
            },
          };
        });

      if (text || toolCalls.length > 0) {
        const assistantMessage: Record<string, unknown> = { role: "assistant" };
        if (text) {
          assistantMessage.content = text;
        }
        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }
        messages.push(assistantMessage);
      }
      continue;
    }

    if (message.role === "tool" && Array.isArray(message.content)) {
      for (const block of message.content) {
        const toolName = toolNamesById.get(block.tool_use_id);
        if (!toolName) {
          continue;
        }
        messages.push({
          role: "tool",
          name: toolName,
          content: parsePossibleToolResponse(extractMessageText(block.content)),
        });
      }
    }
  }

  return messages;
}

function buildFunctionGemmaPrompt(
  tokenizer: {
    apply_chat_template: (messages: unknown, options: Record<string, unknown>) => string;
  },
  input: ToolCallingTaskInput
): { prompt: string; responsePrefix: string | undefined } {
  const tools = selectHFTTools(input);
  const messages = buildFunctionGemmaMessages(input);
  const prompt = tokenizer.apply_chat_template(messages, {
    tools,
    tokenize: false,
    add_generation_prompt: true,
  }) as string;
  const hasToolResponses = input.messages?.some((message) => message.role === "tool") ?? false;
  const forcedToolName = forcedToolSelection(input);
  const responsePrefix =
    input.toolChoice === "none" || hasToolResponses
      ? undefined
      : forcedToolName
        ? `<start_function_call>call:${forcedToolName}{`
        : "<start_function_call>call:";
  return {
    prompt: responsePrefix ? `${prompt}${responsePrefix}` : prompt,
    responsePrefix,
  };
}

function normalizeParsedToolCalls(
  input: ToolCallingTaskInput,
  toolCalls: ToolCallingTaskOutput["toolCalls"]
) {
  const forcedToolName = forcedToolSelection(input);
  return toolCalls.map((toolCall) =>
    toolCall.name
      ? toolCall
      : {
          ...toolCall,
          name: forcedToolName ?? toolCall.name,
        }
  );
}

function mapHFTTools(tools: ReadonlyArray<ToolDefinition>) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));
}

/**
 * Resolve the tools list and optionally mutate the messages array based on the toolChoice option.
 * - "none": no tools
 * - "required": all tools + adds a system instruction so the model must call a tool
 * - specific name: filter to that tool (falls back to all tools if not found)
 * - "auto" / undefined: all tools
 */
function resolveHFTToolsAndMessages(
  input: ToolCallingTaskInput,
  messages: Array<{ role: string; content: string }>
): ReturnType<typeof mapHFTTools> | undefined {
  if (input.toolChoice === "none") {
    return undefined;
  }

  if (input.toolChoice === "required") {
    const requiredInstruction =
      "You must call at least one tool from the provided tool list when answering.";
    if (messages.length > 0 && messages[0].role === "system") {
      messages[0] = { ...messages[0], content: `${messages[0].content}\n\n${requiredInstruction}` };
    } else {
      messages.unshift({ role: "system", content: requiredInstruction });
    }
    return mapHFTTools(input.tools);
  }

  if (typeof input.toolChoice === "string" && input.toolChoice !== "auto") {
    // Specific tool name: filter to that tool if it exists
    const selectedTools = input.tools?.filter(
      (tool: ToolDefinition) => tool.name === input.toolChoice
    );
    const toolsToMap = selectedTools && selectedTools.length > 0 ? selectedTools : input.tools;
    return mapHFTTools(toolsToMap);
  }

  return mapHFTTools(input.tools);
}

export const HFT_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const generateText: TextGenerationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const { TextStreamer } = await loadTransformersSDK();
  const { prompt, responsePrefix } = detectFunctionGemmaModel(model!)
    ? buildFunctionGemmaPrompt(generateText.tokenizer as any, input)
    : {
        responsePrefix: undefined,
        prompt: (() => {
          const messages = toTextFlatMessages(input);
          const tools = resolveHFTToolsAndMessages(input, messages);
          return generateText.tokenizer.apply_chat_template(messages, {
            tools,
            tokenize: false,
            add_generation_prompt: true,
          }) as string;
        })(),
      };

  const streamer = createTextStreamer(generateText.tokenizer, onProgress, TextStreamer, signal);

  let results = await generateText(prompt, {
    max_new_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? undefined,
    return_full_text: false,
    streamer,
  });

  if (!Array.isArray(results)) {
    results = [results];
  }

  const responseText = extractGeneratedText(
    (results[0] as TextGenerationOutput[number])?.generated_text
  ).trim();
  const parseableResponseText = responsePrefix ? `${responsePrefix}${responseText}` : responseText;

  const { text, toolCalls } = parseToolCallsFromText(parseableResponseText);
  return {
    text,
    toolCalls: filterValidToolCalls(normalizeParsedToolCalls(input, toolCalls), input.tools),
  };
};

export const HFT_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const noopProgress = () => {};
  const generateText: TextGenerationPipeline = await getPipeline(model!, noopProgress, {}, signal);
  const { TextStreamer } = await loadTransformersSDK();
  const { prompt, responsePrefix } = detectFunctionGemmaModel(model!)
    ? buildFunctionGemmaPrompt(generateText.tokenizer as any, input)
    : {
        responsePrefix: undefined,
        prompt: (() => {
          const messages = toTextFlatMessages(input);
          const tools = resolveHFTToolsAndMessages(input, messages);
          return generateText.tokenizer.apply_chat_template(messages, {
            tools,
            tokenize: false,
            add_generation_prompt: true,
          }) as string;
        })(),
      };

  // Two queues: the inner queue receives raw tokens from the TextStreamer,
  // the outer queue receives filtered text-delta events (markup stripped).
  const innerQueue = createStreamEventQueue<StreamEvent<ToolCallingTaskOutput>>();
  const outerQueue = createStreamEventQueue<StreamEvent<ToolCallingTaskOutput>>();
  const streamer = createStreamingTextStreamer(
    generateText.tokenizer,
    innerQueue,
    TextStreamer,
    signal
  );

  let fullText = "";
  const filter = createToolCallMarkupFilter((text) => {
    outerQueue.push({ type: "text-delta", port: "text", textDelta: text });
  });

  // Intercept raw text-delta events: accumulate the full text for post-hoc
  // parsing and feed tokens through the markup filter before forwarding.
  const originalPush = innerQueue.push;
  innerQueue.push = (event: StreamEvent<ToolCallingTaskOutput>) => {
    if (event.type === "text-delta" && "textDelta" in event) {
      fullText += event.textDelta;
      filter.feed(event.textDelta);
    } else {
      outerQueue.push(event);
    }
    // Still call originalPush so the inner queue's done/error mechanics work
    originalPush(event);
  };

  const originalDone = innerQueue.done;
  innerQueue.done = () => {
    filter.flush();
    outerQueue.done();
    originalDone();
  };

  const originalError = innerQueue.error;
  innerQueue.error = (e: Error) => {
    filter.flush();
    outerQueue.error(e);
    originalError(e);
  };

  const pipelinePromise = generateText(prompt, {
    max_new_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? undefined,
    return_full_text: false,
    streamer,
  }).then(
    () => innerQueue.done(),
    (err: Error) => innerQueue.error(err)
  );

  yield* outerQueue.iterable;
  await pipelinePromise;

  // Parse the accumulated (unfiltered) text for tool calls. The filter already
  // stripped tag-based markup from text-delta events; this pass also handles
  // bare-JSON tool calls and produces the canonical cleanedText for the finish event.
  const parseableFullText = responsePrefix ? `${responsePrefix}${fullText}` : fullText;
  const { text: cleanedText, toolCalls } = parseToolCallsFromText(parseableFullText);
  const validToolCalls = filterValidToolCalls(
    normalizeParsedToolCalls(input, toolCalls),
    input.tools
  );

  if (validToolCalls.length > 0) {
    yield { type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] };
  }

  yield {
    type: "finish",
    data: { text: cleanedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
  };
};
