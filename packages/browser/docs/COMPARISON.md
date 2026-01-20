# Playwright vs Electron: Session Isolation Comparison

## Quick Answer

**Yes!** Playwright has equivalents to Electron partitions:

| Electron | Playwright Equivalent |
|----------|----------------------|
| `partition: "name"` (in-memory) | Default `BrowserContext` |
| `partition: "persist:name"` | `userDataDir: "./path"` |
| Manual cookie export | `storageState: "file.json"` |

## Detailed Comparison

### Session Isolation

Both backends provide complete isolation of:
- ✅ Cookies
- ✅ localStorage & sessionStorage
- ✅ IndexedDB
- ✅ Cache
- ✅ Service Workers

### Non-Persistent Sessions

**Electron:**
```typescript
.browser({
  backend: "electron",
  partition: "temp-session",  // No persist: prefix
})
```

**Playwright:**
```typescript
.browser({
  backend: "playwright",
  // Default is non-persistent
})
```

### Persistent Sessions

**Electron:**
```typescript
.browser({
  backend: "electron",
  partition: "persist:user-profile",  // Auto-saves to disk
})
```

**Playwright:**
```typescript
.browser({
  backend: "playwright",
  userDataDir: "./user-data/user-profile",  // Auto-saves to disk
})
```

Both automatically persist:
- Cookies
- localStorage
- IndexedDB
- Cache
- All browser data

### Manual State Management

**Electron:**
```typescript
// Export cookies
const cookies = new CookieStore();
fs.writeFileSync("cookies.json", JSON.stringify(cookies.toJSON()));

// Import cookies
const restored = CookieStore.fromJSON(JSON.parse(...));
.browser({ cookies: restored })
```

**Playwright:**
```typescript
// Export state
const state = await context.context.storageState({ path: "auth.json" });

// Import state
.browser({
  storageState: "auth.json",  // Loads cookies + localStorage
})
```

## Key Differences

### 1. Default Behavior

| Aspect | Electron | Playwright |
|--------|----------|------------|
| Default session | Persistent | Non-persistent |
| Isolation | Manual (via partitions) | Automatic (each context) |
| Persistence | Built-in (`persist:`) | Opt-in (`userDataDir`) |

### 2. Cross-Window Sharing

**Electron:**
- Same partition = shared state across windows
- Different partitions = isolated

**Playwright:**
- Each context always isolated
- No built-in cross-context sharing

### 3. Storage Location

**Electron:**
```
userData/Partitions/
  ├── persist:user-1/
  ├── persist:user-2/
  └── persist:admin/
```

**Playwright:**
```
./user-data/
  ├── profile-1/
  ├── profile-2/
  └── admin/
```

### 4. Syntax

**Electron:** Simple string
```typescript
partition: "persist:my-session"
```

**Playwright:** Directory path
```typescript
userDataDir: "./browser-data/my-session"
```

## Usage in @workglow/browser

### Multi-Account Example

Both backends now support equivalent functionality:

**Electron:**
```typescript
// Account 1
const workflow1 = new Workflow().browser({
  backend: "electron",
  partition: "persist:user1@example.com",
});

// Account 2
const workflow2 = new Workflow().browser({
  backend: "electron",
  partition: "persist:user2@example.com",
});
```

**Playwright:**
```typescript
// Account 1
const workflow1 = new Workflow().browser({
  backend: "playwright",
  userDataDir: "./profiles/user1@example.com",
});

// Account 2
const workflow2 = new Workflow().browser({
  backend: "playwright",
  userDataDir: "./profiles/user2@example.com",
});
```

### Guest Mode

**Electron:**
```typescript
.browser({ partition: "guest" })  // In-memory, cleared on quit
```

**Playwright:**
```typescript
.browser({})  // Default is non-persistent
```

### Admin/User Separation

**Electron:**
```typescript
.browser({ partition: "persist:admin" })
.browser({ partition: "persist:user" })
```

**Playwright:**
```typescript
.browser({ userDataDir: "./sessions/admin" })
.browser({ userDataDir: "./sessions/user" })
```

## When to Use What

### Use Electron Partitions When:
- Building an Electron desktop app
- Need simple string-based session naming
- Want cross-window state sharing (same partition)
- Prefer built-in partition management

### Use Playwright userDataDir When:
- Building Node.js automation/scraping
- Need persistent sessions outside Electron
- Want automatic save/load of all data
- Running headless servers

### Use Playwright storageState When:
- Need portable session files
- Want to inspect/modify saved state
- Building authentication test fixtures
- Need fine-grained control over what's saved

### Use Default (No Persistence) When:
- Running tests (need fresh state)
- Parallel execution
- Don't need data to survive

## Configuration Examples

### Electron - All Modes

```typescript
// 1. Default (persistent)
{ backend: "electron" }

// 2. In-memory
{ backend: "electron", partition: "temp" }

// 3. Persistent named
{ backend: "electron", partition: "persist:user1" }
```

### Playwright - All Modes

```typescript
// 1. Default (non-persistent, isolated)
{ backend: "playwright" }

// 2. Load from storage state
{ backend: "playwright", storageState: "auth.json" }

// 3. Persistent with userDataDir
{ backend: "playwright", userDataDir: "./profile-1" }

// 4. Combine both
{ 
  backend: "playwright",
  userDataDir: "./profile-1",
  storageState: "initial-auth.json"  // Load initial state
}
```

## Testing

Run tests for both backends' persistence:

```bash
# Playwright persistence tests
bun test src/test/PlaywrightPersistent.test.ts

# Electron partition tests  
bun test src/test/ElectronPartition.test.ts

# Both together
npm test
```

## Summary

Both backends now provide equivalent session isolation capabilities:

| Capability | Electron | Playwright | Supported |
|------------|----------|------------|-----------|
| Isolated sessions | ✅ Partitions | ✅ Contexts | ✅ |
| Persistent storage | ✅ persist: | ✅ userDataDir | ✅ |
| In-memory sessions | ✅ No prefix | ✅ Default | ✅ |
| Multi-account | ✅ Multiple partitions | ✅ Multiple userDataDir | ✅ |
| Manual save/load | ⚠️ Via CookieStore | ✅ storageState | ✅ |
| Auto-persistence | ✅ Built-in | ✅ Built-in | ✅ |

**Choose the backend based on your runtime environment, not features—both are fully capable!**
