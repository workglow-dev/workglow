# Remote Browser Services

## Overview

`@workglow/browser` now supports cloud-based browser services that provide remote browser infrastructure. These services handle browser hosting, scaling, and maintenance while you focus on automation logic.

## Supported Providers

### 1. Browserless

**Open-source remote browser service**

- ✅ Self-hostable Docker container
- ✅ Cloud-hosted option available
- ✅ WebSocket CDP connection
- ✅ Multiple global regions
- ✅ Stealth mode

```typescript
.browser({
  backend: "browserless",
  remote: {
    apiKey: process.env.BROWSERLESS_TOKEN,
    region: "sfo",  // sfo (US West), lon (London), ams (Amsterdam)
  },
})
```

**Endpoints:**
- US West: `wss://production-sfo.browserless.io`
- London: `wss://production-lon.browserless.io`
- Amsterdam: `wss://production-ams.browserless.io`

### 2. Browserbase

**Managed browser infrastructure with advanced features**

- ✅ Session recordings & replays
- ✅ Live debugging dashboard
- ✅ Stealth & anti-fingerprinting
- ✅ File upload/download support
- ✅ Browser extensions

```typescript
import { Browserbase } from "@browserbasehq/sdk";

// Create session first
const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
const session = await bb.sessions.create({
  projectId: process.env.BROWSERBASE_PROJECT_ID,
});

// Use with workflow
.browser({
  backend: "browserbase",
  remote: {
    endpoint: session.connectUrl,
  },
})
```

### 3. Bright Data

**Proxy network with browser automation**

- ✅ Residential/datacenter/mobile proxies
- ✅ Automatic IP rotation
- ✅ Geographic targeting
- ✅ Captcha solving
- ✅ SERP scraping

```typescript
.browser({
  backend: "brightdata",
  remote: {
    apiKey: process.env.BRIGHT_DATA_CUSTOMER_ID,
    zone: "residential",  // residential, datacenter, mobile
  },
})
```

### 4. Cloudflare Browser Rendering

**Edge-native browser rendering (Workers only)**

- ✅ Global edge network
- ✅ Low latency worldwide
- ✅ Free tier available
- ⚠️ Requires Cloudflare Workers runtime

```typescript
// Note: Use @cloudflare/playwright directly in Workers
// Not via standard connection (different runtime)
```

## Usage Examples

### Browserless Example

```typescript
import { Workflow } from "@workglow/task-graph";
import "@workglow/browser";

const workflow = new Workflow()
  .browser({
    backend: "browserless",
    remote: {
      apiKey: process.env.BROWSERLESS_TOKEN,
      region: "lon",
    },
    headless: true,
  })
  .navigate({ url: "https://example.com/login" })
  .type({ 
    locator: { role: "textbox", name: "Email" },
    text: "user@example.com" 
  })
  .click({ locator: { role: "button", name: "Sign in" } })
  .wait({ locator: { role: "heading", name: /Welcome/ } })
  .screenshot({ fullPage: true });

const result = await workflow.run();
```

### Browserbase with Session Management

```typescript
import { Browserbase } from "@browserbasehq/sdk";
import { Workflow } from "@workglow/task-graph";
import "@workglow/browser";

// Initialize SDK
const bb = new Browserbase({ 
  apiKey: process.env.BROWSERBASE_API_KEY 
});

// Create session
const session = await bb.sessions.create({
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  // Optional: enable features
  extensionId: "...",  // Use browser extension
  keepAlive: true,     // Keep session alive longer
});

// Automation workflow
const workflow = new Workflow()
  .browser({
    backend: "browserbase",
    remote: {
      endpoint: session.connectUrl,
    },
  })
  .navigate({ url: "https://example.com" })
  .extract({ locator: { role: "heading" } });

const result = await workflow.run();

// Access session details
console.log("Session recording:", session.recordingUrl);
console.log("Live debug:", session.liveViewUrl);

// Clean up
await bb.sessions.stop(session.id);
```

### Bright Data with Proxy Rotation

```typescript
const workflow = new Workflow()
  .browser({
    backend: "brightdata",
    remote: {
      apiKey: process.env.BRIGHT_DATA_CUSTOMER_ID,
      zone: "residential",
    },
  })
  // Each request goes through a different residential IP
  .navigate({ url: "https://api.ipify.org/?format=json" })
  .runScript({ script: "document.body.textContent" });

const result = await workflow.run();
// Returns different IP each time due to rotation
```

### Direct API Usage

```typescript
import { createBrowserlessContext, createBrowserbaseContext } from "@workglow/browser";

// Browserless direct
const browserless = await createBrowserlessContext(
  process.env.BROWSERLESS_TOKEN,
  { region: "sfo" }
);

await browserless.navigate("https://example.com");
const tree = await browserless.getAccessibilityTree();
await browserless.close();
```

## Provider Comparison

| Feature | Browserless | Browserbase | Bright Data | Cloudflare |
|---------|-------------|-------------|-------------|------------|
| **Self-Hostable** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Free Tier** | ✅ Yes | ⚠️ Trial | ❌ No | ✅ Yes |
| **Session Replay** | ❌ No | ✅ Yes | ❌ No | ❌ No |
| **Stealth Mode** | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ Basic |
| **Proxy Network** | ❌ No | ❌ No | ✅ Yes | ❌ No |
| **Geographic Regions** | 3 | Global | 195 | Global |
| **IP Rotation** | ❌ No | ❌ No | ✅ Yes | ❌ No |
| **Extensions** | ⚠️ Limited | ✅ Yes | ⚠️ Limited | ❌ No |
| **Captcha Solving** | ❌ No | ⚠️ Partial | ✅ Yes | ❌ No |

## When to Use Each

### Use Browserless When:
- Building internal tools (can self-host)
- Need cost control (open source)
- Want multiple deployment regions
- Don't need advanced features like session replay

### Use Browserbase When:
- Need session recordings for debugging
- Want live debugging dashboard
- Building testing infrastructure
- Need reliable stealth/fingerprinting

### Use Bright Data When:
- Scraping geo-restricted content
- Need residential IP addresses
- Require automatic IP rotation
- Dealing with heavy anti-bot protection
- Need CAPTCHA solving

### Use Cloudflare When:
- Already using Cloudflare Workers
- Need global edge deployment
- Want free tier for basic tasks
- Building serverless functions

## Configuration Reference

### Browserless

```typescript
{
  backend: "browserless",
  remote: {
    apiKey: "your-token",
    region: "sfo" | "lon" | "ams",  // Optional
  },
}
```

### Browserbase

```typescript
{
  backend: "browserbase",
  remote: {
    endpoint: "wss://connect.browserbase.com/...",  // From SDK
  },
}
```

### Bright Data

```typescript
{
  backend: "brightdata",
  remote: {
    apiKey: "customer-id",
    zone: "residential" | "datacenter" | "mobile",
  },
}
```

## Multi-Provider Strategy

You can abstract the provider choice:

```typescript
function createBrowserWorkflow(provider: string) {
  const config = {
    browserless: {
      backend: "browserless" as const,
      remote: { apiKey: process.env.BROWSERLESS_TOKEN },
    },
    browserbase: {
      backend: "browserbase" as const,
      remote: { endpoint: process.env.BROWSERBASE_ENDPOINT },
    },
    brightdata: {
      backend: "brightdata" as const,
      remote: { 
        apiKey: process.env.BRIGHT_DATA_CUSTOMER_ID,
        zone: "residential",
      },
    },
  }[provider];

  return new Workflow().browser(config);
}

// Use different providers based on task
const workflow = createBrowserWorkflow("browserless");
```

## Cost Optimization

### Use Local Development, Remote Production

```typescript
const isDev = process.env.NODE_ENV === "development";

const workflow = new Workflow()
  .browser({
    backend: isDev ? "playwright" : "browserless",
    ...(isDev ? {} : {
      remote: { apiKey: process.env.BROWSERLESS_TOKEN },
    }),
  });
```

### Session Reuse (Browserbase)

```typescript
// Create long-lived session
const session = await bb.sessions.create({
  projectId: PROJECT_ID,
  keepAlive: true,  // Extend session lifetime
});

// Use for multiple workflows
const workflow1 = new Workflow().browser({
  backend: "browserbase",
  remote: { endpoint: session.connectUrl },
});

const workflow2 = new Workflow().browser({
  backend: "browserbase",
  remote: { endpoint: session.connectUrl },
});

// Run multiple tasks on same session
await workflow1.run();
await workflow2.run();
```

## Error Handling

```typescript
try {
  const workflow = new Workflow()
    .browser({
      backend: "browserless",
      remote: { apiKey: process.env.BROWSERLESS_TOKEN },
    })
    .navigate({ url: "https://example.com" });
    
  const result = await workflow.run();
} catch (error) {
  if (error.message.includes("authentication")) {
    console.error("Invalid API key");
  } else if (error.message.includes("timeout")) {
    console.error("Remote browser connection timeout");
  } else {
    console.error("Browser automation failed:", error);
  }
}
```

## Testing

```bash
# Remote browser configuration tests
bun test src/test/RemoteBrowser.test.ts

# All tests
npm test
```

## Environment Variables

Set these for your chosen provider:

```bash
# Browserless
export BROWSERLESS_TOKEN="your-token"

# Browserbase
export BROWSERBASE_API_KEY="your-api-key"
export BROWSERBASE_PROJECT_ID="your-project-id"

# Bright Data
export BRIGHT_DATA_CUSTOMER_ID="your-customer-id"

# Cloudflare
# (Set up in wrangler.toml for Workers)
```

## Further Reading

- [Browserless Documentation](https://docs.browserless.io/)
- [Browserbase Documentation](https://docs.browserbase.com/)
- [Bright Data Documentation](https://docs.brightdata.com/)
- [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/)
