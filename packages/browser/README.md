# @workglow/browser

Browser automation for Workglow using accessibility trees for stable element selection.

## Features

- **Accessibility-First Locators**: Use semantic selectors like `{ role: "button", name: "Submit" }` instead of fragile CSS selectors
- **Multi-Backend Support**: Works with Playwright, Electron, and remote browser services
- **Remote Browsers**: Browserless, Browserbase, Bright Data, Cloudflare Browser Rendering
- **Cookie Management**: Configurable cookies for session persistence across tasks
- **Session Isolation**: Electron partitions and Playwright persistent contexts
- **Chainable Workflow API**: Fluent API for building browser automation workflows
- **Task-Based Architecture**: Composable browser actions as tasks in graphs

## Installation

```bash
npm install @workglow/browser playwright
# or for Electron
npm install @workglow/browser electron
```

## Quick Start

### Chainable Workflow API

```typescript
import { Workflow } from "@workglow/task-graph";
import "@workglow/browser";

// Example: Login workflow with cookie persistence
const result = await new Workflow()
  .browser({ 
    cookies: savedCookies,
    headless: true 
  })
  .navigate({ url: "https://example.com/login" })
  .type({ 
    locator: { role: "textbox", name: "Email" }, 
    text: "user@example.com" 
  })
  .type({ 
    locator: { role: "textbox", name: "Password" }, 
    text: "password123" 
  })
  .click({ locator: { role: "button", name: "Sign in" } })
  .wait({ locator: { role: "heading", name: /Welcome/ } })
  .extract({ locator: { role: "heading", name: /Welcome/ } })
  .run();

console.log(result); // { name: "Welcome, User!", value: undefined, role: "heading" }
```

### Direct Context API

```typescript
import { createPlaywrightContext, CookieStore } from "@workglow/browser";

// Create a browser context
const cookies = new CookieStore();
const context = await createPlaywrightContext(
  { headless: true, viewport: { width: 1280, height: 720 } },
  cookies
);

// Navigate and interact
await context.navigate("https://example.com");
const tree = await context.getAccessibilityTree();

// Find and click using A11y locators
const button = tree.find({ role: "button", name: /submit/i });
if (button) {
  await context.click(button);
}

// Close when done
await context.close();
```

### Electron Backend with Hidden Windows

```typescript
import { Workflow } from "@workglow/task-graph";
import "@workglow/browser";

// Use Electron with hidden window
const result = await new Workflow()
  .browser({ 
    backend: "electron",
    headless: true,  // Creates hidden BrowserWindow
    partition: "persist:user-session"  // Isolated session
  })
  .navigate({ url: "https://example.com" })
  .screenshot({ fullPage: true })
  .run();
```

### Electron Session Isolation

Electron supports **session partitions** for complete cookie/storage isolation:

```typescript
// Persistent partition (survives restarts)
const user1 = new Workflow().browser({
  backend: "electron",
  partition: "persist:account-1",  // Stored on disk
});

// In-memory partition (cleared on quit)
const guest = new Workflow().browser({
  backend: "electron",  
  partition: "guest-session",  // Memory only
});

// Different partitions = completely isolated:
// - Cookies, localStorage, IndexedDB
// - Cache, service workers
// - Perfect for multi-account or admin/user separation
```

See [docs/ELECTRON_PARTITIONS.md](docs/ELECTRON_PARTITIONS.md) for detailed examples.

### Remote Browser Services

Use cloud-hosted browsers for scalability and global distribution:

```typescript
// Browserless (open source, self-hostable)
const workflow = new Workflow().browser({
  backend: "browserless",
  remote: {
    apiKey: process.env.BROWSERLESS_TOKEN,
    region: "sfo",  // sfo, lon, or ams
  },
});

// Browserbase (managed, with recordings)
.browser({
  backend: "browserbase",
  remote: {
    endpoint: session.connectUrl,  // From Browserbase SDK
  },
});

// Bright Data (proxy network + browser)
.browser({
  backend: "brightdata",
  remote: {
    apiKey: process.env.BRIGHT_DATA_CUSTOMER_ID,
    zone: "residential",  // residential, datacenter, mobile
  },
});
```

**Benefits:**
- No browser maintenance
- Global infrastructure
- Stealth/anti-detection features
- IP rotation (Bright Data)
- Session recordings (Browserbase)

See [docs/REMOTE_BROWSERS.md](docs/REMOTE_BROWSERS.md) for detailed provider comparison.

## Accessibility Tree

The accessibility tree provides stable element selection that survives UI changes:

### Why Use A11y Locators?

- **Resilient**: Survives CSS class changes, layout modifications, and restructuring
- **Semantic**: Based on how users (and screen readers) perceive the page
- **Stable**: Uses ARIA roles, labels, and semantic HTML
- **Maintainable**: `{ role: "button", name: "Submit" }` is clearer than `.btn-primary.submit-btn[data-test="submit"]`

### A11y Locator Examples

```typescript
// Find by role
{ role: "button" }

// Find by role and name (partial match)
{ role: "textbox", name: "email" }

// Find by exact name
{ role: "link", nameExact: "Home" }

// Find by state
{ role: "checkbox", state: { checked: true } }

// Find with regex
{ role: "heading", name: /welcome/i }

// Find nth element when multiple match
{ role: "button", name: "Delete", nth: 2 }

// Find including hidden elements
{ role: "div", visible: false }
```

## Cookie Management

```typescript
import { CookieStore } from "@workglow/browser";

// Create and populate cookie store
const cookies = new CookieStore();
cookies.set({
  name: "session",
  value: "abc123",
  domain: "example.com",
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "Lax",
});

// Save cookies to JSON
const json = cookies.toJSON();
localStorage.setItem("cookies", JSON.stringify(json));

// Load cookies from JSON
const savedJson = JSON.parse(localStorage.getItem("cookies"));
const restoredCookies = CookieStore.fromJSON(savedJson);

// Use in workflow
const workflow = new Workflow().browser({ cookies: restoredCookies });
```

## Supported Backends

**Local:**
- Playwright - Full-featured local automation (with persistent contexts)
- Electron - Desktop apps with hidden windows and session partitions

**Remote (Cloud Services):**
- Browserless - Open source, self-hostable, multiple regions
- Browserbase - Managed infrastructure with session recordings
- Bright Data - Proxy network with IP rotation and geo-targeting
- Cloudflare Browser Rendering - Edge-native (requires Workers runtime)

See [docs/REMOTE_BROWSERS.md](docs/REMOTE_BROWSERS.md) and [docs/COMPARISON.md](docs/COMPARISON.md) for details.

## Available Tasks

- **NavigateTask**: Navigate to URLs
- **ClickTask**: Click elements using A11y locators
- **TypeTask**: Type text into input fields
- **ExtractTask**: Extract text/values from page elements
- **WaitTask**: Wait for elements to appear
- **ScreenshotTask**: Capture page screenshots
- **RunScriptTask**: Execute custom JavaScript in page context
- **BrowserInitTask**: Initialize browser context (used internally by Workflow)

## Architecture

```
Workflow API
    ↓
Browser Tasks (NavigateTask, ClickTask, etc.)
    ↓
Browser Context (PlaywrightContext / ElectronContext)
    ↓
Accessibility Tree Parser (injected into page)
    ↓
Page DOM (ARIA + Semantic HTML)
```

## Testing

Run the complete test suite (includes Playwright + Electron):

```bash
bun run test
```


### Test Commands

```bash
# All tests (Playwright + Electron) - recommended
bun run test


# Unit tests only (fast, no browser launch)
bun run test:unit

# Electron tests only (runs in Electron app)
bun run test:electron
```

**Note:** Running `bun test` directly may be flaky on Linux without a display server. Use `bun test` (which uses the wrapper script) or `./test.sh` for reliable test execution.

### Running Electron Tests

Electron tests run in a dedicated Electron app (`test-electron/`) because BrowserWindow is only available inside Electron. The test automatically uses xvfb on Linux.

**Prerequisites:**
- Linux: `sudo apt-get install xvfb libgtk-3-0`
- macOS/Windows: No additional setup needed

## Development

```bash
# Watch mode for development
bun run watch

# Build the package
bun run build-package

# Run linter
bun run lint
```

## License

Apache-2.0
