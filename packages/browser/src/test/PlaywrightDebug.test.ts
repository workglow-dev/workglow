/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "bun:test";
import { CookieStore } from "../context/CookieStore";
import type { IBrowserContext } from "../context/IBrowserContext";
import { createPlaywrightContext } from "../context/PlaywrightContext";

// This is a debug/exploration test file - skipped in batch runs to reduce xvfb resource usage.
// Run individually with: bun test src/test/PlaywrightDebug.test.ts
describe("Playwright Debug", () => {
  let context: IBrowserContext | undefined;

  afterEach(async () => {
    if (context) {
      await context.close();
      context = undefined;
    }
  });

  it("should debug accessibility tree structure", async () => {
    const cookies = new CookieStore();
    context = await createPlaywrightContext(
      { headless: true, timeout: 30000 },
      cookies
    );

    // Navigate to example.com
    await context.navigate("https://example.com");

    // Get accessibility tree
    const tree = await context.getAccessibilityTree();
    
    // Debug: print the tree
    console.log("\n=== Accessibility Tree ===");
    console.log(tree.toString());
    console.log("=========================\n");

    // Debug: print root node details
    console.log("Root node:", {
      role: tree.root.role,
      name: tree.root.name,
      childCount: tree.root.children.length,
    });

    // Debug: print all nodes
    const allNodes = tree.findAll({});
    console.log(`Total nodes in tree: ${allNodes.length}`);
    
    // Print first 10 nodes
    console.log("\nFirst 10 nodes:");
    allNodes.slice(0, 10).forEach((node, i) => {
      console.log(`${i + 1}. role: ${node.role}, name: "${node.name}", tag: ${node.tagName}`);
    });

    expect(tree).toBeDefined();
    expect(tree.root).toBeDefined();
  }, 60000);
});
