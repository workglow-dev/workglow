/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";

// ========================================================================
// Image content constraints (shared by schema + runtime guard)
// ========================================================================

/**
 * MIME types accepted for image content blocks. Matches the set supported
 * by the major provider APIs (Anthropic, Gemini, OpenAI).
 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type ImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/**
 * Maximum base64 length for image data. 20 MiB of base64 encodes ~15 MiB
 * of binary — a reasonable upper bound for provider APIs, and a hard guard
 * against unbounded memory use when ContentBlockImage originates from an
 * untrusted caller.
 */
export const MAX_IMAGE_DATA_LENGTH = 20_971_520;

// ========================================================================
// Canonical ContentBlock union
// ========================================================================

export type ContentBlockText = {
  readonly type: "text";
  readonly text: string;
};

export type ContentBlockImage = {
  readonly type: "image";
  readonly mimeType: ImageMimeType;
  readonly data: string;
};

export type ContentBlockToolUse = {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
};

export type ContentBlockToolResult = {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content: ReadonlyArray<ContentBlock>;
  readonly is_error: boolean | undefined;
};

export type ContentBlock =
  | ContentBlockText
  | ContentBlockImage
  | ContentBlockToolUse
  | ContentBlockToolResult;

// ========================================================================
// Canonical ChatMessage
// ========================================================================

export type ChatRole = "user" | "assistant" | "tool" | "system";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: ReadonlyArray<ContentBlock>;
}

// ========================================================================
// JSON Schemas (runtime validation + DataPort declarations)
// ========================================================================

const ContentBlockTextSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["text"] },
    text: { type: "string" },
  },
  required: ["type", "text"],
  additionalProperties: false,
} as const;

const ContentBlockImageSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["image"] },
    mimeType: { type: "string", enum: ALLOWED_IMAGE_MIME_TYPES },
    data: { type: "string", maxLength: MAX_IMAGE_DATA_LENGTH },
  },
  required: ["type", "mimeType", "data"],
  additionalProperties: false,
} as const;

const ContentBlockToolUseSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["tool_use"] },
    id: { type: "string" },
    name: { type: "string" },
    input: { type: "object", additionalProperties: true },
  },
  required: ["type", "id", "name", "input"],
  additionalProperties: false,
} as const;

// tool_result is recursive — its `content` is an array of ContentBlock.
// The $ref resolves against ContentBlockSchema.definitions.ContentBlock below.
const ContentBlockToolResultSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["tool_result"] },
    tool_use_id: { type: "string" },
    content: {
      type: "array",
      items: { $ref: "#/definitions/ContentBlock" },
    },
    is_error: { type: "boolean" },
  },
  required: ["type", "tool_use_id", "content"],
  additionalProperties: false,
} as const;

// Not a DataPortSchema because the root is `oneOf`, not `type: "object"`.
// Consumers embed it inside an object schema (see ChatMessageSchema).
export const ContentBlockSchema = {
  oneOf: [
    ContentBlockTextSchema,
    ContentBlockImageSchema,
    ContentBlockToolUseSchema,
    ContentBlockToolResultSchema,
  ],
  definitions: {
    ContentBlock: {
      oneOf: [
        ContentBlockTextSchema,
        ContentBlockImageSchema,
        ContentBlockToolUseSchema,
        ContentBlockToolResultSchema,
      ],
    },
  },
  title: "ContentBlock",
  description: "A single content block within a chat message",
} as const;

export const ChatMessageSchema = {
  type: "object",
  properties: {
    role: { type: "string", enum: ["user", "assistant", "tool", "system"] },
    content: {
      type: "array",
      items: ContentBlockSchema,
    },
  },
  required: ["role", "content"],
  additionalProperties: false,
  title: "ChatMessage",
  description: "A single chat message with role and structured content blocks",
} as const satisfies DataPortSchema;

// ========================================================================
// Runtime type guards
// ========================================================================

export function isContentBlock(value: unknown): value is ContentBlock {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case "text":
      return typeof v.text === "string";
    case "image":
      return (
        typeof v.mimeType === "string" &&
        (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(v.mimeType) &&
        typeof v.data === "string" &&
        v.data.length <= MAX_IMAGE_DATA_LENGTH
      );
    case "tool_use":
      return (
        typeof v.id === "string" &&
        typeof v.name === "string" &&
        v.input !== null &&
        typeof v.input === "object"
      );
    case "tool_result":
      return (
        typeof v.tool_use_id === "string" &&
        Array.isArray(v.content) &&
        v.content.every(isContentBlock)
      );
    default:
      return false;
  }
}

export function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const validRole =
    v.role === "user" || v.role === "assistant" || v.role === "tool" || v.role === "system";
  return validRole && Array.isArray(v.content) && v.content.every(isContentBlock);
}

// ========================================================================
// Convenience constructors
// ========================================================================

export function textMessage(role: ChatRole, text: string): ChatMessage {
  return { role, content: [{ type: "text", text }] };
}
