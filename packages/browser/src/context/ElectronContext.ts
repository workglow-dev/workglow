/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { A11yNode, SerializedA11yNode } from "../a11y/A11yNode";
import { A11yTree } from "../a11y/A11yTree";
import { parseAccessibilityTree } from "../a11y/A11yParser";
import type { Cookie, CookieStore } from "./CookieStore";
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
 * Browser context implementation using Electron BrowserWindow
 * 
 * This implementation uses Electron's BrowserWindow with show: false
 * to provide headless browser automation within an Electron app
 */
export class ElectronContext implements IBrowserContext {
  readonly cookies: CookieStore;
  readonly config: BrowserContextConfig;

  private window: any; // BrowserWindow instance
  private parserScript: string;

  constructor(config: BrowserContextConfig, cookies: CookieStore) {
    this.config = config;
    this.cookies = cookies;
    
    // Pre-compile the parser script as a self-contained IIFE
    // The function includes all its dependencies internally
    this.parserScript = `(${parseAccessibilityTree.toString()})()`;
  }

  /**
   * Initialize Electron BrowserWindow
   */
  private async ensureInitialized(): Promise<void> {
    if (this.window) {
      return;
    }

    try {
      // Import electron dynamically (type assertion needed for optional peer dep)
      const electron = await import("electron") as any;
      const BrowserWindow = electron.BrowserWindow || electron.default?.BrowserWindow;
      
      if (!BrowserWindow) {
        throw new Error(
          "BrowserWindow not available. ElectronContext must run inside an Electron app. " +
          "To test: create an Electron main.js that imports and uses this context."
        );
      }
      
      // Get or create session for this partition
      let session: any;
      if (this.config.partition) {
        const electronSession = electron.session || electron.default?.session;
        session = electronSession.fromPartition(this.config.partition);
      }

      // Create hidden browser window
      this.window = new BrowserWindow({
        show: this.config.headless === false, // Show window if not headless
        width: this.config.viewport?.width || 1280,
        height: this.config.viewport?.height || 720,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          ...(session ? { session } : {}), // Use custom session if provided
          ...(this.config.partition && !session ? { partition: this.config.partition } : {}),
        },
      });

      // Set user agent if specified
      if (this.config.userAgent) {
        await this.window.webContents.setUserAgent(this.config.userAgent);
      }

      // Inject cookies
      if (this.cookies.getAll().length > 0) {
        await this.syncCookiesToBrowser();
      }

      // Listen for navigation complete to sync cookies
      this.window.webContents.on("did-finish-load", async () => {
        await this.syncCookiesFromBrowser();
      });
    } catch (error) {
      throw new Error(
        `Failed to initialize Electron: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Sync cookies from CookieStore to Electron session
   */
  private async syncCookiesToBrowser(): Promise<void> {
    if (!this.window) return;

    const session = this.window.webContents.session;
    
    for (const cookie of this.cookies.getAll()) {
      const electronCookie = {
        url: `http${cookie.secure ? "s" : ""}://${cookie.domain}${cookie.path}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expires ? cookie.expires / 1000 : undefined,
        sameSite: cookie.sameSite?.toLowerCase() as "no_restriction" | "lax" | "strict" | undefined,
      };

      await session.cookies.set(electronCookie);
    }
  }

  /**
   * Sync cookies from Electron session to CookieStore
   */
  private async syncCookiesFromBrowser(): Promise<void> {
    if (!this.window) return;

    const session = this.window.webContents.session;
    const url = this.window.webContents.getURL();
    
    if (!url) return;

    const electronCookies = await session.cookies.get({ url });
    
    for (const cookie of electronCookies) {
      const storeCookie: Cookie = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || new URL(url).hostname,
        path: cookie.path || "/",
        expires: cookie.expirationDate ? cookie.expirationDate * 1000 : undefined,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite === "no_restriction" ? "None" 
                  : cookie.sameSite === "lax" ? "Lax" 
                  : cookie.sameSite === "strict" ? "Strict" 
                  : undefined,
      };
      this.cookies.set(storeCookie);
    }
  }

  async navigate(url: string, options?: NavigateOptions): Promise<void> {
    await this.ensureInitialized();
    
    const timeout = options?.timeout || this.config.timeout || 30000;

    // Create a promise that resolves when navigation completes
    const navigationPromise = new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Navigation timeout after ${timeout}ms`));
      }, timeout);

      const waitUntil = options?.waitUntil || "load";
      
      if (waitUntil === "load") {
        this.window.webContents.once("did-finish-load", () => {
          clearTimeout(timeoutId);
          resolve();
        });
      } else if (waitUntil === "domcontentloaded") {
        this.window.webContents.once("dom-ready", () => {
          clearTimeout(timeoutId);
          resolve();
        });
      } else {
        // "networkidle" - wait a bit after load
        this.window.webContents.once("did-finish-load", () => {
          setTimeout(() => {
            clearTimeout(timeoutId);
            resolve();
          }, 500);
        });
      }

      this.window.webContents.once("did-fail-load", (_event: any, errorCode: number, errorDescription: string) => {
        clearTimeout(timeoutId);
        reject(new Error(`Navigation failed: ${errorDescription} (${errorCode})`));
      });
    });

    // Start navigation
    await this.window.loadURL(url);
    
    // Wait for navigation to complete
    await navigationPromise;

    // Sync cookies after navigation
    await this.syncCookiesFromBrowser();
  }

  async getUrl(): Promise<string> {
    await this.ensureInitialized();
    return this.window.webContents.getURL();
  }

  async getAccessibilityTree(): Promise<A11yTree> {
    await this.ensureInitialized();

    // Execute the parser script in the page context
    const serializedTree = await this.window.webContents.executeJavaScript(
      this.parserScript
    ) as SerializedA11yNode;

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
    const centerX = Math.round(x + width / 2);
    const centerY = Math.round(y + height / 2);

    const button = options?.button || "left";
    const clickCount = options?.clickCount || 1;

    // Send mouse events to the window
    this.window.webContents.sendInputEvent({
      type: "mouseDown",
      x: centerX,
      y: centerY,
      button: button,
      clickCount: clickCount,
    });

    if (options?.delay) {
      await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    this.window.webContents.sendInputEvent({
      type: "mouseUp",
      x: centerX,
      y: centerY,
      button: button,
      clickCount: clickCount,
    });
  }

  async type(node: A11yNode, text: string, options?: TypeOptions): Promise<void> {
    await this.ensureInitialized();

    // Click to focus the element
    await this.click(node);

    // Clear existing text if requested
    if (options?.clear) {
      this.window.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
      this.window.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
      this.window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Backspace" });
      this.window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Backspace" });
    }

    // Type the text character by character
    for (const char of text) {
      this.window.webContents.sendInputEvent({
        type: "char",
        keyCode: char,
      });

      if (options?.delay) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
      }
    }
  }

  async screenshot(options?: ScreenshotOptions): Promise<Uint8Array> {
    await this.ensureInitialized();

    // Capture the page
    const image = await this.window.webContents.capturePage();

    // Convert to desired format
    let buffer: Buffer;
    if (options?.type === "jpeg") {
      buffer = image.toJPEG(options.quality || 80);
    } else {
      buffer = image.toPNG();
    }

    return new Uint8Array(buffer);
  }

  async evaluate<T = any>(script: string): Promise<T> {
    await this.ensureInitialized();
    return await this.window.webContents.executeJavaScript(script);
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
    this.window.webContents.goBack();
  }

  async goForward(): Promise<void> {
    await this.ensureInitialized();
    this.window.webContents.goForward();
  }

  async reload(): Promise<void> {
    await this.ensureInitialized();
    this.window.webContents.reload();
  }

  async close(): Promise<void> {
    try {
      if (this.window && !this.window.isDestroyed()) {
        this.window.close();
        this.window = undefined;
      }
    } catch (error) {
      console.error("Error closing Electron window:", error);
    }
  }
}

/**
 * Create a new Electron browser context
 */
export async function createElectronContext(
  config: BrowserContextConfig,
  cookies: CookieStore
): Promise<ElectronContext> {
  const context = new ElectronContext(config, cookies);
  return context;
}
