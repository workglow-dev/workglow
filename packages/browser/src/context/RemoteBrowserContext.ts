/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Browser, BrowserContext, Page } from "playwright";
import type { A11yNode, SerializedA11yNode } from "../a11y/A11yNode";
import { A11yTree } from "../a11y/A11yTree";
import { parseAccessibilityTree } from "../a11y/A11yParser";
import { CookieStore, type Cookie } from "./CookieStore";
import type {
  IBrowserContext,
  BrowserContextConfig,
  NavigateOptions,
  ClickOptions,
  TypeOptions,
  ScreenshotOptions,
  WaitOptions,
} from "./IBrowserContext";

/**
 * Configuration for remote browser services
 */
export interface RemoteBrowserConfig extends BrowserContextConfig {
  /**
   * Remote browser service provider
   */
  readonly provider: "browserless" | "browserbase" | "cloudflare" | "brightdata";

  /**
   * WebSocket endpoint URL for the remote browser
   * Required for browserless, optional for others (will be constructed)
   */
  readonly endpoint?: string;

  /**
   * API key for authentication
   */
  readonly apiKey?: string;

  /**
   * Project ID (for Browserbase)
   */
  readonly projectId?: string;

  /**
   * Session ID for reconnecting to existing session
   */
  readonly sessionId?: string;

  /**
   * Additional provider-specific options
   */
  readonly providerOptions?: Record<string, any>;
}

/**
 * Browser context implementation for remote browser services
 * 
 * Supports:
 * - Browserless (open-source remote browser)
 * - Browserbase (managed browser infrastructure)
 * - Cloudflare Browser Rendering
 * - Bright Data Browser API
 */
export class RemoteBrowserContext implements IBrowserContext {
  readonly cookies: CookieStore;
  readonly config: RemoteBrowserConfig;

  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private parserScript: string;
  private sessionId: string | undefined;

  constructor(config: RemoteBrowserConfig, cookies: CookieStore) {
    this.config = config;
    this.cookies = cookies;
    this.sessionId = config.sessionId;
    
    // Pre-compile the parser script
    this.parserScript = `(${parseAccessibilityTree.toString()})()`;
  }

  /**
   * Get the WebSocket endpoint for the provider
   */
  private getEndpoint(): string {
    if (this.config.endpoint) {
      return this.config.endpoint;
    }

    const apiKey = this.config.apiKey;
    
    switch (this.config.provider) {
      case "browserless":
        // Default Browserless endpoint
        const browserlessRegion = this.config.providerOptions?.region || "sfo";
        return `wss://production-${browserlessRegion}.browserless.io?token=${apiKey}`;
      
      case "brightdata":
        // Bright Data WebSocket endpoint
        const brightdataZone = this.config.providerOptions?.zone || "residential";
        return `wss://brd-customer-${apiKey}-zone-${brightdataZone}.zproxy.lum-superproxy.io:9222`;
      
      case "cloudflare":
        throw new Error(
          "Cloudflare Browser Rendering requires using @cloudflare/playwright in Workers. " +
          "Use PlaywrightContext for standard Playwright or see Cloudflare documentation."
        );
      
      case "browserbase":
        throw new Error(
          "Browserbase requires creating a session first via their SDK. " +
          "Set config.endpoint to the session's connectUrl."
        );
      
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }
  }

  /**
   * Initialize connection to remote browser
   */
  private async ensureInitialized(): Promise<void> {
    if (this.page) {
      return;
    }

    try {
      // Import playwright dynamically
      const playwright = await import("playwright");
      
      const endpoint = this.getEndpoint();

      // Connect to remote browser via CDP
      this.browser = await playwright.chromium.connectOverCDP(endpoint);

      // Get default context (remote browsers typically provide one)
      const contexts = this.browser.contexts();
      if (contexts.length > 0) {
        this.context = contexts[0];
      } else {
        // Some providers require creating a new context
        this.context = await this.browser.newContext({
          viewport: this.config.viewport || { width: 1280, height: 720 },
          userAgent: this.config.userAgent,
        });
      }

      // Set default timeout
      if (this.config.timeout) {
        this.context.setDefaultTimeout(this.config.timeout);
      }

      // Get or create page
      const pages = this.context.pages();
      if (pages.length > 0) {
        this.page = pages[0];
      } else {
        this.page = await this.context.newPage();
      }

      // Inject cookies if provided
      if (this.cookies.getAll().length > 0) {
        await this.syncCookiesToBrowser();
      }

      // Listen for new cookies
      this.context.on("response", async () => {
        await this.syncCookiesFromBrowser();
      });
    } catch (error) {
      throw new Error(
        `Failed to connect to remote browser (${this.config.provider}): ${error instanceof Error ? error.message : String(error)}`
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
      expires: cookie.expires ? cookie.expires / 1000 : undefined,
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
        expires: cookie.expires ? cookie.expires * 1000 : undefined,
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
    const timeout = options?.timeout;

    await this.page!.goto(url, {
      waitUntil: waitUntil as any,
      timeout,
    });

    await this.syncCookiesFromBrowser();
  }

  async getUrl(): Promise<string> {
    await this.ensureInitialized();
    return this.page!.url();
  }

  async getAccessibilityTree(): Promise<A11yTree> {
    await this.ensureInitialized();

    const serializedTree = await this.page!.evaluate(this.parserScript) as SerializedA11yNode;

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

    await this.click(node);

    if (options?.clear) {
      await this.page!.keyboard.press("Control+A");
      await this.page!.keyboard.press("Backspace");
    }

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
    try {
      if (this.page) {
        await this.page.close();
        this.page = undefined;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = undefined;
      }
      // Note: Remote sessions may need explicit termination via provider API
    } catch (error) {
      console.error("Error closing remote browser context:", error);
    }
  }
}

/**
 * Create a remote browser context
 */
export async function createRemoteBrowserContext(
  config: RemoteBrowserConfig,
  cookies: CookieStore
): Promise<RemoteBrowserContext> {
  const context = new RemoteBrowserContext(config, cookies);
  return context;
}

/**
 * Helper to create Browserless context
 */
export async function createBrowserlessContext(
  apiKey: string,
  options: Partial<BrowserContextConfig> & { region?: string; cookies?: CookieStore } = {}
): Promise<RemoteBrowserContext> {
  const { region, cookies, ...config } = options;
  return createRemoteBrowserContext(
    {
      provider: "browserless",
      apiKey,
      providerOptions: { region },
      ...config,
    } as RemoteBrowserConfig,
    cookies || new CookieStore()
  );
}

/**
 * Helper to create Browserbase context
 */
export async function createBrowserbaseContext(
  connectUrl: string,
  options: Partial<BrowserContextConfig> & { cookies?: CookieStore } = {}
): Promise<RemoteBrowserContext> {
  const { cookies, ...config } = options;
  return createRemoteBrowserContext(
    {
      provider: "browserbase",
      endpoint: connectUrl,
      ...config,
    } as RemoteBrowserConfig,
    cookies || new CookieStore()
  );
}

/**
 * Helper to create Bright Data context
 */
export async function createBrightDataContext(
  customerId: string,
  zone: string,
  options: Partial<BrowserContextConfig> & { cookies?: CookieStore } = {}
): Promise<RemoteBrowserContext> {
  const { cookies, ...config } = options;
  return createRemoteBrowserContext(
    {
      provider: "brightdata",
      apiKey: customerId,
      providerOptions: { zone },
      ...config,
    } as RemoteBrowserConfig,
    cookies || new CookieStore()
  );
}
