/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Side-by-side comparison of session isolation in Playwright vs Electron
 */

import { Workflow } from "@workglow/task-graph";
import { CookieStore } from "../src/context/CookieStore";

console.log(`
╔════════════════════════════════════════════════════════════════╗
║        Session Isolation: Playwright vs Electron              ║
╚════════════════════════════════════════════════════════════════╝
`);

// ============================================================================
// SCENARIO 1: Non-Persistent (Temporary) Sessions
// ============================================================================

console.log("\n1. NON-PERSISTENT SESSIONS (Cleared on Close)\n");
console.log("   Playwright (default behavior):");
console.log("   ────────────────────────────────");

const playwrightTemp = `
const workflow = new Workflow()
  .browser({ 
    backend: "playwright",
    // No userDataDir = non-persistent
  })
  .navigate({ url: "https://example.com" });
`;
console.log(playwrightTemp);

console.log("\n   Electron (in-memory partition):");
console.log("   ────────────────────────────────");

const electronTemp = `
const workflow = new Workflow()
  .browser({
    backend: "electron",
    partition: "temp-session",  // No persist: prefix
  })
  .navigate({ url: "https://example.com" });
`;
console.log(electronTemp);

// ============================================================================
// SCENARIO 2: Persistent Sessions (Survive Restarts)
// ============================================================================

console.log("\n2. PERSISTENT SESSIONS (Survive App Restarts)\n");
console.log("   Playwright (userDataDir):");
console.log("   ──────────────────────────");

const playwrightPersist = `
const workflow = new Workflow()
  .browser({
    backend: "playwright",
    userDataDir: "./browser-data/profile-1",  // Auto-save to disk
  })
  .navigate({ url: "https://example.com" });
`;
console.log(playwrightPersist);

console.log("\n   Electron (persist: partition):");
console.log("   ────────────────────────────────");

const electronPersist = `
const workflow = new Workflow()
  .browser({
    backend: "electron",
    partition: "persist:profile-1",  // Auto-save to disk
  })
  .navigate({ url: "https://example.com" });
`;
console.log(electronPersist);

// ============================================================================
// SCENARIO 3: Multi-Account Support
// ============================================================================

console.log("\n3. MULTI-ACCOUNT SUPPORT (Isolated Sessions)\n");
console.log("   Playwright (separate userDataDir):");
console.log("   ────────────────────────────────────");

const playwrightMulti = `
// Account 1
.browser({ userDataDir: "./profiles/user1@example.com" })

// Account 2 (completely isolated)
.browser({ userDataDir: "./profiles/user2@example.com" })
`;
console.log(playwrightMulti);

console.log("\n   Electron (separate partitions):");
console.log("   ─────────────────────────────────");

const electronMulti = `
// Account 1
.browser({ partition: "persist:user1@example.com" })

// Account 2 (completely isolated)
.browser({ partition: "persist:user2@example.com" })
`;
console.log(electronMulti);

// ============================================================================
// SCENARIO 4: Manual State Management
// ============================================================================

console.log("\n4. MANUAL STATE SAVE/LOAD\n");
console.log("   Playwright (storageState):");
console.log("   ────────────────────────────");

const playwrightManual = `
// Save after login
const context = await createPlaywrightContext({}, cookies);
await context.navigate("https://example.com/login");
// ... perform login ...
const state = await context.context.storageState({ path: "auth.json" });

// Load later
.browser({ storageState: "auth.json" })
`;
console.log(playwrightManual);

console.log("\n   Electron (CookieStore + manual save):");
console.log("   ────────────────────────────────────────");

const electronManual = `
// Save cookies manually
const cookies = new CookieStore();
// ... use cookies ...
fs.writeFileSync("cookies.json", JSON.stringify(cookies.toJSON()));

// Load later
const restored = CookieStore.fromJSON(JSON.parse(fs.readFileSync("cookies.json")));
.browser({ cookies: restored })
`;
console.log(electronManual);

// ============================================================================
// SUMMARY TABLE
// ============================================================================

console.log("\n\n╔═══════════════════════════════════════════════════════════════╗");
console.log("║                    FEATURE COMPARISON                         ║");
console.log("╠═══════════════════════════════════════════════════════════════╣");
console.log("║                                                               ║");
console.log("║  Feature              │ Electron          │ Playwright        ║");
console.log("║  ─────────────────────┼───────────────────┼──────────────────║");
console.log("║  Simple Isolation     │ partition: \"name\" │ Default          ║");
console.log("║  Persistent Session   │ persist:name      │ userDataDir      ║");
console.log("║  Manual Save/Load     │ CookieStore       │ storageState     ║");
console.log("║  Cross-Window Share   │ ✅ Same partition │ ❌ Always isolate║");
console.log("║  Auto-Persistence     │ ✅ persist:        │ ✅ userDataDir   ║");
console.log("║  IndexedDB Persist    │ ✅ Automatic       │ ✅ Automatic     ║");
console.log("║  Cache Persist        │ ✅ Automatic       │ ✅ Automatic     ║");
console.log("║                                                               ║");
console.log("╚═══════════════════════════════════════════════════════════════╝\n");

console.log("✅ Both backends provide powerful session isolation!");
console.log("✅ Choose based on your runtime: Electron app vs Node.js/standalone");
console.log("\nFor more details, see docs/PLAYWRIGHT_PERSISTENT.md\n");
