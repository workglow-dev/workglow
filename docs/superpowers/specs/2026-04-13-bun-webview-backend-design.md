# Bun.WebView Browser Backend

Add `BunWebViewBackend` as a new `IBrowserContext` implementation using Bun's built-in `Bun.WebView` API. Extract shared CDP logic into a base class. Wire it as the default browser backend in the CLI via TOML configuration.

## Goals

- New `BunWebViewBackend` implementing `IBrowserContext` via `Bun.WebView` + Chrome DevTools Protocol
- Shared `CDPBrowserBackend` base class extracted from `ElectronBackend`, reused by both `ElectronBackend` and `BunWebViewBackend`
- CLI TOML config (`~/.workglow.toml`) gains a `[browser]` section to select backend and configure Chrome path
- `bun-webview` is the default backend for CLI; requires Chrome/Chromium installed — hard error if not found
- End-to-end CLI integration test running a browser workflow through the `workflow run` code path

## Non-Goals

- WebKit backend support (macOS-only, not relevant for server-side CLI)
- Auto-fallback to Playwright when Chrome is missing
- Browser backend selection UI in the web app or Electron builder

## Architecture

### CDPBrowserBackend base class

**File:** `packages/tasks/src/task/browser/CDPBrowserBackend.ts`

Abstract base class encapsulating all Chrome DevTools Protocol interactions shared between `ElectronBackend` and `BunWebViewBackend`. Subclasses provide the CDP transport; the base class implements the `IBrowserContext` methods that depend on it.

**Abstract method:**

```typescript
protected abstract cdp(method: string, params?: Record<string, unknown>): Promise<unknown>;
```

**Extracted from ElectronBackend into the base:**

- Ref management: `_refMap: Map<ElementRef, number | null>`, `_refCounter: { count: number }`, `resolveRefToNodeId(ref)`
- Accessibility: `parseCDPAXTree()`, `serializeAXTree()`, `snapshot()` (calls `cdp("Accessibility.getFullAXTree")`)
- DOM queries: `getDocumentRootNodeId()`, `querySelector()`, `querySelectorAll()`
- Element interaction by ref: `click(ref)` via `getBoundingBox()` + `Input.dispatchMouseEvent`, `fill(ref, value)` via `DOM.focus` + `Input.insertText`, `selectOption()`, `hover()`
- Semantic interaction: `clickByRole()` via `Accessibility.queryAXTree`, `fillByLabel()` with CDP-first + JS fallback
- Content extraction: `innerHTML()`, `textContent()`, `attribute()` via `DOM.resolveNode` + `Runtime.callFunctionOn`
- File operations: `uploadFile()` via `DOM.setFileInputFiles`
- Scrolling: `scroll(x, y, ref?)` via `Input.dispatchMouseEvent` or `Runtime.callFunctionOn`
- Helpers: `getBoundingBox()`, `buildModifiersMask()`, `KEY_CODE_MAP`, `keyToCode()`, `sleep()`

**What stays abstract / in subclasses:**

Lifecycle (`connect`, `disconnect`, `isConnected`), navigation (`navigate`, `goBack`, `goForward`, `reload`, `currentUrl`, `title`), evaluation (`evaluate`), capture (`screenshot`), input (`pressKey`, `type`), content (`content`), download, dialog handling, tabs, wait methods.

### BunWebViewBackend

**File:** `packages/tasks/src/task/browser/BunWebViewBackend.ts`

Extends `CDPBrowserBackend`. Wraps a `Bun.WebView` instance configured with `backend: "chrome"`.

**Lifecycle:**

- `connect(options)`: Creates `new Bun.WebView({ headless: true, backend: { type: "chrome", path: options.chromePath }, dataStore: "ephemeral" })`. Navigates to `about:blank` and waits for `onNavigated` callback to confirm Chrome is ready. Calls `cdp("Accessibility.enable")`.
- `disconnect()`: Calls `wv.close()`, clears `_refMap`, resets `_refCounter`.
- `isConnected()`: Returns `_connected && wv !== null`.

**CDP passthrough:**

```typescript
protected async cdp(method: string, params?: Record<string, unknown>): Promise<unknown> {
  return this._wv.cdp(method, params ?? {});
}
```

**Native methods (use WebView directly for better performance/ergonomics):**

| IBrowserContext method | Implementation |
|----------------------|----------------|
| `navigate(url)` | `await wv.navigate(url)` |
| `goBack()` | `await wv.back()` |
| `goForward()` | `await wv.forward()` |
| `reload()` | `await wv.reload()` |
| `currentUrl()` | `wv.url` (property) |
| `title()` | `wv.title` (property) |
| `evaluate(expr)` | `await wv.evaluate(expr)` |
| `screenshot()` | `await wv.screenshot({ encoding: "buffer" })` |
| `pressKey(key)` | `await wv.press(key)` |
| `type(text)` | `await wv.type(text)` |
| `content()` | `await wv.evaluate("document.documentElement.outerHTML")` |

**Dialog handling:**

Uses CDP events via `Bun.WebView.addEventListener`:

```typescript
await this.cdp("Page.enable");
this._wv.addEventListener("Page.javascriptDialogOpening", async (event) => {
  // Extract type, message, defaultPrompt from event.data
  // Call handler, respond with cdp("Page.handleJavaScriptDialog", { accept, promptText })
});
```

**Not supported (throw with clear error):**

- `download()`: `Bun.WebView` has no download interception API
- Tabs: single-view model — `tabs()` returns one entry, `newTab(url)` navigates current view, `closeTab()` disconnects

**Wait methods:**

- `waitForNavigation()`: `await wv.navigate(wv.url)` or poll `wv.loading`
- `waitForSelector(selector)`: poll via `evaluate("!!document.querySelector(...)")` with timeout
- `waitForIdle()`: poll via `evaluate('document.readyState === "complete"')` with timeout

### BrowserConnectOptions extension

Add optional `chromePath` to `BrowserConnectOptions` in `IBrowserContext.ts`:

```typescript
export interface BrowserConnectOptions {
  readonly backend?: BrowserBackendType;
  readonly projectId?: string;
  readonly profileName?: string;
  readonly headless?: boolean;
  readonly cdpUrl?: string;
  readonly chromePath?: string;  // new — path to Chrome binary for bun-webview
}
```

`BunWebViewBackend.connect()` reads `options.chromePath` and passes it to the WebView constructor's `backend.path`.

### Entry point wiring

**`packages/tasks/src/bun.ts`:**

`registerBrowserDepsServer()` currently always creates a `PlaywrightBackend`. No change here — the CLI overrides this with its own `registerBrowserDeps()` call based on TOML config. The `bun.ts` entry point remains the default for non-CLI Bun consumers (Playwright).

The `BunWebViewBackend` is not auto-registered in any entry point — it's opt-in via the CLI config or direct import.

### Generic test suite integration

Add `BunWebViewBackend` to the existing `runGenericBrowserTaskTests` pattern:

**File:** `packages/test/src/test/browser/BunWebViewBrowser.integration.test.ts`

```typescript
import { BunWebViewBackend } from "@workglow/tasks";

let bunWebViewAvailable = false;
try {
  // Bun.WebView exists and Chrome is available
  const wv = new Bun.WebView({ headless: true, backend: "chrome" });
  await wv.navigate("about:blank");
  wv.close();
  bunWebViewAvailable = true;
} catch { /* Chrome not installed or WebView unavailable */ }

describe.skipIf(!bunWebViewAvailable)("Browser Tasks (BunWebViewBackend)", () => {
  runGenericBrowserTaskTests(() => new BunWebViewBackend(), { hookTimeout: 30_000 });
});
```

## CLI Integration

### TOML config

Extend `~/.workglow.toml` with a `[browser]` section:

```toml
[directories]
models = "~/.workglow/definition/model"
workflows = "~/.workglow/definition/workflow"
agents = "~/.workglow/definition/agent"
mcps = "~/.workglow/definition/mcp"
cache = "~/.workglow/cache"

[browser]
backend = "bun-webview"
# chrome-path = "/usr/bin/chromium"
# headless = true
```

### Config type

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

Defaults: `backend = "bun-webview"`, `headless = true`, `chrome-path` unset (Bun auto-detects).

### Backend registration

**File:** `examples/cli/src/browser.ts`

```typescript
export async function registerCliBrowserDeps(config: CliConfig): Promise<void>
```

- Reads `config.browser?.backend` (default `"bun-webview"`)
- If `"bun-webview"`: dynamically imports `BunWebViewBackend`, registers via `registerBrowserDeps()` with `createContext` passing `chromePath` from config
- If `"playwright"`: dynamically imports `PlaywrightBackend`, registers as today
- Profile storage: filesystem under `~/.workglow/browser-profiles/` with `safeName` validation (reuse pattern from `server.ts`)
- Hard error if `"bun-webview"` and Chrome is not found (Bun.WebView constructor throws)

**Called from** `workflow run` command in `workflow.ts`, before `withCli(graph, ...).run(...)`.

### `init` command update

`init.ts` updated to include `[browser]` section in the default TOML output:

```toml
[browser]
backend = "bun-webview"
headless = true
```

## CLI Integration Test

**File:** `examples/cli/src/test/browser-workflow.test.ts`

Tests the full `workflow run` code path with a browser workflow.

**Workflow under test:** 3-task pipeline:
1. `BrowserSessionTask` — opens headless session
2. `BrowserNavigateTask` — navigates to `data:text/html,...` test page (heading + textbox + button)
3. `BrowserSnapshotTask` — returns accessibility tree

Tasks piped via dataflows: session outputs `sessionId` → navigate input, navigate outputs `sessionId` → snapshot input.

**Test structure:**

```typescript
describe.skipIf(!chromeAvailable)("CLI browser workflow", () => {
  // Setup: temp dir, write TOML config, register deps + common tasks

  test("runs a browser workflow end-to-end", async () => {
    // 1. Build TaskGraph with 3 tasks + dataflows
    // 2. Save to temp workflow repo
    // 3. Load back, run (same code path as `workflow run`)
    // 4. Assert: output.sessionId is a string
    // 5. Assert: output.tree.yaml contains "heading", "button"
  });
});
```

Gated on Chrome availability with `describe.skipIf`.

## File Summary

| File | Action |
|------|--------|
| `packages/tasks/src/task/browser/CDPBrowserBackend.ts` | New — abstract base class |
| `packages/tasks/src/task/browser/BunWebViewBackend.ts` | New — Bun.WebView backend |
| `packages/tasks/src/task/browser/ElectronBackend.ts` | Refactor — extend CDPBrowserBackend |
| `packages/tasks/src/task/browser/IBrowserContext.ts` | Add `chromePath` to `BrowserConnectOptions` |
| `packages/tasks/src/task/browser/index.ts` | Export new files |
| `packages/tasks/src/bun.ts` | No change (Playwright remains default for non-CLI) |
| `packages/tasks/tsconfig.json` | Add new files if needed |
| `packages/test/src/test/browser/BunWebViewBrowser.integration.test.ts` | New — generic test with BunWebViewBackend |
| `examples/cli/src/config.ts` | Extend `CliConfig` with `browser` section |
| `examples/cli/src/browser.ts` | New — `registerCliBrowserDeps()` |
| `examples/cli/src/commands/init.ts` | Add `[browser]` to default TOML |
| `examples/cli/src/commands/workflow.ts` | Call `registerCliBrowserDeps()` before run |
| `examples/cli/src/test/browser-workflow.test.ts` | New — CLI integration test |
