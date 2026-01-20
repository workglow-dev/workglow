/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Simple login example using browser automation with accessibility tree
 */

import { Workflow } from "@workglow/task-graph";
import { CookieStore } from "../src/context/CookieStore";
import "../src/node"; // Import browser tasks

async function loginExample() {
  // Create a cookie store for session management
  const cookies = new CookieStore();

  // Create a workflow with browser automation
  const workflow = new Workflow()
    .browser({
      cookies,
      headless: true,
      viewport: { width: 1280, height: 720 },
    })
    .navigate({ url: "https://example.com/login" })
    // Type into email field using accessibility locator
    .type({
      locator: { role: "textbox", name: /email/i },
      text: "user@example.com",
    })
    // Type into password field
    .type({
      locator: { role: "textbox", name: /password/i },
      text: "securePassword123",
      clear: true,
    })
    // Click the login button
    .click({
      locator: { role: "button", name: /sign in|login/i },
    })
    // Wait for the welcome message to appear
    .wait({
      locator: { role: "heading", name: /welcome/i },
      timeout: 10000,
    })
    // Extract the welcome message
    .extract({
      locator: { role: "heading", name: /welcome/i },
    });

  // Run the workflow
  try {
    const result = await workflow.run();
    console.log("Login successful!");
    console.log("Welcome message:", result);

    // Save cookies for next session
    const cookieJson = cookies.toJSON();
    console.log("Session cookies:", cookieJson);
    
    return result;
  } catch (error) {
    console.error("Login failed:", error);
    throw error;
  }
}

// Run the example if this file is executed directly
if (import.meta.main) {
  loginExample()
    .then(() => {
      console.log("Example completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Example failed:", error);
      process.exit(1);
    });
}

export { loginExample };
