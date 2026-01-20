# Playwright Persistent Sessions

## Overview

Playwright provides session isolation and persistence similar to Electron partitions, but with different terminology and approaches:

| Feature | Electron | Playwright |
|---------|----------|------------|
| **Isolation** | Partitions | BrowserContexts |
| **Persistence** | `persist:name` | `userDataDir` |
| **In-Memory** | `name` (no prefix) | Default behavior |
| **State Export** | Automatic | Manual via `storageState()` |

## Playwright Approaches

### 1. Regular Context (Default - Isolated, Non-Persistent)

```typescript
const context = await createPlaywrightContext(
  { headless: true },
  cookies
);

// Each context is completely isolated
// State is NOT saved to disk
// Perfect for: test isolation, parallel runs
```

**Equivalent to:** Electron in-memory partition  
**Isolation:** ✅ Complete  
**Persistence:** ❌ No (cleared when browser closes)

### 2. Storage State (Manual Save/Load)

```typescript
// Save session after login
const context1 = await createPlaywrightContext({ headless: true }, cookies);
await context1.navigate("https://example.com/login");
// ... perform login ...

// Save storage state to file
const storageState = await context1.context.storageState({
  path: "auth.json"
});

// Later: Load storage state into new context
const context2 = await createPlaywrightContext(
  { storageState: "auth.json" },
  cookies
);
// context2 starts with saved cookies & localStorage
```

**Equivalent to:** Electron session with manual cookie export/import  
**Isolation:** ✅ Each context isolated  
**Persistence:** ✅ Manual (you control save/load)

### 3. Persistent Context (Auto-Save to Disk) ⭐ NEW

```typescript
const context = await createPlaywrightContext(
  {
    userDataDir: "./user-data/profile-1",  // Like Electron persist:
    headless: true,
  },
  cookies
);

// ALL browser data automatically saved to disk:
// - Cookies
// - localStorage
// - IndexedDB  
// - Cache
// - Service workers
```

**Equivalent to:** Electron `persist:name` partition  
**Isolation:** ✅ Different userDataDir = isolated  
**Persistence:** ✅ Automatic

## Comparison Table

| Feature | Electron Partition | Playwright userDataDir | Playwright storageState |
|---------|-------------------|------------------------|-------------------------|
| **Auto-Save** | ✅ Yes | ✅ Yes | ❌ Manual |
| **Survives Restart** | ✅ persist: only | ✅ Yes | ✅ If saved |
| **Isolation** | ✅ Per partition | ✅ Per directory | ✅ Per context |
| **Multi-Profile** | ✅ persist:user1, persist:user2 | ✅ ./user1, ./user2 | ✅ state1.json, state2.json |
| **IndexedDB** | ✅ Included | ✅ Included | ⚠️ Optional |
| **Cache** | ✅ Included | ✅ Included | ❌ Not included |
| **Setup** | Simple string | Directory path | JSON file/object |

## Use Cases

### Multi-Account with Playwright

**Option A: Persistent Context (Recommended)**

```typescript
// User 1 - auto-persists
const user1 = await createPlaywrightContext(
  { userDataDir: "./user-data/account-1" },
  new CookieStore()
);

// User 2 - completely isolated
const user2 = await createPlaywrightContext(
  { userDataDir: "./user-data/account-2" },
  new CookieStore()
);
```

**Option B: Storage State**

```typescript
// Login and save state
const context1 = await createPlaywrightContext({}, cookies1);
// ... login ...
await context1.context.storageState({ path: "user1-auth.json" });

// Later: Load state
const context2 = await createPlaywrightContext(
  { storageState: "user1-auth.json" },
  cookies2
);
```

### Guest Mode

**Playwright (default):**
```typescript
// Already isolated and non-persistent by default!
const guest = await createPlaywrightContext({ headless: true }, new CookieStore());
// State cleared when context closes
```

**Electron equivalent:**
```typescript
{ partition: "guest-session" }
```

### Long-Lived Sessions

**Playwright with userDataDir:**
```typescript
.browser({
  backend: "playwright",
  userDataDir: "./browser-data/main-profile",
})
```

**Electron equivalent:**
```typescript
.browser({
  backend: "electron",
  partition: "persist:main-profile",
})
```

## Key Differences

### 1. Default Behavior

- **Electron:** Default session is persistent
- **Playwright:** Default context is isolated & non-persistent

### 2. Isolation

- **Electron:** Must explicitly use different partitions for isolation
- **Playwright:** Each `newContext()` is automatically isolated

### 3. Persistence

- **Electron:** Built into partition string (`persist:name`)
- **Playwright:** Opt-in via `userDataDir` or manual `storageState`

### 4. Cross-Window Sharing

- **Electron:** Same partition = shared state across windows
- **Playwright:** Each context is isolated (no cross-context sharing)

## Implementation in @workglow/browser

I've now integrated all three Playwright approaches:

```typescript
// 1. Regular isolated context (default)
.browser({ backend: "playwright" })

// 2. Load from storage state
.browser({ 
  backend: "playwright",
  storageState: "saved-session.json"
})

// 3. Persistent context (auto-save) ⭐ NEW
.browser({
  backend: "playwright",
  userDataDir: "./user-data/profile-1"
})
```

## Choosing the Right Approach

### Use Electron Partitions When:
- Building an Electron app
- Need simple string-based naming
- Want built-in partition management
- Need cross-window session sharing

### Use Playwright userDataDir When:
- Need persistent sessions in Node.js/standalone
- Want automatic save/load of all browser data
- Building multi-profile browser automation

### Use Playwright storageState When:
- Need fine-grained control over what's saved
- Want to inspect/modify session data
- Building authentication helpers
- Need portable session files

### Use Default Playwright Context When:
- Running tests (need isolation)
- Parallel execution
- Don't need persistence

## Migration Examples

### From Electron to Playwright

```typescript
// Electron
{ partition: "persist:user-1" }

// Playwright equivalent
{ userDataDir: "./user-data/user-1" }
```

### From Manual Cookie Management

```typescript
// Before: Manual cookie save/restore
const cookies = CookieStore.fromJSON(loadFromFile());
.browser({ cookies })

// After: Playwright auto-persistence
.browser({ userDataDir: "./profile-1" })
// No manual cookie management needed!
```

## Example: Multi-Account Browser

```typescript
class MultiAccountBrowser {
  async createAccount(userId: string, backend: "playwright" | "electron") {
    if (backend === "playwright") {
      return await createPlaywrightContext(
        { userDataDir: `./profiles/${userId}` },
        new CookieStore()
      );
    } else {
      return new ElectronContext(
        { partition: `persist:${userId}` },
        new CookieStore()
      );
    }
  }
}
```

Both approaches provide complete isolation and persistence!
