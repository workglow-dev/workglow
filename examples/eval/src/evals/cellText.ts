/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renders one dataset cell as the text an eval should send to a model.
 *
 * `DatasetRow` is `Record<string, unknown>` because a HuggingFace row is: a
 * column can be a struct, a list, or a nested feature, not just a scalar.
 * `String()` renders every one of those as `"[object Object]"`, and the eval
 * then prompts or embeds that literal text and scores the model on it — a
 * wrong answer that looks like a real one. JSON keeps the content instead.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}
