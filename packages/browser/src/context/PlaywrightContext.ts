/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Browser, BrowserContext, Page } from "playwright";
import type { A11yNode, SerializedA11yNode } from "../a11y/A11yNode";
import { parseAccessibilityTree } from "../a11y/A11yParser";
import { A11yTree } from "../a11y/A11yTree";
import type { Cookie, CookieStore } from "./CookieStore";
import type {
  BrowserContextConfig,
  ClickOptions,
  IBrowserContext,
  NavigateOptions,
  ScreenshotOptions,
  TypeOptions,
  WaitOptions,
} from "./IBrowserContext";

/**
 * Global tracker for all active PlaywrightContext instances.
 * Used for cleanup in tests.
 */
const activeContexts: Set<PlaywrightContext> = new Set();

/**
 * Close all active PlaywrightContext instances.
 * Useful for test cleanup.
 */
export async function closeAllPlaywrightContexts(): Promise<void> {
  const contexts = Array.from(activeContexts);
  await Promise.all(contexts.map((ctx) => ctx.close()));
}

/**
 * Browser context implementation using Playwright
 */
export class PlaywrightContext implements IBrowserContext {
  readonly cookies: CookieStore;
  readonly config: BrowserContextConfig;

  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private parserScript: string;
  private responseHandler: (() => Promise<void>) | undefined;

  constructor(config: BrowserContextConfig, cookies: CookieStore) {
    this.config = config;
    this.cookies = cookies;
    
    // Pre-compile the parser script as a self-contained IIFE
    // The function includes all its dependencies internally
    this.parserScript = `(${parseAccessibilityTree.toString()})()`;
    
    // Track this instance for cleanup
    activeContexts.add(this);
  }

  // Track last browser launch time to prevent rapid-fire launches
  private static lastLaunchTime = 0;
  private static readonly MIN_LAUNCH_INTERVAL = 200; // ms between launches

  /**
   * Initialize Playwright browser and context
   */
  private async ensureInitialized(): Promise<void> {
    if (this.page) {
      return;
    }

    // Prevent rapid-fire browser launches that can exhaust xvfb resources
    // const now = Date.now();
    // const timeSinceLastLaunch = now - PlaywrightContext.lastLaunchTime;
    // if (timeSinceLastLaunch < PlaywrightContext.MIN_LAUNCH_INTERVAL) {
    //   await new Promise((resolve) =>
    //     setTimeout(resolve, PlaywrightContext.MIN_LAUNCH_INTERVAL - timeSinceLastLaunch)
    //   );
    // }
    PlaywrightContext.lastLaunchTime = Date.now();

    try {
      // Import playwright dynamically
      const playwright = await import("playwright");
      
      // Decide between launchPersistentContext vs regular launch
      if (this.config.userDataDir) {
        // Use persistent context (like Electron persistent partition)
        // This automatically saves/loads all browser data to disk
        const contextOptions: any = {
          headless: this.config.headless !== false,
          viewport: this.config.viewport || { width: 1280, height: 720 },
          userAgent: this.config.userAgent,
          extraHTTPHeaders: this.config.extraHTTPHeaders,
          ignoreHTTPSErrors: this.config.ignoreHTTPSErrors,
          ...(this.config.storageState ? { storageState: this.config.storageState } : {}),
        };

        this.context = await playwright.chromium.launchPersistentContext(
          this.config.userDataDir,
          contextOptions
        );
        
        // Get the default page (persistent context creates one automatically)
        const pages = this.context.pages();
        this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
      } else {
        // Regular browser + context (isolated, non-persistent by default)
        this.browser = await playwright.chromium.launch({
          headless: this.config.headless !== false,
        });

        // Create context with configuration
        const contextOptions: any = {
          viewport: this.config.viewport || { width: 1280, height: 720 },
          userAgent: this.config.userAgent,
          extraHTTPHeaders: this.config.extraHTTPHeaders,
          ignoreHTTPSErrors: this.config.ignoreHTTPSErrors,
          ...(this.config.storageState ? { storageState: this.config.storageState } : {}),
        };

        this.context = await this.browser.newContext(contextOptions);

        // Set default timeout
        if (this.config.timeout) {
          this.context.setDefaultTimeout(this.config.timeout);
        }

        // Inject cookies if provided and storageState not used
        if (!this.config.storageState && this.cookies.getAll().length > 0) {
          await this.syncCookiesToBrowser();
        }

        // Create page
        this.page = await this.context.newPage();
      }

      // Sync cookies from storageState if present
      if (this.config.storageState) {
        await this.syncCookiesFromBrowser();
      }

      // Listen for new cookies (save handler for cleanup)
      this.responseHandler = async () => {
        try {
          await this.syncCookiesFromBrowser();
        } catch {
          // Ignore errors during cookie sync (browser may be closing)
        }
      };
      this.context.on("response", this.responseHandler);
    } catch (error) {
      throw new Error(
        `Failed to initialize Playwright: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Sync cookies from CookieStore to browser
   */
  private async syncCookiesToBrowser(): Promise<void> {
    if (!this.context) return;

    const cookies = this.cookies.getAll().map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires ? cookie.expires / 1000 : undefined, // Convert to seconds
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite as "Strict" | "Lax" | "None" | undefined,
    }));

    await this.context.addCookies(cookies);
  }

  /**
   * Sync cookies from browser to CookieStore
   */
  private async syncCookiesFromBrowser(): Promise<void> {
    if (!this.context) return;

    const browserCookies = await this.context.cookies();
    
    for (const cookie of browserCookies) {
      const storeCookie: Cookie = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires ? cookie.expires * 1000 : undefined, // Convert to milliseconds
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite as "Strict" | "Lax" | "None" | undefined,
      };
      this.cookies.set(storeCookie);
    }
  }

  async navigate(url: string, options?: NavigateOptions): Promise<void> {
    await this.ensureInitialized();
    
    const waitUntil = options?.waitUntil || "load";
    // Use explicit timeout, or 80% of config timeout (leaving headroom for cleanup)
    const configTimeout = this.config.timeout ?? 30000;
    const timeout = options?.timeout ?? Math.floor(configTimeout * 0.8);

    await this.page!.goto(url, {
      waitUntil: waitUntil as any,
      timeout,
    });

    // Sync cookies after navigation
    await this.syncCookiesFromBrowser();
  }

  async getUrl(): Promise<string> {
    await this.ensureInitialized();
    return this.page!.url();
  }

  async getAccessibilityTree(): Promise<A11yTree> {
    await this.ensureInitialized();

    // Execute the parser script in the page context
    const serializedTree = await this.page!.evaluate(this.parserScript) as SerializedA11yNode;

    // Convert serialized tree to A11yNode
    const convertNode = (serialized: SerializedA11yNode): A11yNode => {
      return {
        ...serialized,
        children: serialized.children.map(convertNode),
      };
    };

    const rootNode = convertNode(serializedTree);
    return new A11yTree(rootNode);
  }

  async click(node: A11yNode, options?: ClickOptions): Promise<void> {
    await this.ensureInitialized();

    const { x, y, width, height } = node.boundingBox;
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    await this.page!.mouse.click(centerX, centerY, {
      button: options?.button || "left",
      clickCount: options?.clickCount || 1,
      delay: options?.delay,
    });
  }

  async type(node: A11yNode, text: string, options?: TypeOptions): Promise<void> {
    await this.ensureInitialized();

    // Click to focus the element
    await this.click(node);

    // Clear existing text if requested
    if (options?.clear) {
      await this.page!.keyboard.press("Control+A");
      await this.page!.keyboard.press("Backspace");
    }

    // Type the text
    await this.page!.keyboard.type(text, {
      delay: options?.delay,
    });
  }

  async screenshot(options?: ScreenshotOptions): Promise<Uint8Array> {
    await this.ensureInitialized();

    const buffer = await this.page!.screenshot({
      type: options?.type || "png",
      quality: options?.quality,
      fullPage: options?.fullPage,
      clip: options?.clip,
    });

    return buffer;
  }

  async evaluate<T = any>(script: string): Promise<T> {
    await this.ensureInitialized();
    return await this.page!.evaluate(script);
  }

  async waitFor(condition: () => Promise<boolean>, options?: WaitOptions): Promise<void> {
    await this.ensureInitialized();

    const timeout = options?.timeout || 30000;
    const pollingInterval = options?.pollingInterval || 100;
    const startTime = Date.now();

    while (true) {
      if (await condition()) {
        return;
      }

      if (Date.now() - startTime > timeout) {
        throw new Error(`Wait timeout exceeded: ${timeout}ms`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollingInterval));
    }
  }

  async goBack(): Promise<void> {
    await this.ensureInitialized();
    await this.page!.goBack();
  }

  async goForward(): Promise<void> {
    await this.ensureInitialized();
    await this.page!.goForward();
  }

  async reload(): Promise<void> {
    await this.ensureInitialized();
    await this.page!.reload();
  }

  async close(): Promise<void> {
    // Remove event listener before closing to prevent unhandled errors
    if (this.context && this.responseHandler) {
      try {
        this.context.off("response", this.responseHandler);
      } catch {
        // Ignore - context might already be invalid
      }
      this.responseHandler = undefined;
    }

    // Capture local reference before clearing so an in-flight close is unaffected
    const contextRef = this.context;

    // Always clear references before attempting close
    this.page = undefined;
    this.context = undefined;

    // Close with a timeout to prevent hanging
    const closePromise = (async () => {
      try {
        if (contextRef) {
          await contextRef.close();
        }
      } catch {
        // Ignore errors during close
      }
    })();

    // Race against a 5-second timeout
    await Promise.race([
      closePromise,
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
    this.browser = undefined;
    this.responseHandler = undefined;
    
    // Remove from global tracker
    activeContexts.delete(this);

    // Small delay to let browser process fully terminate
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Create a new Playwright browser context
 */
export async function createPlaywrightContext(
  config: BrowserContextConfig,
  cookies: CookieStore
): Promise<PlaywrightContext> {
  const context = new PlaywrightContext(config, cookies);
  return context;
}
