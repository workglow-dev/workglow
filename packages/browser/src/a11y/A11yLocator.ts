/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { A11yState } from "./A11yNode";

/**
 * Locator for finding elements in the accessibility tree
 * 
 * Provides stable element selection based on semantic meaning rather than
 * DOM structure or CSS classes, making automation more resilient to UI changes.
 * 
 * @example
 * ```typescript
 * // Find a button by its accessible name
 * { role: "button", name: "Submit" }
 * 
 * // Find a textbox with partial name match
 * { role: "textbox", name: /email/i }
 * 
 * // Find a disabled checkbox
 * { role: "checkbox", state: { disabled: true } }
 * 
 * // Find the 2nd heading with "Section" in the name
 * { role: "heading", name: /Section/, nth: 1 }
 * ```
 */
export interface A11yLocator {
  /**
   * Filter by ARIA role or implicit role
   * Examples: "button", "link", "textbox", "heading", "region"
   */
  readonly role?: string;

  /**
   * Filter by accessible name (partial match, case-insensitive by default)
   * Can be a string or RegExp pattern
   */
  readonly name?: string | RegExp;

  /**
   * Filter by exact accessible name (case-sensitive)
   */
  readonly nameExact?: string;

  /**
   * Filter by element state
   */
  readonly state?: Partial<A11yState>;

  /**
   * Filter by current value (for inputs)
   */
  readonly value?: string | RegExp;

  /**
   * Filter by tag name (for additional specificity)
   */
  readonly tagName?: string;

  /**
   * Filter by attributes (partial match on values)
   */
  readonly attributes?: Record<string, string | RegExp>;

  /**
   * Index to select when multiple elements match (0-based)
   * If not specified, returns the first match
   */
  readonly nth?: number;

  /**
   * Whether the element must be visible (has non-zero bounding box)
   * Defaults to true
   */
  readonly visible?: boolean;
}

/**
 * Options for finding elements in the accessibility tree
 */
export interface A11yFindOptions {
  /**
   * Maximum time to wait for an element (in milliseconds)
   * If not specified, doesn't wait
   */
  readonly timeout?: number;

  /**
   * Polling interval when waiting (in milliseconds)
   * Defaults to 100ms
   */
  readonly pollingInterval?: number;

  /**
   * Whether to throw an error if no elements are found
   * Defaults to true
   */
  readonly throwIfNotFound?: boolean;
}
