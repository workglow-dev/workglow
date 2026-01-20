/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { CookieStore } from "../context/CookieStore";
import type { IBrowserContext } from "../context/IBrowserContext";
import { createPlaywrightContext } from "../context/PlaywrightContext";

// Set default timeout for all tests and hooks in this file
setDefaultTimeout(10000);

describe("Playwright Integration", () => {
  let context: IBrowserContext | undefined;

  afterEach(async () => {
    if (context) {
      try {
        await context.close();
      } catch (error) {
        console.error("Error closing context:", error);
      }
      context = undefined;
    }
  });

  it("should navigate to example.com and extract title", async () => {
    const cookies = new CookieStore();
    context = await createPlaywrightContext(
      { headless: true, timeout: 3000 },
      cookies
    );

    // Navigate to example.com
    await context.navigate("https://example.com");

    // Get current URL
    const url = await context.getUrl();
    expect(url).toBe("https://example.com/");

    // Get accessibility tree
    const tree = await context.getAccessibilityTree();
    expect(tree).toBeDefined();
    expect(tree.root).toBeDefined();

    // Find heading on the page
    const heading = tree.find({ role: "heading" });
    expect(heading).toBeDefined();
    expect(heading?.name).toContain("Example");
  }, 30000);

  it("should extract multiple elements from page", async () => {
    const cookies = new CookieStore();
    context = await createPlaywrightContext(
      { headless: true, timeout: 30000 },
      cookies
    );

    // Navigate to example.com
    await context.navigate("https://example.com");

    // Get accessibility tree
    const tree = await context.getAccessibilityTree();

    // Find heading
    const heading = tree.find({ role: "heading" });
    expect(heading).toBeDefined();
    expect(heading?.name).toContain("Example");

    // Find link
    const link = tree.find({ role: "link" });
    expect(link).toBeDefined();
    expect(link?.name).toContain("more");
  }, 30000);

  it("should take a screenshot", async () => {
    const cookies = new CookieStore();
    context = await createPlaywrightContext(
      { headless: true, timeout: 30000 },
      cookies
    );

    // Navigate to example.com
    await context.navigate("https://example.com");

    // Take screenshot
    const screenshot = await context.screenshot({ type: "png" });
    
    expect(screenshot).toBeDefined();
    expect(screenshot.length).toBeGreaterThan(0);
    
    // Verify it's a PNG file (starts with PNG magic number)
    expect(screenshot[0]).toBe(0x89); // PNG signature
    expect(screenshot[1]).toBe(0x50); // P
    expect(screenshot[2]).toBe(0x4e); // N
    expect(screenshot[3]).toBe(0x47); // G
  }, 30000);

  it("should execute JavaScript in page context", async () => {
    const cookies = new CookieStore();
    context = await createPlaywrightContext(
      { headless: true, timeout: 30000 },
      cookies
    );

    // Navigate to example.com
    await context.navigate("https://example.com");

    // Execute JavaScript
    const title = await context.evaluate<string>("document.title");
    expect(title).toBe("Example Domain");

    // Get page dimensions
    const dimensions = await context.evaluate<{ width: number; height: number }>(
      "({ width: window.innerWidth, height: window.innerHeight })"
    );
    expect(dimensions.width).toBeGreaterThan(0);
    expect(dimensions.height).toBeGreaterThan(0);
  }, 30000);

  it("should handle cookies", async () => {
    const cookies = new CookieStore();
    
    // Set a cookie before navigation
    cookies.set({
      name: "test-cookie",
      value: "test-value",
      domain: "example.com",
      path: "/",
    });

    context = await createPlaywrightContext(
      { headless: true, timeout: 30000 },
      cookies
    );

    // Navigate to example.com
    await context.navigate("https://example.com");

    // Execute JavaScript to check cookies
    const pageCookies = await context.evaluate<Record<string, string>>(
      "document.cookie.split('; ').reduce((acc, c) => { if (c) { const [k,v] = c.split('='); if (k) acc[k] = v; } return acc; }, {})"
    );
    
    // The cookie should be set
    expect(pageCookies["test-cookie"]).toBe("test-value");
  }, 30000);

  it("should wait for elements to appear", async () => {
    const cookies = new CookieStore();
    // Use the shared context variable so afterEach can clean up if test times out
    context = await createPlaywrightContext(
      { headless: true, timeout: 30000 },
      cookies
    );

    // Navigate to example.com
    await context.navigate("https://example.com", { timeout: 30000 });

    // Wait for heading to appear (it should already be there)
    await context.waitFor(
      async () => {
        const tree = await context!.getAccessibilityTree();
        const heading = tree.find({ role: "heading" });
        return heading !== undefined;
      },
      { timeout: 5000, pollingInterval: 100 }
    );

    // If we get here, the wait succeeded
    const tree = await context.getAccessibilityTree();
    const heading = tree.find({ role: "heading" });
    expect(heading).toBeDefined();
  }, 30000);

  it("should find multiple elements with findAll", async () => {
    const cookies = new CookieStore();
    context = await createPlaywrightContext(
      { headless: true, timeout: 30000 },
      cookies
    );

    // Navigate to example.com (simpler, more reliable)
    await context.navigate("https://example.com", { timeout: 30000 });

    // Get accessibility tree
    const tree = await context.getAccessibilityTree();

    // Find all generic elements (containers)
    const containers = tree.findAll({ role: "generic" });
    expect(containers.length).toBeGreaterThan(0);

    // Find all links
    const links = tree.findAll({ role: "link" });
    expect(links.length).toBeGreaterThan(0);
  }, 30000);

  it("should find and identify clickable links", async () => {
    const cookies = new CookieStore();
    context = await createPlaywrightContext(
      { headless: true, timeout: 30000 },
      cookies
    );

    // Navigate to example.com
    await context.navigate("https://example.com", { timeout: 30000 });
    
    const url = await context.getUrl();
    expect(url).toBe("https://example.com/");

    // Get accessibility tree
    const tree = await context.getAccessibilityTree();

    // Find the "Learn more" link
    const link = tree.find({ role: "link", name: /learn|more/i });
    expect(link).toBeDefined();
    expect(link?.role).toBe("link");
    expect(link?.name.toLowerCase()).toContain("more");
    
    // Verify link has valid bounding box
    expect(link?.boundingBox.width).toBeGreaterThan(0);
    expect(link?.boundingBox.height).toBeGreaterThan(0);
  }, 30000);
});

