/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Example of using Electron backend with hidden BrowserWindow
 * 
 * To run this example:
 * 1. Set up xvfb for headless display (Linux):
 *    xvfb-run -a bun run examples/electron-example.ts
 * 
 * 2. Or on macOS/Windows (Electron will create hidden window):
 *    bun run examples/electron-example.ts
 */

import { Workflow } from "@workglow/task-graph";
import { CookieStore } from "../src/context/CookieStore";
import "../src/electron";

async function electronExample() {
  console.log("\n=== Electron Backend Example ===\n");

  const cookies = new CookieStore();

  try {
    // Create a workflow using Electron backend
    const workflow = new Workflow()
      .browser({
        backend: "electron",
        cookies,
        headless: true, // Creates hidden BrowserWindow
        viewport: { width: 1280, height: 720 },
      })
      .navigate({ url: "https://example.com" })
      .extract({ locator: { role: "heading" } });

    // Run the workflow
    const result = await workflow.run();
    console.log("Result:", result);
    console.log("\n✅ Electron example completed successfully!");
    
    return result;
  } catch (error: any) {
    if (error.message?.includes("display") || error.message?.includes("DISPLAY")) {
      console.error("\n❌ Electron requires a display server.");
      console.error("   On Linux, run with: xvfb-run -a bun run examples/electron-example.ts");
      console.error("   Or install xvfb: sudo apt-get install xvfb");
    } else {
      console.error("\n❌ Example failed:", error.message);
    }
    throw error;
  }
}

/**
 * Example showing direct ElectronContext API
 */
async function electronDirectExample() {
  const { createElectronContext } = await import("../src/context/ElectronContext");
  const cookies = new CookieStore();

  const context = await createElectronContext(
    {
      headless: true,
      viewport: { width: 1280, height: 720 },
    },
    cookies
  );

  try {
    await context.navigate("https://example.com");
    
    const tree = await context.getAccessibilityTree();
    console.log("Accessibility Tree:");
    console.log(tree.toString());

    const heading = tree.find({ role: "heading" });
    console.log("Found heading:", heading?.name);

    await context.close();
  } catch (error) {
    await context.close();
    throw error;
  }
}

// Run the example if executed directly
if (import.meta.main) {
  electronExample()
    .then(() => {
      console.log("\nExample completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\nExample failed:", error);
      process.exit(1);
    });
}

export { electronDirectExample, electronExample };

