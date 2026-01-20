/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Example demonstrating Electron session partitions for cookie isolation
 */

import { Workflow } from "@workglow/task-graph";
import { CookieStore, ElectronContext } from "../src/electron";

/**
 * Example 1: Multi-Account Browsing with Isolated Sessions
 * 
 * Use persistent partitions to maintain separate cookie jars for different accounts
 */
async function multiAccountExample() {
  console.log("\n=== Multi-Account Example ===\n");

  // Account 1 - Persistent session
  const cookies1 = new CookieStore();
  const account1 = new ElectronContext(
    {
      partition: "persist:account-1", // Stored on disk
      headless: true,
    },
    cookies1
  );

  // Account 2 - Different persistent session (completely isolated)
  const cookies2 = new CookieStore();
  const account2 = new ElectronContext(
    {
      partition: "persist:account-2", // Separate partition = isolated cookies
      headless: true,
    },
    cookies2
  );

  console.log("Account 1 partition:", account1.config.partition);
  console.log("Account 2 partition:", account2.config.partition);
  console.log("\n✓ Each account has isolated cookies, cache, and storage");
  console.log("✓ Sessions persist across app restarts");
}

/**
 * Example 2: Guest Mode with Temporary Session
 * 
 * Use in-memory partition for guest browsing that doesn't persist
 */
async function guestModeExample() {
  console.log("\n=== Guest Mode Example ===\n");

  const guestCookies = new CookieStore();
  const guestContext = new ElectronContext(
    {
      partition: "guest-session", // No "persist:" = in-memory only
      headless: true,
    },
    guestCookies
  );

  console.log("Guest partition:", guestContext.config.partition);
  console.log("\n✓ Guest session is in-memory only");
  console.log("✓ All cookies and data cleared when app quits");
  console.log("✓ Perfect for privacy-focused browsing");
}

/**
 * Example 3: Secure Admin Panel with Dedicated Session
 * 
 * Isolate sensitive admin cookies from regular user content
 */
async function adminPanelExample() {
  console.log("\n=== Admin Panel Isolation Example ===\n");

  // Regular user session
  const userCookies = new CookieStore();
  const userContext = new ElectronContext(
    {
      partition: "persist:user", // Regular user session
      headless: true,
    },
    userCookies
  );

  // Admin session (completely isolated)
  const adminCookies = new CookieStore();
  const adminContext = new ElectronContext(
    {
      partition: "persist:admin", // Admin session
      headless: true,
    },
    adminCookies
  );

  console.log("User partition:", userContext.config.partition);
  console.log("Admin partition:", adminContext.config.partition);
  console.log("\n✓ Admin cookies cannot leak to user session");
  console.log("✓ User session cannot access admin cookies");
  console.log("✓ Security boundary enforced by Electron");
}

/**
 * Example 4: Using Partitions with Workflow API
 */
async function workflowWithPartitionsExample() {
  console.log("\n=== Workflow with Partitions Example ===\n");

  const cookies = new CookieStore();

  // This would be used in an actual Electron app
  const workflowCode = `
const workflow = new Workflow()
  .browser({ 
    backend: "electron",
    partition: "persist:user-session",
    cookies: myCookies
  })
  .navigate({ url: "https://example.com" })
  .extract({ locator: { role: "heading" } });

const result = await workflow.run();
  `;

  console.log("Workflow with partition:");
  console.log(workflowCode);
  console.log("\n✓ Partition ensures session isolation");
  console.log("✓ Cookies persist across app restarts");
}

/**
 * Example 5: Session Comparison Table
 */
function sessionComparisonExample() {
  console.log("\n=== Session Type Comparison ===\n");
  
  console.log("┌────────────────────┬───────────────┬─────────────────┬──────────────────┐");
  console.log("│ Partition Type     │ Syntax        │ Persistence     │ Use Case         │");
  console.log("├────────────────────┼───────────────┼─────────────────┼──────────────────┤");
  console.log("│ Default            │ undefined     │ Persistent      │ Main app session │");
  console.log("│ Persistent         │ persist:name  │ Stored on disk  │ User accounts    │");
  console.log("│ In-Memory          │ name          │ Memory only     │ Guest mode       │");
  console.log("└────────────────────┴───────────────┴─────────────────┴──────────────────┘");
  
  console.log("\nKey Points:");
  console.log("  • Different partitions = isolated cookie jars");
  console.log("  • Same partition = shared cookies across windows");
  console.log("  • Persistent partitions survive app restarts");
  console.log("  • In-memory partitions are cleared on quit");
}

// Run examples
if (import.meta.main) {
  (async () => {
    try {
      await multiAccountExample();
      await guestModeExample();
      await adminPanelExample();
      await workflowWithPartitionsExample();
      sessionComparisonExample();
      
      console.log("\n✅ All partition examples completed!\n");
      process.exit(0);
    } catch (error) {
      console.error("\n❌ Example failed:", error);
      process.exit(1);
    }
  })();
}

export {
  multiAccountExample,
  guestModeExample,
  adminPanelExample,
  workflowWithPartitionsExample,
  sessionComparisonExample,
};
