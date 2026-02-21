/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskConfigurationError } from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util";

export interface BrowserContextMetadata {
  session_id: string;
  url?: string;
  title?: string;
}

export interface BrowserTaskInputCommon {
  context?: Record<string, unknown>;
  session_id?: string;
  timeout_ms?: number;
}

export const browserContextInputSchema = {
  type: "object",
  properties: {
    context: {
      type: "object",
      additionalProperties: true,
      default: {},
      title: "Context",
      description: "Context passed between browser tasks",
    },
    session_id: {
      type: "string",
      title: "Session ID",
      description: "Optional explicit session id. Overrides context.__browser.session_id when set.",
    },
    timeout_ms: {
      type: "number",
      default: 30000,
      minimum: 1,
      title: "Timeout (ms)",
      description: "Task timeout in milliseconds",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const browserContextOutputSchema = {
  type: "object",
  properties: {
    context: {
      type: "object",
      additionalProperties: true,
      title: "Context",
      description: "Context passed to the next browser task",
    },
  },
  required: ["context"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function cloneContext(context: unknown): Record<string, unknown> {
  return { ...asRecord(context) };
}

export function getBrowserMetadata(context: Record<string, unknown>): BrowserContextMetadata | undefined {
  const browser = context["__browser"];
  if (!browser || typeof browser !== "object" || Array.isArray(browser)) return undefined;
  const value = browser as Record<string, unknown>;
  if (typeof value.session_id !== "string" || value.session_id.length === 0) return undefined;
  return {
    session_id: value.session_id,
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
  };
}

export function setBrowserMetadata(
  context: Record<string, unknown>,
  metadata: BrowserContextMetadata
): Record<string, unknown> {
  const previous = getBrowserMetadata(context) ?? { session_id: metadata.session_id };
  const nextContext = { ...context };
  nextContext["__browser"] = {
    ...previous,
    ...metadata,
  };
  return nextContext;
}

export function clearBrowserMetadata(
  context: Record<string, unknown>,
  mode: "all" | "session_id" = "all"
): Record<string, unknown> {
  const nextContext = { ...context };
  const browser = getBrowserMetadata(nextContext);
  if (!browser) return nextContext;
  if (mode === "all") {
    delete nextContext["__browser"];
    return nextContext;
  }
  nextContext["__browser"] = {
    ...browser,
    session_id: undefined,
  };
  delete (nextContext["__browser"] as Record<string, unknown>).session_id;
  return nextContext;
}

export function resolveSessionId(
  input: BrowserTaskInputCommon,
  required = false
): string | undefined {
  if (typeof input.session_id === "string" && input.session_id.length > 0) {
    return input.session_id;
  }
  const context = cloneContext(input.context);
  const metadata = getBrowserMetadata(context);
  if (metadata?.session_id) return metadata.session_id;
  if (required) {
    throw new TaskConfigurationError(
      "No browser session id found. Provide session_id or context.__browser.session_id."
    );
  }
  return undefined;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new TaskConfigurationError(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

