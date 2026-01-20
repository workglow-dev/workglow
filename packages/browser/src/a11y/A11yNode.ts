/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bounding box for an element in the page
 */
export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * State information for an accessibility node
 */
export interface A11yState {
  readonly disabled?: boolean;
  readonly checked?: boolean | "mixed";
  readonly expanded?: boolean;
  readonly selected?: boolean;
  readonly pressed?: boolean;
  readonly readonly?: boolean;
  readonly required?: boolean;
  readonly invalid?: boolean;
  readonly busy?: boolean;
  readonly hidden?: boolean;
  readonly modal?: boolean;
  readonly multiselectable?: boolean;
  readonly level?: number;
  readonly valueMin?: number;
  readonly valueMax?: number;
  readonly valueNow?: number;
}

/**
 * Represents a node in the accessibility tree
 * 
 * This provides a simplified, stable view of page elements based on their
 * semantic meaning rather than their DOM structure or styling.
 */
export interface A11yNode {
  /**
   * ARIA role or implicit role from semantic HTML
   * Examples: "button", "link", "textbox", "heading", "region", etc.
   */
  readonly role: string;

  /**
   * Accessible name computed from:
   * - aria-label
   * - aria-labelledby
   * - text content
   * - alt text (for images)
   * - title attribute
   */
  readonly name: string;

  /**
   * Current state of the element (disabled, checked, expanded, etc.)
   */
  readonly state: A11yState;

  /**
   * Current value for input elements
   */
  readonly value: string | undefined;

  /**
   * Position and dimensions of the element
   */
  readonly boundingBox: BoundingBox;

  /**
   * Child nodes in the accessibility tree
   */
  readonly children: readonly A11yNode[];

  /**
   * Additional ARIA and data attributes
   */
  readonly attributes: Record<string, string>;

  /**
   * Tag name of the underlying DOM element (for debugging)
   */
  readonly tagName?: string;

  /**
   * Unique identifier for this node (generated during parsing)
   */
  readonly id: string;
}

/**
 * Serialized version of A11yNode that can be sent across boundaries
 * (page context -> Node.js context)
 */
export type SerializedA11yNode = Omit<A11yNode, "children"> & {
  children: SerializedA11yNode[];
};
