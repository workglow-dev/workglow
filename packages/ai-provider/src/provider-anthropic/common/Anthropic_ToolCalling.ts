/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ToolCall,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCalls,
  ToolDefinition,
} from "@workglow/ai";
import { buildToolDescription, filterValidToolCalls } from "@workglow/ai/worker";
import type { StreamEvent } from "@workglow/task-graph";
import { parsePartialJson } from "@workglow/util/worker";
import { getClient, getMaxTokens, getModelName } from "./Anthropic_Client";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

function mapUserContentToAnthropic(content: unknown): any {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;
  const parts: any[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      parts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: block.mimeType as string,
          data: block.data as string,
        },
      });
    }
  }
  return parts;
}

function mapToolResultContentToAnthropic(content: unknown): any {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;
  const parts: any[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      parts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: block.mimeType as string,
          data: block.data as string,
        },
      });
    }
  }
  return parts;
}

function buildAnthropicMessages(input: ToolCallingTaskInput): any[] {
  const inputMessages = input.messages;
  if (!inputMessages || inputMessages.length === 0) {
    return [{ role: "user", content: input.prompt }];
  }

  const messages: any[] = [];
  for (const msg of inputMessages) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: mapUserContentToAnthropic(msg.content) });
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const blocks = msg.content.map((block: any) => {
        if (block.type === "text") return { type: "text", text: block.text };
        if (block.type === "tool_use") {
          return { type: "tool_use", id: block.id, name: block.name, input: block.input };
        }
        return block;
      });
      messages.push({ role: "assistant", content: blocks });
    } else if (msg.role === "tool" && Array.isArray(msg.content)) {
      const blocks = msg.content.map((block: any) => ({
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: mapToolResultContentToAnthropic(block.content),
        ...(block.is_error && { is_error: true }),
      }));
      messages.push({ role: "user", content: blocks });
    }
  }
  return messages;
}

function mapAnthropicToolChoice(
  toolChoice: string | undefined
): { type: "auto" } | { type: "any" } | { type: "tool"; name: string } | undefined {
  if (!toolChoice || toolChoice === "auto") return { type: "auto" };
  if (toolChoice === "none") return undefined;
  if (toolChoice === "required") return { type: "any" };
  return { type: "tool", name: toolChoice };
}

export const Anthropic_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Anthropic tool calling");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    name: t.name,
    description: buildToolDescription(t),
    input_schema: t.inputSchema as any,
  }));

  const toolChoice = mapAnthropicToolChoice(input.toolChoice);

  const messages = buildAnthropicMessages(input);

  const params: any = {
    model: modelName,
    messages,
    max_tokens: getMaxTokens(input, model),
    temperature: input.temperature,
  };

  if (input.systemPrompt) {
    params.system = input.systemPrompt;
  }

  if (toolChoice !== undefined) {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }

  const response = await client.messages.create(params, { signal });

  const text = response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  const toolCalls: ToolCalls = [];
  response.content
    .filter((b: any) => b.type === "tool_use")
    .forEach((b: any) => {
      toolCalls.push({
        id: b.id as string,
        name: b.name as string,
        input: (b.input as Record<string, unknown>) ?? {},
      });
    });

  update_progress(100, "Completed Anthropic tool calling");
  return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
};

export const Anthropic_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  AnthropicModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    name: t.name,
    description: buildToolDescription(t),
    input_schema: t.inputSchema as any,
  }));

  const toolChoice = mapAnthropicToolChoice(input.toolChoice);

  const messages = buildAnthropicMessages(input);

  const params: any = {
    model: modelName,
    messages,
    max_tokens: getMaxTokens(input, model),
    temperature: input.temperature,
  };

  if (input.systemPrompt) {
    params.system = input.systemPrompt;
  }

  if (toolChoice !== undefined) {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }

  const stream = client.messages.stream(params, { signal });

  const blockMeta = new Map<number, { type: string; id?: string; name?: string; json: string }>();
  let accumulatedText = "";
  /** Keyed by Anthropic content block index — avoids collisions when `id` is missing during early deltas. */
  const toolCallsByBlockIndex = new Map<number, ToolCall>();

  const toolCallsInStreamOrder = (): ToolCall[] =>
    [...toolCallsByBlockIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, tc]) => tc);

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const block = event.content_block;
      const index = event.index as number;
      if (block.type === "tool_use") {
        blockMeta.set(index, {
          type: "tool_use",
          id: block.id,
          name: block.name,
          json: "",
        });
      } else if (block.type === "text") {
        blockMeta.set(index, { type: "text", json: "" });
      }
    } else if (event.type === "content_block_delta") {
      const index = event.index as number;
      const delta = event.delta as any;
      if (delta.type === "text_delta") {
        yield { type: "text-delta", port: "text", textDelta: delta.text };
      } else if (delta.type === "input_json_delta") {
        const meta = blockMeta.get(index);
        if (meta) {
          meta.json += delta.partial_json;
          let parsedInput: Record<string, unknown>;
          try {
            parsedInput = JSON.parse(meta.json);
          } catch {
            const partial = parsePartialJson(meta.json);
            parsedInput = (partial as Record<string, unknown>) ?? {};
          }
          toolCallsByBlockIndex.set(index, {
            id: meta.id ?? "",
            name: meta.name ?? "",
            input: parsedInput,
          });
          yield {
            type: "object-delta",
            port: "toolCalls",
            objectDelta: toolCallsInStreamOrder(),
          };
        }
      }
    } else if (event.type === "content_block_stop") {
      const index = event.index as number;
      const meta = blockMeta.get(index);
      if (meta?.type === "tool_use") {
        let finalInput: Record<string, unknown>;
        try {
          finalInput = JSON.parse(meta.json);
        } catch {
          finalInput = (parsePartialJson(meta.json) as Record<string, unknown>) ?? {};
        }
        const id = meta.id ?? "";
        toolCallsByBlockIndex.set(index, { id, name: meta.name ?? "", input: finalInput });
        yield {
          type: "object-delta",
          port: "toolCalls",
          objectDelta: toolCallsInStreamOrder(),
        };
      }
      blockMeta.delete(index);
    }
  }

  yield { type: "finish", data: {} as ToolCallingTaskOutput };
};
