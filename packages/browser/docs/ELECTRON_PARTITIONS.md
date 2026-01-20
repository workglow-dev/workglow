# Electron Session Partitions

## Overview

Electron provides **session partitions** to create completely isolated browser contexts with separate cookies, cache, localStorage, IndexedDB, and more. This is crucial for:

- Multi-account support
- Guest/private browsing
- Security isolation (admin vs user)
- Testing different scenarios

## Partition Types

### 1. Default Session (undefined)

```typescript
const context = new ElectronContext({ headless: true }, cookies);
// Uses Electron's default persistent session
```

- **Persistence:** Stored on disk
- **Use case:** Main application session
- **Isolation:** No isolation from other windows using default session

### 2. Persistent Partition (`persist:name`)

```typescript
const context = new ElectronContext(
  { partition: "persist:user-session", headless: true },
  cookies
);
```

- **Persistence:** Stored on disk (survives app restarts)
- **Location:** `userData/Partitions/<name>/`
- **Use case:** User accounts, logged-in sessions
- **Isolation:** Complete isolation from other partitions

### 3. In-Memory Partition (`name`)

```typescript
const context = new ElectronContext(
  { partition: "guest-session", headless: true },
  cookies
);
```

- **Persistence:** Memory only (cleared when app quits)
- **Use case:** Guest mode, temporary browsing, testing
- **Isolation:** Complete isolation from other partitions

## What Gets Isolated?

Different partitions have **completely separate**:

- ✅ Cookies
- ✅ localStorage & sessionStorage
- ✅ IndexedDB
- ✅ Cache
- ✅ Service Workers
- ✅ WebSQL (deprecated but still isolated)
- ✅ Filesystem API
- ✅ Background sync

## Use Cases

### Multi-Account Browsing

```typescript
// Account 1 - persist across restarts
const user1Context = new ElectronContext(
  { partition: "persist:account-1" },
  new CookieStore()
);

// Account 2 - completely isolated
const user2Context = new ElectronContext(
  { partition: "persist:account-2" },
  new CookieStore()
);

// Each can be logged into different accounts on the same site
await user1Context.navigate("https://example.com/login");
// user1 cookies stay separate from user2
```

### Guest Mode

```typescript
// Temporary session - cleared on quit
const guestContext = new ElectronContext(
  { partition: "guest-browsing" }, // No "persist:" prefix
  new CookieStore()
);

// All browsing data cleared when app closes
```

### Security Isolation

```typescript
// Admin panel - highly privileged
const adminContext = new ElectronContext(
  { partition: "persist:admin" },
  adminCookies
);

// Regular user content - lower privilege
const userContext = new ElectronContext(
  { partition: "persist:user" },
  userCookies
);

// Admin cookies can't leak to user context
// User context can't access admin data
```

### Testing Different Scenarios

```typescript
// Test scenario A
const testA = new ElectronContext(
  { partition: "test-scenario-a" },
  new CookieStore()
);

// Test scenario B - completely independent
const testB = new ElectronContext(
  { partition: "test-scenario-b" },
  new CookieStore()
);

// Each can have different cookies, localStorage, etc.
```

## Workflow Integration

Partitions work seamlessly with the Workflow API:

```typescript
const workflow = new Workflow()
  .browser({
    backend: "electron",
    partition: "persist:user-session", // Add partition here
    cookies: savedCookies,
  })
  .navigate({ url: "https://example.com" })
  .click({ locator: { role: "button", name: "Login" } })
  .extract({ locator: { role: "heading" } });

const result = await workflow.run();
```

## Session Management

### Accessing the Session Object

```typescript
// After creating context, you can access the session:
const context = new ElectronContext(
  { partition: "persist:my-session" },
  cookies
);

// The session is available via the window's webContents
// (when context.window is initialized)
```

### Clearing Session Data

To clear data from a specific partition:

```typescript
const { session } = require('electron');

// Clear cache, cookies, storage for a partition
const ses = session.fromPartition('persist:user-session');
await ses.clearStorageData({
  storages: ['cookies', 'localstorage', 'indexdb', 'cache'],
});
```

### Listing Active Sessions

```typescript
const { session } = require('electron');

// Get all sessions
const sessions = session.getAllSessions();
console.log('Active sessions:', sessions.length);
```

## Best Practices

### 1. Use Descriptive Partition Names

```typescript
// Good
"persist:user-john@example.com"
"persist:admin-panel"
"guest-browsing"

// Bad (hard to track)
"persist:session1"
"xyz"
```

### 2. Choose Persistence Appropriately

- **Use `persist:`** for user accounts, settings, long-term sessions
- **Don't use `persist:`** for temporary data, guest mode, testing

### 3. Isolate Sensitive Contexts

```typescript
// Admin panel gets its own partition
{ partition: "persist:admin" }

// Regular user browsing uses different partition
{ partition: "persist:user" }

// This prevents cookie leakage between privilege levels
```

### 4. Clean Up Temporary Partitions

```typescript
// For in-memory partitions, they auto-clear on quit
// For persistent partitions you want to clean:
const { session } = require('electron');
await session.fromPartition('persist:temp').clearStorageData();
```

## Comparison with Playwright

| Feature | Electron Partitions | Playwright Contexts |
|---------|-------------------|---------------------|
| Cookie Isolation | ✅ Via partitions | ✅ Via browser contexts |
| Persistence | ✅ persist:name | ❌ Manual save/restore |
| Storage Isolation | ✅ All storage APIs | ✅ All storage APIs |
| Cross-Window Sharing | ✅ Same partition = shared | ❌ Each context isolated |
| Multi-Account | ✅ Native support | Manual context management |

## Migration Guide

If you're moving from single-session to multi-session:

```typescript
// Before: Single session
const context = new ElectronContext({ headless: true }, cookies);

// After: Multi-session with partitions
const user1 = new ElectronContext(
  { partition: "persist:user-1", headless: true },
  cookies1
);

const user2 = new ElectronContext(
  { partition: "persist:user-2", headless: true },
  cookies2
);
```

## Testing

Run partition tests:

```bash
# Unit tests (verify API)
bun test src/test/ElectronPartition.test.ts

# Integration tests (in Electron app)
npm run test:electron

# Examples
bun examples/electron-partitions.ts
```

## Further Reading

- [Electron Session API](https://www.electronjs.org/docs/latest/api/session)
- [BrowserWindow webPreferences](https://www.electronjs.org/docs/latest/api/browser-window#new-browserwindowoptions)
- [Cookie API](https://www.electronjs.org/docs/latest/api/cookies)
