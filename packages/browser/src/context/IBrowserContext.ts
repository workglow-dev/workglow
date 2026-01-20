/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { A11yNode } from "../a11y/A11yNode";
import type { A11yTree } from "../a11y/A11yTree";
import type { CookieStore } from "./CookieStore";

/**
 * Configuration for creating a browser context
 */
export interface BrowserContextConfig {
  /**
   * Initial cookies to set
   */
  readonly cookies?: CookieStore;

  /**
   * Browser viewport size
   */
  readonly viewport?: {
    readonly width: number;
    readonly height: number;
  };

  /**
   * User agent string
   */
  readonly userAgent?: string;

  /**
   * Whether to run in headless mode
   * Defaults to true
   */
  readonly headless?: boolean;

  /**
   * Extra HTTP headers to set for all requests
   */
  readonly extraHTTPHeaders?: Record<string, string>;

  /**
   * Whether to ignore HTTPS errors
   */
  readonly ignoreHTTPSErrors?: boolean;

  /**
   * Default navigation timeout in milliseconds
   */
  readonly timeout?: number;

  /**
   * Storage state for loading/saving session data (Playwright)
   * Can be a path to JSON file or an object with cookies/origins
   * 
   * @example
   * ```typescript
   * // Load from file
   * { storageState: "auth.json" }
   * 
   * // Load from object
   * { storageState: { cookies: [...], origins: [...] } }
   * ```
   */
  readonly storageState?: string | StorageState;

  /**
   * User data directory for persistent browser context (Playwright)
   * When set, Playwright uses launchPersistentContext instead of newContext
   * This makes the browser session persistent like Electron partitions
   * 
   * @example
   * ```typescript
   * { userDataDir: "./user-data/profile-1" }
   * ```
   */
  readonly userDataDir?: string;

  /**
   * Electron-specific: Partition string for session isolation
   * 
   * - `"persist:name"` - Persistent session (stored on disk, survives restarts)
   * - `"name"` - In-memory session (cleared on app quit)
   * - `undefined` - Use default session
   * 
   * Different partitions have completely isolated:
   * - Cookies
   * - localStorage/sessionStorage  
   * - IndexedDB
   * - Cache
   * - Service workers
   * 
   * @example
   * ```typescript
   * // Persistent session for user login
   * { partition: "persist:user-session" }
   * 
   * // Temporary session for guest browsing
   * { partition: "guest-session" }
   * 
   * // Completely isolated sessions for multi-account
   * { partition: "persist:account-1" }
   * { partition: "persist:account-2" }
   * ```
   */
  readonly partition?: string;
}

/**
 * Abstract interface for browser context implementations
 * 
 * This provides a unified API across different browser automation backends
 * (Playwright, Electron, etc.)
 */
export interface IBrowserContext {
  /**
   * Cookie store for this context
   */
  readonly cookies: CookieStore;

  /**
   * Configuration used to create this context
   */
  readonly config: BrowserContextConfig;

  /**
   * Navigate to a URL
   * 
   * @param url - URL to navigate to
   * @param options - Navigation options
   */
  navigate(url: string, options?: NavigateOptions): Promise<void>;

  /**
   * Get the current page URL
   */
  getUrl(): Promise<string>;

  /**
   * Get the accessibility tree for the current page
   */
  getAccessibilityTree(): Promise<A11yTree>;

  /**
   * Click on an element in the accessibility tree
   * 
   * @param node - Node to click
   * @param options - Click options
   */
  click(node: A11yNode, options?: ClickOptions): Promise<void>;

  /**
   * Type text into an element
   * 
   * @param node - Node to type into
   * @param text - Text to type
   * @param options - Type options
   */
  type(node: A11yNode, text: string, options?: TypeOptions): Promise<void>;

  /**
   * Take a screenshot of the current page
   * 
   * @param options - Screenshot options
   * @returns Image data as Uint8Array
   */
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;

  /**
   * Evaluate JavaScript in the page context
   * 
   * @param script - JavaScript code to evaluate
   * @returns Result of the evaluation
   */
  evaluate<T = any>(script: string): Promise<T>;

  /**
   * Wait for a condition
   * 
   * @param condition - Condition function that returns true when satisfied
   * @param options - Wait options
   */
  waitFor(condition: () => Promise<boolean>, options?: WaitOptions): Promise<void>;

  /**
   * Go back in navigation history
   */
  goBack(): Promise<void>;

  /**
   * Go forward in navigation history
   */
  goForward(): Promise<void>;

  /**
   * Reload the current page
   */
  reload(): Promise<void>;

  /**
   * Close the browser context and clean up resources
   */
  close(): Promise<void>;
}

/**
 * Options for navigation
 */
export interface NavigateOptions {
  /**
   * Maximum time to wait for navigation in milliseconds
   */
  readonly timeout?: number;

  /**
   * When to consider navigation succeeded
   * - "load": Wait for the load event
   * - "domcontentloaded": Wait for DOMContentLoaded event
   * - "networkidle": Wait for network to be idle
   */
  readonly waitUntil?: "load" | "domcontentloaded" | "networkidle";
}

/**
 * Options for clicking
 */
export interface ClickOptions {
  /**
   * Mouse button to use
   */
  readonly button?: "left" | "right" | "middle";

  /**
   * Number of clicks (1 for single, 2 for double)
   */
  readonly clickCount?: number;

  /**
   * Delay between mousedown and mouseup in milliseconds
   */
  readonly delay?: number;

  /**
   * Modifier keys to hold while clicking
   */
  readonly modifiers?: Array<"Alt" | "Control" | "Meta" | "Shift">;
}

/**
 * Options for typing
 */
export interface TypeOptions {
  /**
   * Delay between key presses in milliseconds
   */
  readonly delay?: number;

  /**
   * Whether to clear existing text first
   */
  readonly clear?: boolean;
}

/**
 * Options for screenshots
 */
export interface ScreenshotOptions {
  /**
   * Image format
   */
  readonly type?: "png" | "jpeg";

  /**
   * Quality (0-100) for JPEG
   */
  readonly quality?: number;

  /**
   * Whether to capture full page (including scrollable areas)
   */
  readonly fullPage?: boolean;

  /**
   * Clip to a specific area
   */
  readonly clip?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/**
 * Options for waiting
 */
export interface WaitOptions {
  /**
   * Maximum time to wait in milliseconds
   */
  readonly timeout?: number;

  /**
   * Polling interval in milliseconds
   */
  readonly pollingInterval?: number;
}

/**
 * Storage state for Playwright contexts
 * Contains cookies and localStorage/sessionStorage data
 */
export interface StorageState {
  readonly cookies?: Array<{
    readonly name: string;
    readonly value: string;
    readonly domain: string;
    readonly path: string;
    readonly expires?: number;
    readonly httpOnly?: boolean;
    readonly secure?: boolean;
    readonly sameSite?: "Strict" | "Lax" | "None";
  }>;
  readonly origins?: Array<{
    readonly origin: string;
    readonly localStorage?: Array<{
      readonly name: string;
      readonly value: string;
    }>;
  }>;
}
