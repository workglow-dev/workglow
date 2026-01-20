# Session Isolation & Cookie Management

## Overview

The `@workglow/browser` package provides multiple layers of session and cookie isolation across all backends:

1. **CookieStore** - Application-level cookie management (all backends)
2. **Playwright Contexts** - Browser-level isolation (local Playwright)
3. **Playwright Persistent** - Disk-based persistence (userDataDir, storageState)
4. **Electron Partitions** - Session-level isolation with persistence
5. **Remote Browser Sessions** - Cloud service isolation (Browserless, Browserbase, Bright Data)

## CookieStore (All Backends)

The `CookieStore` class provides programmatic cookie management that works with both Playwright and Electron:

```typescript
const cookies = new CookieStore();

// Set cookies
cookies.set({
  name: "session_id",
  value: "abc123",
  domain: "example.com",
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "Lax",
});

// Save to JSON for persistence
const json = cookies.toJSON();
localStorage.setItem("cookies", JSON.stringify(json));

// Restore later
const restored = CookieStore.fromJSON(JSON.parse(...));
```

### Features:
- Domain/subdomain matching
- Path-based scoping
- Expiration handling
- JSON serialization
- Automatic sync with browser

## Playwright Context Isolation

Playwright creates isolated browser contexts automatically:

```typescript
const context1 = await createPlaywrightContext(config1, cookies1);
const context2 = await createPlaywrightContext(config2, cookies2);

// context1 and context2 have completely separate:
// - Cookies
// - localStorage
// - Sessions
```

### Characteristics:
- ✅ Completely isolated by default
- ✅ No cross-context data leakage
- ❌ No built-in persistence (use CookieStore)
- ❌ Must manually save/restore sessions

## Electron Partition Isolation

Electron partitions provide the most powerful isolation with built-in persistence:

```typescript
// Persistent partition (stored on disk)
const user1 = new ElectronContext(
  { partition: "persist:account-1" },
  new CookieStore()
);

// In-memory partition (cleared on quit)
const guest = new ElectronContext(
  { partition: "guest-session" },
  new CookieStore()
);
```

### Partition Types

| Type | Syntax | Persistence | Use Case |
|---------|--------|-------------|----------|
| Default | `undefined` | Disk | Main app session |
| Persistent | `persist:name` | Disk | User accounts |
| In-Memory | `name` | RAM | Guest/temp browsing |

### What's Isolated

Different Electron partitions have **completely separate**:

- ✅ Cookies
- ✅ localStorage & sessionStorage
- ✅ IndexedDB
- ✅ Cache (HTTP & asset cache)
- ✅ Service Workers
- ✅ Web SQL (deprecated)
- ✅ File System API
- ✅ Background Sync

### Persistence

**Persistent partitions** (`persist:name`):
- Stored in `userData/Partitions/<name>/`
- Survive app restarts
- Perfect for user accounts

**In-memory partitions** (no prefix):
- Only in RAM
- Cleared when app quits
- Perfect for guest mode, testing

## Playwright Persistent Contexts

Playwright supports disk-based persistence equivalent to Electron partitions:

```typescript
// Persistent context (auto-saves to disk)
const context = await createPlaywrightContext(
  { userDataDir: "./user-data/profile-1" },
  new CookieStore()
);
```

### Features:
- ✅ Automatic persistence to disk
- ✅ Survives process restarts
- ✅ Isolated per userDataDir path
- ✅ Includes cookies, localStorage, IndexedDB, cache
- ✅ Alternative: `storageState` for manual save/load

**Equivalent to Electron:**
- `userDataDir: "./profile"` ≈ `partition: "persist:profile"`
- Default context ≈ `partition: "temp"`

See [PLAYWRIGHT_PERSISTENT.md](./PLAYWRIGHT_PERSISTENT.md) for details.

## Remote Browser Services

Cloud-hosted browsers provide session isolation through their infrastructure:

### Browserless (Open Source, Self-Hostable)

```typescript
.browser({
  backend: "browserless",
  remote: {
    apiKey: process.env.BROWSERLESS_TOKEN,
    region: "sfo",  // sfo, lon, or ams
  },
})
```

**Isolation:**
- Each connection creates a fresh browser instance
- Sessions automatically isolated
- Can use multiple API keys for account separation

### Browserbase (Managed Infrastructure)

```typescript
// Create session via SDK
const bb = new Browserbase({ apiKey: API_KEY });
const session = await bb.sessions.create({ projectId: PROJECT_ID });

.browser({
  backend: "browserbase",
  remote: { endpoint: session.connectUrl },
})
```

**Isolation:**
- Each session completely isolated
- Sessions persist with `keepAlive` option
- Full session replay available

### Bright Data (Proxy Network + Browser)

```typescript
.browser({
  backend: "brightdata",
  remote: {
    apiKey: CUSTOMER_ID,
    zone: "residential",
  },
})
```

**Isolation:**
- Each request can use different residential IP
- Zone-based isolation (residential, datacenter, mobile)
- Automatic IP rotation provides additional anonymization

### Why Use Remote Browsers?

- ✅ No browser maintenance/installation
- ✅ Global infrastructure
- ✅ Scalable (handle thousands of concurrent sessions)
- ✅ Built-in anti-detection/stealth
- ✅ IP rotation (Bright Data)
- ✅ Session recordings (Browserbase)

See [REMOTE_BROWSERS.md](./REMOTE_BROWSERS.md) for provider comparison and setup.

## Comparison Matrix

| Feature | CookieStore | Playwright Local | Playwright Persistent | Electron Partitions | Remote Browsers |
|---------|-------------|------------------|----------------------|---------------------|-----------------|
| Cookie Isolation | Manual | Auto per context | Auto per context | Auto per partition | Auto per session |
| Persistence | JSON export | No | Yes (userDataDir) | Yes (persist:) | Provider-dependent |
| Storage APIs | Cookies only | All storage | All storage | All storage | All storage |
| Cross-Window Sharing | N/A | No | No | Yes (same partition) | Provider-dependent |
| Multi-Account | Via store instances | Via contexts | Via userDataDir | Via partitions | Via sessions |
| Disk Storage | No | No | Yes | Yes | Cloud storage |
| Setup Complexity | Low | Low | Medium | Low | Medium |
| Cost | Free | Free | Free | Free | Paid (most) |

## Multi-Account Example

### Approach 1: Separate CookieStores (Any Backend)

```typescript
const user1Cookies = CookieStore.fromJSON(loadUser1Cookies());
const user2Cookies = CookieStore.fromJSON(loadUser2Cookies());

// Each workflow uses different cookie store
const workflow1 = new Workflow().browser({ cookies: user1Cookies });
const workflow2 = new Workflow().browser({ cookies: user2Cookies });
```

### Approach 2: Electron Partitions (Electron Only)

```typescript
// Persistent, isolated, auto-persisted
const workflow1 = new Workflow().browser({
  backend: "electron",
  partition: "persist:user1@example.com",
});

const workflow2 = new Workflow().browser({
  backend: "electron",
  partition: "persist:user2@example.com",
});

// No manual cookie management needed!
```

### Approach 3: Playwright Persistent Contexts (Playwright)

```typescript
// Auto-persisted to disk, isolated per directory
const workflow1 = new Workflow().browser({
  backend: "playwright",
  userDataDir: "./profiles/user1@example.com",
});

const workflow2 = new Workflow().browser({
  backend: "playwright",
  userDataDir: "./profiles/user2@example.com",
});

// Cookies, localStorage, IndexedDB auto-saved!
```

### Approach 4: Remote Browser Sessions (Cloud Services)

```typescript
// Browserless with different regions/tokens
const workflow1 = new Workflow().browser({
  backend: "browserless",
  remote: { apiKey: USER1_TOKEN, region: "sfo" },
});

const workflow2 = new Workflow().browser({
  backend: "browserless",
  remote: { apiKey: USER2_TOKEN, region: "sfo" },
});

// Or Browserbase with separate sessions
const session1 = await bb.sessions.create({ projectId: PROJECT1 });
const session2 = await bb.sessions.create({ projectId: PROJECT2 });

const workflow1 = new Workflow().browser({
  backend: "browserbase",
  remote: { endpoint: session1.connectUrl },
});
```

## Security Considerations

### Isolating Privilege Levels

```typescript
// Admin panel - high privilege
.browser({
  backend: "electron",
  partition: "persist:admin",
  cookies: adminCookies,
})

// User content - lower privilege
.browser({
  backend: "electron",
  partition: "persist:user",
  cookies: userCookies,
})

// Ensures admin cookies can't leak to user context
```

### Guest/Incognito Mode

```typescript
// In-memory partition - auto-cleared
.browser({
  backend: "electron",
  partition: "incognito-session", // No persist: prefix
})

// All data gone when app quits
```

## Testing Different Scenarios

```typescript
// Scenario A - fresh state
const testA = new ElectronContext(
  { partition: "test-scenario-a" },
  new CookieStore()
);

// Scenario B - independent state
const testB = new ElectronContext(
  { partition: "test-scenario-b" },
  new CookieStore()
);

// Each has isolated cookies, cache, storage
```

## Best Practices

1. **Use persistent partitions** for user accounts that should survive restarts
2. **Use in-memory partitions** for temporary/guest browsing
3. **Use descriptive names** like `persist:user-john@example.com`
4. **Isolate privilege levels** (admin vs user) with different partitions
5. **Clean up sensitive data** when switching users:
   ```typescript
   const { session } = require('electron');
   await session.fromPartition('persist:user').clearStorageData();
   ```

## Example: Multi-Account App

```typescript
class MultiAccountBrowser {
  private contexts = new Map<string, ElectronContext>();

  async createAccount(userId: string) {
    const cookies = new CookieStore();
    const context = new ElectronContext(
      { partition: `persist:${userId}`, headless: true },
      cookies
    );
    this.contexts.set(userId, context);
    return context;
  }

  async switchAccount(userId: string) {
    return this.contexts.get(userId);
  }

  async deleteAccount(userId: string) {
    const context = this.contexts.get(userId);
    await context?.close();
    this.contexts.delete(userId);
    
    // Clear partition data
    const { session } = require('electron');
    await session.fromPartition(`persist:${userId}`).clearStorageData();
  }
}
```

## Remote Browser Isolation

Remote browser services provide session isolation through their infrastructure:

### Browserless

```typescript
.browser({
  backend: "browserless",
  remote: {
    apiKey: process.env.BROWSERLESS_TOKEN,
    region: "sfo",  // Each connection gets isolated session
  },
})
```

- Each connection creates a fresh browser instance
- Sessions isolated by default
- Can use multiple API keys for account isolation

### Browserbase

```typescript
// Create session via SDK
const session = await bb.sessions.create({
  projectId: PROJECT_ID,
});

.browser({
  backend: "browserbase",
  remote: { endpoint: session.connectUrl },
})
```

- Each session is completely isolated
- Sessions can be long-lived with `keepAlive`
- Full session replay and debugging

### Bright Data

```typescript
.browser({
  backend: "brightdata",
  remote: {
    apiKey: CUSTOMER_ID,
    zone: "residential",  // Proxy zone provides isolation
  },
})
```

- Each request can use different residential IPs
- Zone-based isolation (residential, datacenter, mobile)
- Automatic IP rotation

## Backend Selection Guide

Choose based on your requirements:

| Requirement | Best Backend | Reason |
|-------------|--------------|--------|
| Desktop app | Electron | Native integration |
| Local dev/testing | Playwright | Free, fast |
| Multi-account persistence | Electron partitions or Playwright userDataDir | Auto-persistence |
| Scalable cloud | Remote (Browserless/Browserbase) | No maintenance |
| IP rotation | Bright Data | Proxy network |
| Session recordings | Browserbase | Built-in replays |
| Self-hosted | Browserless | Open source |
| Edge compute | Cloudflare | Global CDN |

## Further Reading

### Session Isolation
- [ELECTRON_PARTITIONS.md](./ELECTRON_PARTITIONS.md) - Electron partition guide
- [PLAYWRIGHT_PERSISTENT.md](./PLAYWRIGHT_PERSISTENT.md) - Playwright persistence
- [COMPARISON.md](./COMPARISON.md) - Backend comparison

### Remote Browsers
- [REMOTE_BROWSERS.md](./REMOTE_BROWSERS.md) - Cloud services guide

### Examples
- [examples/electron-partitions.ts](../examples/electron-partitions.ts)
- [examples/session-comparison.ts](../examples/session-comparison.ts)
- [examples/remote-browsers.ts](../examples/remote-browsers.ts)

### Tests
- [src/test/ElectronPartition.test.ts](../src/test/ElectronPartition.test.ts)
- [src/test/PlaywrightPersistent.test.ts](../src/test/PlaywrightPersistent.test.ts)
- [src/test/RemoteBrowser.test.ts](../src/test/RemoteBrowser.test.ts)
