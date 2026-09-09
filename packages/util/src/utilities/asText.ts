/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renders an arbitrary value as text.
 *
 * `String(value)` is the obvious spelling and the wrong one wherever the value
 * might be an object: every plain object renders as `"[object Object]"`. The
 * content is gone, and where the result is compared, keyed on, or sent to a
 * model, two unrelated objects render identically — so a lookup matches the
 * wrong thing rather than failing.
 *
 * Strings pass through unquoted so a message reads the way its author wrote it.
 * `null` and `undefined` render empty, which is what the `String(v ?? "")` this
 * replaces already did. A type that defines its own `toString` keeps it, so a
 * `URL` or a `Date` still reads the familiar way. Everything else is JSON, so
 * the content survives.
 *
 * This is for display, keys and prompts. It is not a serializer: a cycle, a
 * BigInt inside an object, a throwing `toString`, or a value JSON drops falls
 * back rather than throwing, because a diagnostic must not fail while
 * reporting a failure.
 */
export function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  // Number, boolean, bigint or symbol by elimination — string, null and
  // undefined returned above — and none of those carries Object's default
  // stringification. The rule does not track the narrowing back that far.
  // oxlint-disable-next-line typescript/no-base-to-string
  if (typeof value !== "object" && typeof value !== "function") return String(value);

  // A type that defines its own `toString` means it — `URL`, `Date`, `Error`,
  // `RegExp` and anything modelled on them render better that way than as
  // JSON, and a caller reading the result expects the familiar form. Arrays are
  // excluded: theirs joins with commas, so an array of objects lands right back
  // on "[object Object]".
  if (!Array.isArray(value) && typeof value !== "function") {
    const own = (value as { readonly toString?: unknown }).toString;
    if (typeof own === "function" && own !== Object.prototype.toString) {
      try {
        return (own as () => string).call(value);
      } catch {
        // A throwing toString is not a reason to fail; fall through to JSON.
      }
    }
  }

  try {
    // The one deliberate default rendering left in the tree, in the helper
    // that exists so nothing else needs one. Reached only where JSON produced
    // nothing — a function, most often — and there `String()` gives the source
    // rather than "[object Object]".
    // oxlint-disable-next-line typescript/no-base-to-string
    return JSON.stringify(value) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
