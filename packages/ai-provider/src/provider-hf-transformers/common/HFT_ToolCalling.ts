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

  const messages = toTextFlatMessages(input);

  const tools = resolveHFTToolsAndMessages(input, messages);

  // Use the tokenizer's chat template to format the prompt with tool definitions
  const prompt = (generateText.tokenizer as any).apply_chat_template(messages, {
    tools,
    tokenize: false,
    add_generation_prompt: true,
  }) as string;

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

  const { text, toolCalls } = parseToolCallsFromText(responseText);
  return {
    text,
    toolCalls: filterValidToolCalls(toolCalls, input.tools),
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

  const messages = toTextFlatMessages(input);

  const tools = resolveHFTToolsAndMessages(input, messages);

  const prompt = (generateText.tokenizer as any).apply_chat_template(messages, {
    tools,
    tokenize: false,
    add_generation_prompt: true,
  }) as string;

  // Two queues: the inner queue receives raw tokens from the TextStreamer,
  // the outer queue receives filtered text-delta events (markup stripped).
  const innerQueue = createStreamEventQueue<StreamEvent<ToolCallingTaskOutput>>();
  const outerQueue = createStreamEventQueue<StreamEvent<ToolCallingTaskOutput>>();
  const streamer = createStreamingTextStreamer(generateText.tokenizer, innerQueue, TextStreamer, signal);

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
  const { text: cleanedText, toolCalls } = parseToolCallsFromText(fullText);
  const validToolCalls = filterValidToolCalls(toolCalls, input.tools);

  if (validToolCalls.length > 0) {
    yield { type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] };
  }

  yield {
    type: "finish",
    data: { text: cleanedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
  };
};
