/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Workflow } from "@workglow/task-graph";
import { CookieStore, type Cookie } from "../context/CookieStore";
import type { BrowserContextConfig, IBrowserContext } from "../context/IBrowserContext";
import { createPlaywrightContext } from "../context/PlaywrightContext";

/**
 * Configuration for initializing a browser workflow
 */
export interface BrowserWorkflowConfig extends Omit<BrowserContextConfig, "cookies"> {
  /**
   * Cookies to use for the browser session
   * Can be a CookieStore instance or an array of Cookie objects
   */
  readonly cookies?: CookieStore | readonly Cookie[];

  /**
   * Backend to use for browser automation
   * Defaults to "playwright"
   */
  readonly backend?: "playwright" | "electron" | "browserless" | "browserbase" | "brightdata";

  /**
   * Remote browser configuration (for cloud services)
   */
  readonly remote?: {
    readonly endpoint?: string;
    readonly apiKey?: string;
    readonly projectId?: string;
    readonly sessionId?: string;
    readonly region?: string;
    readonly zone?: string;
  };
}

/**
 * Create a browser context and return it as output
 * This is used as the first step in a browser workflow
 */
export async function initializeBrowserContext(
  config: BrowserWorkflowConfig = {}
): Promise<IBrowserContext> {
  // Create cookie store
  let cookieStore: CookieStore;
  if (config.cookies instanceof CookieStore) {
    cookieStore = config.cookies;
  } else if (Array.isArray(config.cookies)) {
    cookieStore = CookieStore.fromJSON(config.cookies);
  } else {
    cookieStore = new CookieStore();
  }

  // Create browser context based on backend
  const backend = config.backend || "playwright";
  
  const contextConfig: BrowserContextConfig = {
    viewport: config.viewport,
    userAgent: config.userAgent,
    headless: config.headless,
    extraHTTPHeaders: config.extraHTTPHeaders,
    ignoreHTTPSErrors: config.ignoreHTTPSErrors,
    timeout: config.timeout,
  };

  if (backend === "playwright") {
    return await createPlaywrightContext(contextConfig, cookieStore);
  } else if (backend === "electron") {
    // Import ElectronContext dynamically
    const { createElectronContext } = await import("../context/ElectronContext");
    return await createElectronContext(contextConfig, cookieStore);
  } else if (backend === "browserless" || backend === "browserbase" || backend === "brightdata") {
    // Import RemoteBrowserContext dynamically
    const { createRemoteBrowserContext } = await import("../context/RemoteBrowserContext");
    
    const remoteConfig: any = {
      ...contextConfig,
      provider: backend,
      apiKey: config.remote?.apiKey,
      endpoint: config.remote?.endpoint,
      projectId: config.remote?.projectId,
      sessionId: config.remote?.sessionId,
      providerOptions: {
        region: config.remote?.region,
        zone: config.remote?.zone,
      },
    };
    
    return await createRemoteBrowserContext(remoteConfig, cookieStore);
  } else {
    throw new Error(`Unsupported backend: ${backend}`);
  }
}

/**
 * Extend Workflow with a browser initialization method
 */
declare module "@workglow/task-graph" {
  interface Workflow {
    /**
     * Initialize a browser context for the workflow
     * This creates a browser context that can be passed through subsequent tasks
     * 
     * @param config Browser configuration
     * @returns Workflow with browser context initialized
     * 
     * @example
     * ```typescript
     * const result = await new Workflow()
     *   .browser({ cookies: savedCookies })
     *   .navigate({ url: "https://example.com" })
     *   .click({ locator: { role: "button", name: "Login" } })
     *   .run();
     * ```
     */
    browser(config?: BrowserWorkflowConfig): Workflow;
  }
}

/**
 * Implementation of browser() method for Workflow
 */
Workflow.prototype.browser = function (config: BrowserWorkflowConfig = {}): Workflow {
  // Import the BrowserInitTask
  const { BrowserInitTask } = require("../task/BrowserInitTask");
  
  const task = new BrowserInitTask({}, { browserConfig: config });
  this.graph.addTask(task);
  
  return this;
};

/**
 * Helper function to create a browser workflow
 * 
 * @param config Browser configuration
 * @returns New workflow with browser context initialized
 * 
 * @example
 * ```typescript
 * const workflow = browserWorkflow({ cookies: savedCookies })
 *   .navigate({ url: "https://example.com" })
 *   .click({ locator: { role: "button", name: "Login" } });
 * 
 * const result = await workflow.run();
 * ```
 */
export function browserWorkflow(config?: BrowserWorkflowConfig): Workflow {
  return new Workflow().browser(config);
}
