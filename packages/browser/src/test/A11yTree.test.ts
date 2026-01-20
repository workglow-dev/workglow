/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "bun:test";
import type { A11yNode } from "../a11y/A11yNode";
import { A11yTree } from "../a11y/A11yTree";
import type { A11yLocator } from "../a11y/A11yLocator";

describe("A11yTree", () => {
  // Helper to create test nodes
  function createNode(
    overrides: Partial<A11yNode> = {}
  ): A11yNode {
    return {
      id: overrides.id || "node-1",
      role: overrides.role || "generic",
      name: overrides.name || "",
      state: overrides.state || {},
      value: overrides.value,
      boundingBox: overrides.boundingBox || { x: 0, y: 0, width: 100, height: 100 },
      children: overrides.children || [],
      attributes: overrides.attributes || {},
      tagName: overrides.tagName || "DIV",
    };
  }

  describe("find", () => {
    it("should find element by role", () => {
      const root = createNode({
        role: "main",
        children: [
          createNode({ id: "btn-1", role: "button", name: "Submit" }),
          createNode({ id: "link-1", role: "link", name: "Home" }),
        ],
      });

      const tree = new A11yTree(root);
      const locator: A11yLocator = { role: "button" };
      const found = tree.find(locator);

      expect(found).toBeDefined();
      expect(found?.id).toBe("btn-1");
      expect(found?.role).toBe("button");
    });

    it("should find element by name (partial match)", () => {
      const root = createNode({
        role: "main",
        children: [
          createNode({ id: "btn-1", role: "button", name: "Submit Form" }),
          createNode({ id: "btn-2", role: "button", name: "Cancel" }),
        ],
      });

      const tree = new A11yTree(root);
      const locator: A11yLocator = { name: "submit" };
      const found = tree.find(locator);

      expect(found).toBeDefined();
      expect(found?.id).toBe("btn-1");
    });

    it("should find element by exact name", () => {
      const root = createNode({
        role: "main",
        children: [
          createNode({ id: "btn-1", role: "button", name: "Submit" }),
          createNode({ id: "btn-2", role: "button", name: "Submit Form" }),
        ],
      });

      const tree = new A11yTree(root);
      const locator: A11yLocator = { nameExact: "Submit" };
      const found = tree.find(locator);

      expect(found).toBeDefined();
      expect(found?.id).toBe("btn-1");
    });

    it("should find element by role and name", () => {
      const root = createNode({
        role: "main",
        children: [
          createNode({ id: "btn-1", role: "button", name: "Submit" }),
          createNode({ id: "link-1", role: "link", name: "Submit" }),
        ],
      });

      const tree = new A11yTree(root);
      const locator: A11yLocator = { role: "link", name: "Submit" };
      const found = tree.find(locator);

      expect(found).toBeDefined();
      expect(found?.id).toBe("link-1");
      expect(found?.role).toBe("link");
    });

    it("should find element by state", () => {
      const root = createNode({
        role: "main",
        children: [
          createNode({ id: "btn-1", role: "button", state: { disabled: false } }),
          createNode({ id: "btn-2", role: "button", state: { disabled: true } }),
        ],
      });

      const tree = new A11yTree(root);
      const locator: A11yLocator = { role: "button", state: { disabled: true } };
      const found = tree.find(locator);

      expect(found).toBeDefined();
      expect(found?.id).toBe("btn-2");
    });

    it("should return undefined if not found", () => {
      const root = createNode({
        role: "main",
        children: [
          createNode({ id: "btn-1", role: "button", name: "Submit" }),
        ],
      });

      const tree = new A11yTree(root);
      const locator: A11yLocator = { role: "link" };
      const found = tree.find(locator);

      expect(found).toBeUndefined();
    });

    it("should find nth element when multiple match", () => {
      const root = createNode({
        role: "main",
        children: [
          createNode({ id: "btn-1", role: "button", name: "Click" }),
          createNode({ id: "btn-2", role: "button", name: "Click" }),
          createNode({ id: "btn-3", role: "button", name: "Click" }),
        ],
      });

      const tree = new A11yTree(root);
      const locator: A11yLocator = { role: "button", nth: 1 };
      const found = tree.find(locator);

      expect(found).toBeDefined();
      expect(found?.id).toBe("btn-2");
    });
  });

  describe("findAll", () => {
    it("should find all matching elements", () => {
      const root = createNode({
        role: "main",
        children: [
          createNode({ id: "btn-1", role: "button", name: "Submit" }),
          createNode({ id: "btn-2", role: "button", name: "Cancel" }),
          createNode({ id: "link-1", role: "link", name: "Home" }),
        ],
      });

      const tree = new A11yTree(root);
      const locator: A11yLocator = { role: "button" };
      const found = tree.findAll(locator);

      expect(found).toHaveLength(2);
      expect(found[0].id).toBe("btn-1");
      expect(found[1].id).toBe("btn-2");
    });

    it("should return empty array if none found", () => {
      const root = createNode({
        role: "main",
        children: [
          createNode({ id: "btn-1", role: "button", name: "Submit" }),
        ],
      });

      const tree = new A11yTree(root);
      const locator: A11yLocator = { role: "link" };
      const found = tree.findAll(locator);

      expect(found).toHaveLength(0);
    });

    it("should filter by visibility", () => {
      const root = createNode({
        role: "main",
        children: [
          createNode({ 
            id: "btn-1", 
            role: "button", 
            boundingBox: { x: 0, y: 0, width: 100, height: 100 } 
          }),
          createNode({ 
            id: "btn-2", 
            role: "button", 
            boundingBox: { x: 0, y: 0, width: 0, height: 0 } // Hidden
          }),
        ],
      });

      const tree = new A11yTree(root);
      const locator: A11yLocator = { role: "button", visible: true };
      const found = tree.findAll(locator);

      expect(found).toHaveLength(1);
      expect(found[0].id).toBe("btn-1");
    });

    it("should find hidden elements when visible is false", () => {
      const root = createNode({
        role: "main",
        children: [
          createNode({ 
            id: "btn-1", 
            role: "button", 
            boundingBox: { x: 0, y: 0, width: 100, height: 100 } 
          }),
          createNode({ 
            id: "btn-2", 
            role: "button", 
            boundingBox: { x: 0, y: 0, width: 0, height: 0 } 
          }),
        ],
      });

      const tree = new A11yTree(root);
      const locator: A11yLocator = { role: "button", visible: false };
      const found = tree.findAll(locator);

      expect(found).toHaveLength(2);
    });
  });

  describe("toString", () => {
    it("should generate readable tree representation", () => {
      const root = createNode({
        role: "main",
        name: "Main Content",
        children: [
          createNode({ role: "button", name: "Submit" }),
          createNode({ role: "link", name: "Home" }),
        ],
      });

      const tree = new A11yTree(root);
      const str = tree.toString();

      expect(str).toContain("main");
      expect(str).toContain("Main Content");
      expect(str).toContain("button");
      expect(str).toContain("Submit");
      expect(str).toContain("link");
      expect(str).toContain("Home");
    });
  });
});
