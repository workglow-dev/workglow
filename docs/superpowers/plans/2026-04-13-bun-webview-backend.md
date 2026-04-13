# Bun.WebView Browser Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `BunWebViewBackend` as a new `IBrowserContext` implementation, extract shared CDP logic into a `CDPBrowserBackend` base class, and wire it into the CLI via TOML configuration.

**Architecture:** Extract ~500 lines of CDP-based methods from `ElectronBackend` into an abstract `CDPBrowserBackend` base class. Both `ElectronBackend` and `BunWebViewBackend` extend it, providing only their platform-specific CDP transport and lifecycle. The CLI reads `~/.workglow.toml` `[browser]` section to select which backend to register.

**Tech Stack:** TypeScript, Bun.WebView (Chrome DevTools Protocol), `smol-toml`, vitest, Commander.js CLI

---

### Task 1: Add `chromePath` to `BrowserConnectOptions`

**Files:**
- Modify: `packages/tasks/src/task/browser/IBrowserContext.ts:116-122`

- [ ] **Step 1: Add the `chromePath` property**

In `packages/tasks/src/task/browser/IBrowserContext.ts`, add `chromePath` to `BrowserConnectOptions`:

```typescript
export interface BrowserConnectOptions {
  readonly backend?: BrowserBackendType;
  readonly projectId?: string;
  readonly profileName?: string;
  readonly headless?: boolean;
  readonly cdpUrl?: string;
  readonly chromePath?: string;
}
```

- [ ] **Step 2: Verify build**

Run: `bun run --filter @workglow/tasks build-package`
Expected: exit 0, no errors

- [ ] **Step 3: Commit**

```bash
git add packages/tasks/src/task/browser/IBrowserContext.ts
git commit -m "feat(browser): add chromePath to BrowserConnectOptions"
```

---

### Task 2: Extract `CDPBrowserBackend` base class

**Files:**
- Create: `packages/tasks/src/task/browser/CDPBrowserBackend.ts`
- Modify: `packages/tasks/src/task/browser/ElectronBackend.ts`
- Modify: `packages/tasks/src/task/browser/index.ts`

This is the largest task. We extract all CDP-shared logic from `ElectronBackend` into an abstract base class, then make `ElectronBackend` extend it.

- [ ] **Step 1: Create `CDPBrowserBackend.ts` with types and helper functions**

Create `packages/tasks/src/task/browser/CDPBrowserBackend.ts`. Move these from `ElectronBackend.ts`:

- `CDPAXProperty` interface
- `CDPAXNode` interface
- `MutableAccessibilityNode` interface
- `IGNORED_ROLES` set
- `parseCDPAXTree()` function
- `serializeAXTree()` function
- `buildModifiersMask()` function
- `KEY_CODE_MAP` map
- `keyToCode()` function
- `sleep()` function

Then define the abstract class with these members moved from `ElectronBackend`:

```typescript
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AccessibilityNode,
  AccessibilityTree,
  AriaRole,
  ClickOptions,
  ElementRef,
  SnapshotOptions,
  WaitOptions,
} from "./IBrowserContext";

// --- paste all the interfaces, helper functions, constants here ---

export abstract class CDPBrowserBackend {
  protected _refMap = new Map<ElementRef, number | null>();
  protected _refCounter = { count: 0 };

  /** Subclasses provide the CDP transport. */
  protected abstract cdp(method: string, params?: Record<string, unknown>): Promise<unknown>;

  /** Human-readable name for error messages (e.g. "ElectronBackend"). */
  protected abstract readonly backendName: string;

  protected resolveRefToNodeId(ref: ElementRef): number {
    if (!this._refMap.has(ref)) {
      throw new Error(`${this.backendName}: unknown ref "${ref}"`);
    }
    const nodeId = this._refMap.get(ref);
    if (nodeId == null) {
      throw new Error(`${this.backendName}: ref "${ref}" has no associated DOM node`);
    }
    return nodeId;
  }

  protected async getBoundingBox(
    backendNodeId: number
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    const result = (await this.cdp("DOM.getBoxModel", { backendNodeId })) as {
      model: { content: number[] };
    };
    const content = result.model.content;
    const x = content[0];
    const y = content[1];
    const width = content[2] - content[0];
    const height = content[5] - content[1];
    return { x, y, width, height };
  }

  // --- snapshot ---
  async snapshot(_options: SnapshotOptions = {}): Promise<AccessibilityTree> {
    this._refMap.clear();
    const result = (await this.cdp("Accessibility.getFullAXTree")) as { nodes: CDPAXNode[] };
    const nodes = result.nodes ?? [];
    const root = parseCDPAXTree(nodes, this._refCounter, this._refMap);
    const yaml = serializeAXTree(root);
    return { root, yaml };
  }

  // --- click by ref ---
  async click(ref: ElementRef, options: ClickOptions = {}): Promise<void> {
    // Move from ElectronBackend.click — uses getBoundingBox + Input.dispatchMouseEvent
  }

  // --- fill by ref ---
  async fill(ref: ElementRef, value: string, _options: WaitOptions = {}): Promise<void> {
    // Move from ElectronBackend.fill — uses DOM.focus + Input.insertText
  }

  // --- selectOption ---
  async selectOption(ref: ElementRef, values: string | readonly string[], _options: WaitOptions = {}): Promise<void> {
    // Move from ElectronBackend.selectOption
  }

  // --- hover ---
  async hover(ref: ElementRef, _options: WaitOptions = {}): Promise<void> {
    // Move from ElectronBackend.hover
  }

  // --- clickByRole ---
  async clickByRole(role: AriaRole, name: string, options: ClickOptions = {}): Promise<void> {
    // Move from ElectronBackend.clickByRole
  }

  // --- fillByLabel ---
  async fillByLabel(label: string, value: string, _options: WaitOptions = {}): Promise<void> {
    // Move from ElectronBackend.fillByLabel (CDP-first + JS fallback)
  }

  // --- innerHTML ---
  async innerHTML(ref: ElementRef): Promise<string> {
    // Move from ElectronBackend.innerHTML
  }

  // --- textContent ---
  async textContent(ref: ElementRef): Promise<string | null> {
    // Move from ElectronBackend.textContent
  }

  // --- attribute ---
  async attribute(ref: ElementRef, name: string): Promise<string | null> {
    // Move from ElectronBackend.attribute
  }

  // --- getDocumentRootNodeId ---
  protected async getDocumentRootNodeId(): Promise<number> {
    const doc = (await this.cdp("DOM.getDocument", { depth: 0 })) as {
      root: { nodeId: number };
    };
    return doc.root.nodeId;
  }

  // --- querySelector ---
  async querySelector(selector: string): Promise<ElementRef | null> {
    // Move from ElectronBackend.querySelector
  }

  // --- querySelectorAll ---
  async querySelectorAll(selector: string): Promise<readonly ElementRef[]> {
    // Move from ElectronBackend.querySelectorAll
  }

  // --- uploadFile ---
  async uploadFile(ref: ElementRef, paths: string | readonly string[]): Promise<void> {
    // Move from ElectronBackend.uploadFile
  }

  // --- scroll ---
  async scroll(x: number, y: number, ref?: ElementRef): Promise<void> {
    // Move from ElectronBackend.scroll
  }
}
```

Every method body is a direct move from the corresponding `ElectronBackend` method. Replace `this.resolveRefToNodeId` calls (which were previously private) with the now-protected version. Replace hardcoded `"ElectronBackend"` in error messages with `this.backendName`.

- [ ] **Step 2: Refactor `ElectronBackend` to extend `CDPBrowserBackend`**

In `packages/tasks/src/task/browser/ElectronBackend.ts`:

1. Remove all the moved code (types, functions, methods).
2. Change class declaration to `export class ElectronBackend extends CDPBrowserBackend implements IBrowserContext`.
3. Add `protected readonly backendName = "ElectronBackend";`.
4. Override `cdp()` as a protected method that delegates to `this._webContents.debugger.sendCommand(method, params)`.
5. Keep all Electron-specific methods: `connect`, `disconnect`, `isConnected`, `navigate`, `goBack`, `goForward`, `reload`, `currentUrl`, `title`, `evaluate`, `screenshot`, `pressKey`, `type`, `content`, `download`, `onDialog`, tabs, wait methods, `networkRequests`, `consoleMessages`.
6. The `wc` getter stays in `ElectronBackend` (it accesses `_webContents`).
7. `fillByLabel`'s JS fallback uses `this.wc.executeJavaScript(...)` which is Electron-specific. The base class's `fillByLabel` should accept an abstract `evaluate` method, OR `ElectronBackend` should override `fillByLabel` to add its JS fallback. Simpler: keep `fillByLabel` in the base class and have the JS fallback call a protected abstract `evaluateInPage(script)` method that subclasses implement.

Add to `CDPBrowserBackend`:
```typescript
/** Execute a JS expression in the page context. Used by fillByLabel JS fallback. */
protected abstract evaluateInPage<T>(script: string): Promise<T>;
```

`ElectronBackend` implements it as `return this.wc.executeJavaScript(script)`.

- [ ] **Step 3: Export from index.ts**

In `packages/tasks/src/task/browser/index.ts`, add:

```typescript
export * from "./CDPBrowserBackend";
```

- [ ] **Step 4: Verify build**

Run: `bun run --filter @workglow/tasks build-package`
Expected: exit 0

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `bun scripts/test.ts task vitest`
Expected: all 1013 tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/tasks/src/task/browser/CDPBrowserBackend.ts \
       packages/tasks/src/task/browser/ElectronBackend.ts \
       packages/tasks/src/task/browser/index.ts
git commit -m "refactor(browser): extract CDPBrowserBackend base class from ElectronBackend"
```

---

### Task 3: Implement `BunWebViewBackend`

**Files:**
- Create: `packages/tasks/src/task/browser/BunWebViewBackend.ts`
- Modify: `packages/tasks/src/task/browser/index.ts`

- [ ] **Step 1: Create `BunWebViewBackend.ts`**

Create `packages/tasks/src/task/browser/BunWebViewBackend.ts`:

```typescript
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AccessibilityTree,
  BrowserConnectOptions,
  ConsoleMessage,
  DialogAction,
  DialogInfo,
  DownloadOptions,
  DownloadResult,
  ElementRef,
  IBrowserContext,
  NavigateOptions,
  NetworkFilter,
  NetworkRequest,
  ScreenshotOptions,
  SnapshotOptions,
  TabInfo,
  WaitOptions,
} from "./IBrowserContext";
import { CDPBrowserBackend, sleep } from "./CDPBrowserBackend";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWebView = any;

export class BunWebViewBackend extends CDPBrowserBackend implements IBrowserContext {
  protected readonly backendName = "BunWebViewBackend";

  private _wv: AnyWebView | null = null;
  private _connected = false;
  private _dialogHandler: ((info: DialogInfo) => DialogAction | Promise<DialogAction>) | null = null;

  // ---------------------------------------------------------------------------
  // CDP transport
  // ---------------------------------------------------------------------------

  protected async cdp(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this._wv) {
      throw new Error("BunWebViewBackend: not connected — call connect() first");
    }
    return this._wv.cdp(method, params ?? {});
  }

  protected async evaluateInPage<T>(script: string): Promise<T> {
    if (!this._wv) {
      throw new Error("BunWebViewBackend: not connected — call connect() first");
    }
    return this._wv.evaluate(script) as Promise<T>;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async connect(options: BrowserConnectOptions = {}): Promise<void> {
    const backend: Record<string, unknown> = { type: "chrome" };
    if (options.chromePath) {
      backend.path = options.chromePath;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const WebView = (globalThis as any).Bun?.WebView;
    if (!WebView) {
      throw new Error("BunWebViewBackend: Bun.WebView is not available — requires Bun runtime");
    }

    this._wv = new WebView({
      headless: options.headless ?? true,
      backend,
      url: "about:blank",
    });

    // Wait for the initial navigation to complete
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("BunWebViewBackend: initial navigation timed out")), 30_000);
      this._wv.onNavigated = () => {
        clearTimeout(timer);
        resolve();
      };
      this._wv.onNavigationFailed = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
    });

    // Enable Accessibility domain for snapshot/clickByRole
    await this.cdp("Accessibility.enable");

    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    try {
      if (this._wv) {
        this._wv.close();
      }
    } finally {
      this._wv = null;
      this._refMap.clear();
      this._refCounter.count = 0;
    }
  }

  isConnected(): boolean {
    return this._connected && this._wv !== null;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  async navigate(url: string, _options: NavigateOptions = {}): Promise<void> {
    await this.wv.navigate(url);
  }

  async goBack(_options: NavigateOptions = {}): Promise<void> {
    await this.wv.back();
  }

  async goForward(_options: NavigateOptions = {}): Promise<void> {
    await this.wv.forward();
  }

  async reload(_options: NavigateOptions = {}): Promise<void> {
    await this.wv.reload();
  }

  async currentUrl(): Promise<string> {
    return this.wv.url;
  }

  async title(): Promise<string> {
    return this.wv.title;
  }

  // ---------------------------------------------------------------------------
  // Internal helper
  // ---------------------------------------------------------------------------

  private get wv(): AnyWebView {
    if (!this._wv || !this._connected) {
      throw new Error("BunWebViewBackend: not connected — call connect() first");
    }
    return this._wv;
  }

  // ---------------------------------------------------------------------------
  // Content
  // ---------------------------------------------------------------------------

  async content(): Promise<string> {
    return this.wv.evaluate("document.documentElement.outerHTML") as Promise<string>;
  }

  // ---------------------------------------------------------------------------
  // JS evaluation
  // ---------------------------------------------------------------------------

  async evaluate<T>(expression: string): Promise<T> {
    return this.wv.evaluate(expression) as Promise<T>;
  }

  // ---------------------------------------------------------------------------
  // Capture
  // ---------------------------------------------------------------------------

  async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    const { format = "png", quality } = options;
    return this.wv.screenshot({
      encoding: "buffer",
      format,
      ...(quality !== undefined && { quality }),
    }) as Promise<Buffer>;
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  async pressKey(key: string, _options: WaitOptions = {}): Promise<void> {
    await this.wv.press(key);
  }

  async type(text: string, _options: WaitOptions = {}): Promise<void> {
    await this.wv.type(text);
  }

  // ---------------------------------------------------------------------------
  // Download (not supported)
  // ---------------------------------------------------------------------------

  async download(_trigger: () => Promise<void>, _options: DownloadOptions = {}): Promise<DownloadResult> {
    throw new Error("BunWebViewBackend: download() is not supported — Bun.WebView has no download interception API");
  }

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------

  onDialog(handler: (info: DialogInfo) => DialogAction | Promise<DialogAction>): void {
    this._dialogHandler = handler;

    void this.cdp("Page.enable").then(() => {
      this.wv.addEventListener(
        "Page.javascriptDialogOpening",
        async (event: MessageEvent<Record<string, unknown>>) => {
          const params = event.data;
          const info: DialogInfo = {
            type: params.type as DialogInfo["type"],
            message: params.message as string,
            defaultValue: (params.defaultPrompt as string) || undefined,
          };

          if (this._dialogHandler) {
            const action = await this._dialogHandler(info);
            const accept = action.accept;
            const promptText =
              accept && "promptText" in action
                ? (action as { accept: true; promptText?: string }).promptText
                : undefined;
            await this.cdp("Page.handleJavaScriptDialog", {
              accept,
              ...(promptText !== undefined && { promptText }),
            });
          } else {
            await this.cdp("Page.handleJavaScriptDialog", { accept: false });
          }
        }
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Tabs (single-view model)
  // ---------------------------------------------------------------------------

  async tabs(): Promise<readonly TabInfo[]> {
    return [{ tabId: "0", url: this.wv.url, title: this.wv.title }];
  }

  async switchTab(_tabId: string): Promise<void> {
    // Single-view model: no-op
  }

  async newTab(url?: string): Promise<TabInfo> {
    if (url) {
      await this.navigate(url);
    }
    return { tabId: "0", url: this.wv.url, title: this.wv.title };
  }

  async closeTab(_tabId: string): Promise<void> {
    await this.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Wait
  // ---------------------------------------------------------------------------

  async waitForNavigation(options: NavigateOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 30_000;
    const interval = 100;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      if (!this.wv.loading) return;
      await sleep(interval);
    }

    throw new Error("BunWebViewBackend: waitForNavigation timed out");
  }

  async waitForSelector(selector: string, options: WaitOptions = {}): Promise<ElementRef> {
    const timeout = options.timeout ?? 30_000;
    const interval = 100;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const found = await this.wv.evaluate(
        `!!document.querySelector(${JSON.stringify(selector)})`
      );
      if (found) {
        const ref = await this.querySelector(selector);
        if (ref) return ref;
      }
      await sleep(interval);
    }

    throw new Error(`BunWebViewBackend: waitForSelector timed out for "${selector}"`);
  }

  async waitForIdle(options: WaitOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 30_000;
    const interval = 100;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const ready = await this.wv.evaluate('document.readyState === "complete"');
      if (ready) return;
      await sleep(interval);
    }

    throw new Error("BunWebViewBackend: waitForIdle timed out");
  }

  // ---------------------------------------------------------------------------
  // Optional capabilities (stubs)
  // ---------------------------------------------------------------------------

  readonly networkRequests = (_filter?: NetworkFilter): Promise<readonly NetworkRequest[]> => {
    return Promise.resolve([]);
  };

  readonly consoleMessages = (): Promise<readonly ConsoleMessage[]> => {
    return Promise.resolve([]);
  };
}
```

- [ ] **Step 2: Export from index.ts**

In `packages/tasks/src/task/browser/index.ts`, add:

```typescript
export * from "./BunWebViewBackend";
```

Full file:

```typescript
export * from "./BrowserSessionRegistry";
export * from "./CDPBrowserBackend";
export * from "./BunWebViewBackend";
export * from "./IBrowserContext";
export * from "./tasks";
```

- [ ] **Step 3: Verify build**

Run: `bun run --filter @workglow/tasks build-package`
Expected: exit 0

- [ ] **Step 4: Run existing tests (no regression)**

Run: `bun scripts/test.ts task vitest`
Expected: all tests pass (Mock and Playwright suites)

- [ ] **Step 5: Commit**

```bash
git add packages/tasks/src/task/browser/BunWebViewBackend.ts \
       packages/tasks/src/task/browser/index.ts
git commit -m "feat(browser): add BunWebViewBackend implementation"
```

---

### Task 4: Add BunWebView integration test

**Files:**
- Create: `packages/test/src/test/browser/BunWebViewBrowser.integration.test.ts`

- [ ] **Step 1: Create the integration test file**

Create `packages/test/src/test/browser/BunWebViewBrowser.integration.test.ts`:

```typescript
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";
import { BunWebViewBackend } from "@workglow/tasks";
import { runGenericBrowserTaskTests } from "./genericBrowserTaskTests";

// Bun.WebView with Chrome backend — skip when Chrome is unavailable.
let bunWebViewAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WebView = (globalThis as any).Bun?.WebView;
  if (WebView) {
    const wv = new WebView({ headless: true, backend: "chrome", url: "about:blank" });
    // Wait briefly for Chrome to start
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { wv.close(); reject(); }, 10_000);
      wv.onNavigated = () => { clearTimeout(timer); resolve(); };
      wv.onNavigationFailed = () => { clearTimeout(timer); reject(); };
    });
    wv.close();
    bunWebViewAvailable = true;
  }
} catch {
  // Chrome not installed or Bun.WebView unavailable
}

describe.skipIf(!bunWebViewAvailable)("Browser Tasks (BunWebViewBackend)", () => {
  runGenericBrowserTaskTests(() => new BunWebViewBackend(), { hookTimeout: 30_000 });
});
```

- [ ] **Step 2: Run browser tests**

Run: `npx vitest run packages/test/src/test/browser/`
Expected: BunWebViewBrowser suite either runs (if Chrome is available) or is skipped. Mock and Playwright suites still pass.

- [ ] **Step 3: Commit**

```bash
git add packages/test/src/test/browser/BunWebViewBrowser.integration.test.ts
git commit -m "test(browser): add BunWebViewBackend integration test"
```

---

### Task 5: Extend CLI TOML config with `[browser]` section

**Files:**
- Modify: `examples/cli/src/config.ts`
- Modify: `examples/cli/src/commands/init.ts`

- [ ] **Step 1: Extend `CliConfig` type and `loadConfig`**

In `examples/cli/src/config.ts`, update the `CliConfig` interface and `loadConfig()`:

```typescript
export interface CliConfig {
  readonly directories: {
    readonly models: string;
    readonly workflows: string;
    readonly agents: string;
    readonly mcps: string;
    readonly cache: string;
  };
  readonly browser?: {
    readonly backend?: "bun-webview" | "playwright";
    readonly "chrome-path"?: string;
    readonly headless?: boolean;
  };
}
```

Update `loadConfig()` to also read the `[browser]` section:

```typescript
export async function loadConfig(): Promise<CliConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = parse(raw) as {
      directories?: Record<string, string | undefined>;
      browser?: Record<string, unknown>;
    };

    const dirs = parsed.directories;
    const browser = parsed.browser as CliConfig["browser"] | undefined;

    return {
      directories: {
        models: resolvePath(dirs?.models ?? DEFAULT_CONFIG.directories.models),
        workflows: resolvePath(dirs?.workflows ?? DEFAULT_CONFIG.directories.workflows),
        agents: resolvePath(dirs?.agents ?? DEFAULT_CONFIG.directories.agents),
        mcps: resolvePath(dirs?.mcps ?? DEFAULT_CONFIG.directories.mcps),
        cache: resolvePath(dirs?.cache ?? DEFAULT_CONFIG.directories.cache),
      },
      browser,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
```

- [ ] **Step 2: Update `init` command to include `[browser]` section**

In `examples/cli/src/commands/init.ts`, update the `tomlContent` to include the browser section:

```typescript
const tomlContent = stringify({
  directories: {
    models: DEFAULT_CONFIG.directories.models,
    workflows: DEFAULT_CONFIG.directories.workflows,
    agents: DEFAULT_CONFIG.directories.agents,
    mcps: DEFAULT_CONFIG.directories.mcps,
    cache: DEFAULT_CONFIG.directories.cache,
  },
  browser: {
    backend: "bun-webview",
    headless: true,
  },
});
```

- [ ] **Step 3: Verify build**

Run: `cd examples/cli && bun run build-package` (or the equivalent build command for the CLI)
If no build step, run: `bun -e "import './examples/cli/src/config'"`
Expected: no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add examples/cli/src/config.ts examples/cli/src/commands/init.ts
git commit -m "feat(cli): add [browser] section to TOML config"
```

---

### Task 6: Create CLI browser backend registration

**Files:**
- Create: `examples/cli/src/browser.ts`
- Modify: `examples/cli/src/commands/workflow.ts`

- [ ] **Step 1: Create `browser.ts` with `registerCliBrowserDeps`**

Create `examples/cli/src/browser.ts`:

```typescript
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "node:path";
import { registerBrowserDeps } from "@workglow/tasks";
import type { CliConfig } from "./config";

const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function safeName(value: string, label: string): string {
  if (!SAFE_NAME_RE.test(value)) {
    throw new Error(
      `Invalid ${label}: must contain only alphanumeric characters, hyphens, and underscores`
    );
  }
  return value;
}

function createProfileStorage(baseDir: string) {
  return {
    async save(projectId: string, profileName: string, state: string) {
      const fs = await import("node:fs/promises");
      const dir = path.join(baseDir, safeName(projectId, "projectId"));
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${safeName(profileName, "profileName")}.json`),
        state,
        "utf-8"
      );
    },
    async load(projectId: string, profileName: string) {
      const fs = await import("node:fs/promises");
      try {
        return await fs.readFile(
          path.join(
            baseDir,
            safeName(projectId, "projectId"),
            `${safeName(profileName, "profileName")}.json`
          ),
          "utf-8"
        );
      } catch {
        return null;
      }
    },
    async delete(projectId: string, profileName: string) {
      const fs = await import("node:fs/promises");
      try {
        await fs.unlink(
          path.join(
            baseDir,
            safeName(projectId, "projectId"),
            `${safeName(profileName, "profileName")}.json`
          )
        );
      } catch {
        /* ignore */
      }
    },
  };
}

export async function registerCliBrowserDeps(config: CliConfig): Promise<void> {
  const browserConfig = config.browser ?? {};
  const backend = browserConfig.backend ?? "bun-webview";
  const chromePath = browserConfig["chrome-path"];
  const headless = browserConfig.headless ?? true;

  const profileDir = path.join(
    path.dirname(config.directories.cache),
    "browser-profiles"
  );
  const profileStorage = createProfileStorage(profileDir);

  if (backend === "bun-webview") {
    const { BunWebViewBackend } = await import("@workglow/tasks");
    registerBrowserDeps({
      createContext: () => {
        const ctx = new BunWebViewBackend();
        // chromePath and headless are passed through connect() options
        // by BrowserSessionTask, which reads them from BrowserTaskDeps
        return ctx;
      },
      availableBackends: ["local"],
      defaultBackend: "local",
      profileStorage,
    });
  } else if (backend === "playwright") {
    const { PlaywrightBackend } = await import("@workglow/tasks");
    registerBrowserDeps({
      createContext: () => new PlaywrightBackend(),
      availableBackends: ["local", "cloud"],
      defaultBackend: "local",
      profileStorage,
    });
  } else {
    throw new Error(`Unknown browser backend: "${backend}". Use "bun-webview" or "playwright".`);
  }
}
```

- [ ] **Step 2: Wire into workflow run command**

In `examples/cli/src/commands/workflow.ts`, import and call `registerCliBrowserDeps` before graph execution. Add this import at the top:

```typescript
import { registerCliBrowserDeps } from "../browser";
```

Then in the `run` action, right before the `try { const { withCli } = ...` block (around line 347), add:

```typescript
      // Register browser backend from TOML config
      await registerCliBrowserDeps(config);
```

- [ ] **Step 3: Verify build**

Run: `bun run --filter @workglow/tasks build-package`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add examples/cli/src/browser.ts examples/cli/src/commands/workflow.ts
git commit -m "feat(cli): register browser backend from TOML config on workflow run"
```

---

### Task 7: CLI browser workflow integration test

**Files:**
- Create: `examples/cli/src/test/browser-workflow.test.ts`

- [ ] **Step 1: Create the test file**

Create `examples/cli/src/test/browser-workflow.test.ts`:

```typescript
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "smol-toml";
import { TaskGraph, TaskRegistry } from "@workglow/task-graph";
import {
  BrowserSessionTask,
  BrowserNavigateTask,
  BrowserSnapshotTask,
  BrowserSessionRegistry,
  registerCommonTasks,
} from "@workglow/tasks";
import { registerCliBrowserDeps } from "../browser";
import type { CliConfig } from "../config";

// Check Chrome availability for bun-webview
let chromeAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WebView = (globalThis as any).Bun?.WebView;
  if (WebView) {
    const wv = new WebView({ headless: true, backend: "chrome", url: "about:blank" });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { wv.close(); reject(); }, 10_000);
      wv.onNavigated = () => { clearTimeout(timer); resolve(); };
      wv.onNavigationFailed = () => { clearTimeout(timer); reject(); };
    });
    wv.close();
    chromeAvailable = true;
  }
} catch {
  // Chrome not available
}

const TEST_PAGE_HTML = [
  "<!DOCTYPE html><html><head><title>CLI Test</title></head><body>",
  "<h1>Test</h1>",
  '<form><label for="email">Email</label>',
  '<input id="email" type="text">',
  '<button type="button">Submit</button></form>',
  "</body></html>",
].join("");
const TEST_PAGE_URL = `data:text/html,${encodeURIComponent(TEST_PAGE_HTML)}`;

describe.skipIf(!chromeAvailable)("CLI browser workflow", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `workglow-cli-test-${Date.now()}`);
    await mkdir(join(tmpDir, "definition", "workflow"), { recursive: true });
    await mkdir(join(tmpDir, "definition", "model"), { recursive: true });
    await mkdir(join(tmpDir, "definition", "agent"), { recursive: true });
    await mkdir(join(tmpDir, "definition", "mcp"), { recursive: true });
    await mkdir(join(tmpDir, "cache"), { recursive: true });

    // Register common tasks (includes browser tasks)
    registerCommonTasks();
    TaskRegistry.registerTask(BrowserSessionTask);
    TaskRegistry.registerTask(BrowserNavigateTask);
    TaskRegistry.registerTask(BrowserSnapshotTask);

    // Register browser deps using bun-webview
    const config: CliConfig = {
      directories: {
        models: join(tmpDir, "definition", "model"),
        workflows: join(tmpDir, "definition", "workflow"),
        agents: join(tmpDir, "definition", "agent"),
        mcps: join(tmpDir, "definition", "mcp"),
        cache: join(tmpDir, "cache"),
      },
      browser: {
        backend: "bun-webview",
        headless: true,
      },
    };
    await registerCliBrowserDeps(config);
  }, 30_000);

  afterEach(async () => {
    await BrowserSessionRegistry.disconnectAll();
    await rm(tmpDir, { recursive: true, force: true });
  }, 30_000);

  test("runs a browser workflow end-to-end", async () => {
    // Build the 3-task workflow
    const graph = new TaskGraph();

    const sessionTask = new BrowserSessionTask({ headless: true });
    const navigateTask = new BrowserNavigateTask({ waitUntil: "load" });
    const snapshotTask = new BrowserSnapshotTask();

    graph.addTask(sessionTask);
    graph.addTask(navigateTask);
    graph.addTask(snapshotTask);

    // Wire dataflows: session.sessionId -> navigate.sessionId
    graph.addDataflow(sessionTask, "sessionId", navigateTask, "sessionId");
    // Pass URL as input to navigate
    graph.addDataflow(navigateTask, "sessionId", snapshotTask, "sessionId");

    // Run with URL input for the navigate task
    const result = (await graph.run({
      [navigateTask.config.id + ":url"]: TEST_PAGE_URL,
    })) as Record<string, unknown>;

    // The snapshot task should be the last output
    const snapshotOutput = result[snapshotTask.config.id] as {
      sessionId: string;
      tree: { yaml: string; root: unknown };
    };

    expect(typeof snapshotOutput.sessionId).toBe("string");
    expect(snapshotOutput.tree).toBeDefined();
    expect(typeof snapshotOutput.tree.yaml).toBe("string");
    expect(snapshotOutput.tree.yaml).toContain("heading");
    expect(snapshotOutput.tree.yaml).toContain("button");
  }, 60_000);
});
```

Note: The exact `graph.run()` input format and output shape depend on how `TaskGraph` resolves inputs for individual tasks. The test may need adjustment to match the actual API (e.g., using `graph.addTask` with preset inputs, or passing inputs via the task's input ports). Verify against the `TaskGraph` API in `packages/task-graph/src/`.

- [ ] **Step 2: Run the test**

Run: `npx vitest run examples/cli/src/test/browser-workflow.test.ts`
Expected: passes if Chrome is available, skipped otherwise

- [ ] **Step 3: Commit**

```bash
git add examples/cli/src/test/browser-workflow.test.ts
git commit -m "test(cli): add browser workflow integration test"
```

---

## Task Dependency Summary

```
Task 1 (chromePath)
  └─> Task 2 (CDPBrowserBackend extraction)
        └─> Task 3 (BunWebViewBackend)
              ├─> Task 4 (generic test)
              └─> Task 5 (TOML config)
                    └─> Task 6 (CLI registration)
                          └─> Task 7 (CLI integration test)
```

Tasks 4 and 5 can run in parallel after Task 3.
