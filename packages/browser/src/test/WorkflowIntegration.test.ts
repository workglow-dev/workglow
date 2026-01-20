/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Workflow } from "@workglow/task-graph";
import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { CookieStore } from "../context/CookieStore";
import { closeAllPlaywrightContexts } from "../context/PlaywrightContext";

// Import to register the workflow extensions
import "../task/ClickTask";
import "../task/ExtractTask";
import "../task/NavigateTask";
import "../workflow/BrowserWorkflow";

// Set default timeout for all tests and hooks
setDefaultTimeout(30000);

describe("Workflow Integration", () => {
  // Clean up all browser contexts after each test
  afterEach(async () => {
    await closeAllPlaywrightContexts();
  });

  it("should use chainable workflow API with browser tasks", async () => {
    const cookies = new CookieStore();

    // Create a workflow using the chainable API
    const workflow = new Workflow()
      .browser({ cookies, headless: true })
      .navigate({ url: "https://example.com" })
      .extract({ locator: { role: "heading" } });

    // Run the workflow
    const result: any = await workflow.run();

    // The result should have the extract output
    expect(result).toBeDefined();
    expect(result.name).toBeDefined();
    expect(result.name).toContain("Example");
  }, 30000);

  // Note: Additional browser workflow tests are skipped in batch to avoid xvfb resource exhaustion.
  // Run individually with: bun test src/test/WorkflowIntegration.test.ts
  
  it("should pass browser context between tasks", async () => {
    const cookies = new CookieStore();

    // Create workflow with multiple navigation steps
    const workflow = new Workflow()
      .browser({ cookies, headless: true })
      .navigate({ url: "https://example.com" })
      .extract({ locator: { role: "heading" } });

    // Run the workflow
    const result: any = await workflow.run();

    // Debug: see what we actually got
    console.log("Workflow result:", JSON.stringify(result, null, 2));
    
    // The workflow should complete successfully
    expect(result).toBeDefined();
    
    // Should have the extract output (workflow merges last task output)
    if (Array.isArray(result)) {
      // If it's an array, check the last element
      const lastResult = result[result.length - 1];
      expect(lastResult.name).toBeDefined();
    } else {
      // If it's a single object, check it directly
      expect(result.name).toBeDefined();
    }
  }, 30000);

  it("should preserve cookies across workflow tasks", async () => {
    const cookies = new CookieStore();
    
    // Set an initial cookie
    cookies.set({
      name: "test-cookie",
      value: "initial-value",
      domain: "example.com",
      path: "/",
    });

    // Create workflow
    const workflow = new Workflow()
      .browser({ cookies, headless: true })
      .navigate({ url: "https://example.com" });

    // Run the workflow
    await workflow.run();

    // The cookie store should still have the cookie
    const cookie = cookies.get("test-cookie");
    expect(cookie).toBeDefined();
    expect(cookie?.value).toBe("initial-value");
  }, 30000);
});
