/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { A11yNode } from "./A11yNode";
import type { A11yLocator, A11yFindOptions } from "./A11yLocator";

/**
 * Represents the accessibility tree of a page
 * 
 * Provides methods to query and navigate the tree using A11yLocator selectors.
 */
export class A11yTree {
  /**
   * Root node of the accessibility tree
   */
  readonly root: A11yNode;

  /**
   * Timestamp when the tree was captured
   */
  readonly timestamp: number;

  constructor(root: A11yNode) {
    this.root = root;
    this.timestamp = Date.now();
  }

  /**
   * Find a single element matching the locator
   * 
   * @param locator - Selector for the element
   * @param options - Search options
   * @returns The matching node or undefined
   */
  find(locator: A11yLocator, options?: A11yFindOptions): A11yNode | undefined {
    const nodes = this.findAll(locator);
    const nth = locator.nth ?? 0;
    return nodes[nth];
  }

  /**
   * Find all elements matching the locator
   * 
   * @param locator - Selector for the elements
   * @returns Array of matching nodes
   */
  findAll(locator: A11yLocator): A11yNode[] {
    const results: A11yNode[] = [];
    const visible = locator.visible !== false; // default to true

    const matches = (node: A11yNode): boolean => {
      // Check visibility
      if (visible && (node.boundingBox.width === 0 || node.boundingBox.height === 0)) {
        return false;
      }

      // Check role
      if (locator.role && node.role !== locator.role) {
        return false;
      }

      // Check name (exact)
      if (locator.nameExact !== undefined && node.name !== locator.nameExact) {
        return false;
      }

      // Check name (partial/regex)
      if (locator.name !== undefined) {
        if (typeof locator.name === "string") {
          if (!node.name.toLowerCase().includes(locator.name.toLowerCase())) {
            return false;
          }
        } else if (locator.name instanceof RegExp) {
          if (!locator.name.test(node.name)) {
            return false;
          }
        }
      }

      // Check tag name
      if (locator.tagName && node.tagName !== locator.tagName.toUpperCase()) {
        return false;
      }

      // Check value
      if (locator.value !== undefined) {
        if (typeof locator.value === "string") {
          if (node.value !== locator.value) {
            return false;
          }
        } else if (locator.value instanceof RegExp) {
          if (!node.value || !locator.value.test(node.value)) {
            return false;
          }
        }
      }

      // Check state
      if (locator.state) {
        for (const [key, value] of Object.entries(locator.state)) {
          if (node.state[key as keyof typeof node.state] !== value) {
            return false;
          }
        }
      }

      // Check attributes
      if (locator.attributes) {
        for (const [key, value] of Object.entries(locator.attributes)) {
          const attrValue = node.attributes[key];
          if (!attrValue) {
            return false;
          }
          if (typeof value === "string") {
            if (!attrValue.includes(value)) {
              return false;
            }
          } else if (value instanceof RegExp) {
            if (!value.test(attrValue)) {
              return false;
            }
          }
        }
      }

      return true;
    };

    const traverse = (node: A11yNode): void => {
      if (matches(node)) {
        results.push(node);
      }
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(this.root);
    return results;
  }

  /**
   * Get a text representation of the tree (for debugging)
   */
  toString(node: A11yNode = this.root, indent: number = 0): string {
    const prefix = "  ".repeat(indent);
    let result = `${prefix}${node.role}`;
    if (node.name) {
      result += ` "${node.name}"`;
    }
    if (node.value) {
      result += ` [value: "${node.value}"]`;
    }
    result += "\n";

    for (const child of node.children) {
      result += this.toString(child, indent + 1);
    }

    return result;
  }

  /**
   * Serialize the tree to JSON
   */
  toJSON(): any {
    return {
      root: this.root,
      timestamp: this.timestamp,
    };
  }
}
