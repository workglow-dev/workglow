/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive example showing all browser automation capabilities
 */

import { Workflow } from "@workglow/task-graph";
import { CookieStore, createPlaywrightContext } from "../src/node";

/**
 * Example 1: Using the high-level Workflow API
 */
async function workflowExample() {
  console.log("\n=== Workflow API Example ===\n");

  const cookies = new CookieStore();
  
  const workflow = new Workflow()
    .browser({ 
      cookies, 
      headless: true,
      viewport: { width: 1280, height: 720 }
    })
    .navigate({ url: "https://example.com" })
    .extract({ locator: { role: "heading" } })
    .screenshot({ fullPage: true });

  const result = await workflow.run();
  console.log("Extract result:", result);
  console.log("Cookies after workflow:", cookies.toJSON());
}

/**
 * Example 2: Using the low-level Context API
 */
async function contextExample() {
  console.log("\n=== Context API Example ===\n");

  const cookies = new CookieStore();
  
  // Create browser context
  const context = await createPlaywrightContext(
    { headless: true, timeout: 30000 },
    cookies
  );

  try {
    // Navigate
    await context.navigate("https://example.com");
    console.log("Current URL:", await context.getUrl());

    // Get accessibility tree
    const tree = await context.getAccessibilityTree();
    console.log("\nAccessibility Tree:");
    console.log(tree.toString());

    // Find elements using A11y locators
    const heading = tree.find({ role: "heading" });
    console.log("\nFound heading:", heading?.name);

    const link = tree.find({ role: "link", name: /more/i });
    console.log("Found link:", link?.name);

    // Take screenshot
    const screenshot = await context.screenshot({ type: "png" });
    console.log(`\nScreenshot captured: ${screenshot.length} bytes`);

    // Execute JavaScript
    const title = await context.evaluate<string>("document.title");
    console.log("Page title:", title);

  } finally {
    await context.close();
  }
}

/**
 * Example 3: Cookie management across sessions
 */
async function cookieExample() {
  console.log("\n=== Cookie Management Example ===\n");

  // Create and populate cookie store
  const cookies = new CookieStore();
  cookies.set({
    name: "session_id",
    value: "abc123xyz",
    domain: "example.com",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    expires: Date.now() + 86400000, // 24 hours
  });

  // Save cookies to JSON (could persist to file/database)
  const cookieJson = cookies.toJSON();
  console.log("Saved cookies:", JSON.stringify(cookieJson, null, 2));

  // Later: restore cookies from JSON
  const restoredCookies = CookieStore.fromJSON(cookieJson);
  console.log("\nRestored cookies:", restoredCookies.getAll().length);

  // Use in workflow
  const context = await createPlaywrightContext(
    { headless: true },
    restoredCookies
  );

  await context.navigate("https://example.com");
  console.log("Navigation complete with cookies");
  
  await context.close();
}

/**
 * Example 4: Complex interaction flow
 */
async function interactionExample() {
  console.log("\n=== Complex Interaction Example ===\n");

  const cookies = new CookieStore();
  const context = await createPlaywrightContext(
    { headless: true, timeout: 30000 },
    cookies
  );

  try {
    // Navigate to page
    await context.navigate("https://example.com");

    // Get accessibility tree
    const tree = await context.getAccessibilityTree();

    // Find all links
    const links = tree.findAll({ role: "link" });
    console.log(`Found ${links.length} links on the page`);

    for (const link of links) {
      console.log(`  - "${link.name}" (${link.boundingBox.width}x${link.boundingBox.height})`);
    }

    // Find headings at different levels
    const h1 = tree.find({ role: "heading", state: { level: 1 } });
    if (h1) {
      console.log(`\nH1 heading: "${h1.name}"`);
    }

  } finally {
    await context.close();
  }
}

/**
 * Example 5: Electron backend (commented out as it requires Electron environment)
 */
async function electronExample() {
  console.log("\n=== Electron Backend Example ===\n");
  console.log("To use Electron backend:");
  console.log(`
const workflow = new Workflow()
  .browser({ 
    backend: "electron",
    headless: true  // Creates hidden BrowserWindow
  })
  .navigate({ url: "https://example.com" })
  .extract({ locator: { role: "heading" } });

const result = await workflow.run();
  `);
}

// Run examples
if (import.meta.main) {
  (async () => {
    try {
      await workflowExample();
      await contextExample();
      await cookieExample();
      await interactionExample();
      await electronExample();
      
      console.log("\n✅ All examples completed successfully!\n");
      process.exit(0);
    } catch (error) {
      console.error("\n❌ Example failed:", error);
      process.exit(1);
    }
  })();
}

export {
  workflowExample,
  contextExample,
  cookieExample,
  interactionExample,
  electronExample,
};
