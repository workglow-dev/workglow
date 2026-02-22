/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Examples of using remote browser services with @workglow/browser
 */

import { Workflow } from "@workglow/task-graph";
import { CookieStore, createBrowserlessContext } from "../src/node";

console.log(`
╔════════════════════════════════════════════════════════════════╗
║              Remote Browser Services Examples                 ║
╚════════════════════════════════════════════════════════════════╝
`);

// ============================================================================
// BROWSERLESS - Open Source Remote Browser
// ============================================================================

console.log("\n1. BROWSERLESS (Open Source)\n");

const browserlessExample = `
import { Workflow } from "@workglow/task-graph";
import "@workglow/browser";

const workflow = new Workflow()
  .browser({
    backend: "browserless",
    remote: {
      apiKey: process.env.BROWSERLESS_TOKEN,
      region: "sfo",  // sfo, lon, or ams
    },
  })
  .navigate({ url: "https://example.com" })
  .extract({ locator: { role: "heading" } });

const result = await workflow.run();
`;

console.log(browserlessExample);
console.log("Features:");
console.log("  ✓ Open source (can self-host)");
console.log("  ✓ WebSocket CDP connection");
console.log("  ✓ Multiple regions");
console.log("  ✓ Stealth mode available");

// ============================================================================
// BROWSERBASE - Managed Browser Infrastructure
// ============================================================================

console.log("\n2. BROWSERBASE (Managed Service)\n");

const browserbaseExample = `
import { Browserbase } from "@browserbasehq/sdk";

// Create session via SDK
const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
const session = await bb.sessions.create({
  projectId: process.env.BROWSERBASE_PROJECT_ID,
});

// Use with workflow
const workflow = new Workflow()
  .browser({
    backend: "browserbase",
    remote: {
      endpoint: session.connectUrl,
    },
  })
  .navigate({ url: "https://example.com" })
  .screenshot({ fullPage: true });

const result = await workflow.run();

// Clean up
await bb.sessions.stop(session.id);
`;

console.log(browserbaseExample);
console.log("Features:");
console.log("  ✓ Session recordings & replays");
console.log("  ✓ Live debugging dashboard");
console.log("  ✓ Stealth & fingerprinting");
console.log("  ✓ File uploads/downloads");
console.log("  ✓ Extensions support");

// ============================================================================
// BRIGHT DATA - Proxy Network + Browser
// ============================================================================

console.log("\n3. BRIGHT DATA (Proxy + Browser)\n");

const brightdataExample = `
const workflow = new Workflow()
  .browser({
    backend: "brightdata",
    remote: {
      apiKey: process.env.BRIGHT_DATA_CUSTOMER_ID,
      zone: "residential",  // residential, datacenter, mobile
    },
  })
  .navigate({ url: "https://example.com" })
  .extract({ locator: { role: "heading" } });

const result = await workflow.run();
`;

console.log(brightdataExample);
console.log("Features:");
console.log("  ✓ Residential/datacenter/mobile proxies");
console.log("  ✓ IP rotation");
console.log("  ✓ Geo-targeting");
console.log("  ✓ Captcha solving");

// ============================================================================
// CLOUDFLARE BROWSER RENDERING
// ============================================================================

console.log("\n4. CLOUDFLARE BROWSER RENDERING (Workers)\n");

const cloudflareExample = `
// Note: Cloudflare requires running inside Workers with @cloudflare/playwright
// Standard Playwright connection not supported

// In Cloudflare Worker:
import { launch } from "@cloudflare/playwright";

export default {
  async fetch(request, env) {
    const browser = await launch(env.MYBROWSER);
    const page = await browser.newPage();
    await page.goto("https://example.com");
    const screenshot = await page.screenshot();
    await browser.close();
    return new Response(screenshot);
  }
};

// For integration with @workglow/browser, use Workers environment
`;

console.log(cloudflareExample);
console.log("Features:");
console.log("  ✓ Runs on Cloudflare's edge network");
console.log("  ✓ Global distribution");
console.log("  ✓ Session reuse via acquire/connect");
console.log("  ⚠  Requires Cloudflare Workers runtime");

// ============================================================================
// COMPARISON TABLE
// ============================================================================

console.log("\n\n╔═══════════════════════════════════════════════════════════════╗");
console.log("║                  PROVIDER COMPARISON                          ║");
console.log("╠═══════════════════════════════════════════════════════════════╣");
console.log("║                                                               ║");
console.log("║  Provider      │ Self-Host │ Pricing      │ Key Feature      ║");
console.log("║  ──────────────┼───────────┼──────────────┼─────────────────║");
console.log("║  Browserless   │ ✅ Yes    │ Free/Paid    │ Open source     ║");
console.log("║  Browserbase   │ ❌ No     │ Paid         │ Recordings      ║");
console.log("║  Bright Data   │ ❌ No     │ Paid         │ Proxy network   ║");
console.log("║  Cloudflare    │ ❌ No     │ Free tier    │ Edge compute    ║");
console.log("║                                                               ║");
console.log("╚═══════════════════════════════════════════════════════════════╝\n");

console.log("All providers integrate seamlessly with @workglow/browser!");
console.log("Choose based on: pricing, features, and geographic requirements.\n");

export {
  browserlessExample,
  browserbaseExample,
  brightdataExample,
  cloudflareExample,
};
