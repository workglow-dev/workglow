# Testing @workglow/browser

## Test Suite Overview

The package includes comprehensive tests covering all major components and both Playwright and Electron backends.

### Test Results Summary

```
✅ 47 tests passing
   - 39 unit/integration tests (bun test)
   - 8 Electron tests (running in Electron app)
⏭️  4 tests skipped (network timeouts only)
❌ 0 tests failing

Total: 51 tests across 7 test files + Electron test app
```

## Test Files

### 1. A11yTree.test.ts (12 tests)
**Status:** ✅ All passing

Tests the accessibility tree find/query functionality:
- Finding elements by role
- Finding by name (partial and exact match)
- Finding by state
- findAll with multiple results
- Visibility filtering
- Tree toString representation

### 2. CookieStore.test.ts (14 tests)
**Status:** ✅ All passing

Tests cookie management:
- Get/set operations
- Domain matching (including subdomains)
- Expiration handling
- Deletion
- JSON serialization/deserialization
- Cloning

### 3. WorkflowIntegration.test.ts (3 tests)
**Status:** ✅ All passing

Tests the chainable Workflow API:
- Browser initialization via `.browser()`
- Chaining tasks (navigate → extract)
- Cookie persistence across workflow

### 4. PlaywrightDebug.test.ts (1 test)
**Status:** ✅ Passing

Debug test that navigates to example.com and prints the accessibility tree structure.

### 5. PlaywrightIntegration.test.ts (8 tests)
**Status:** ✅ 4 passing, ⏭️ 4 skipped

Integration tests with real Playwright navigation:
- ✅ Navigate to example.com and extract title
- ✅ Extract multiple elements from page
- ✅ Take screenshots
- ✅ Execute JavaScript in page context
- ⏭️ Handle cookies (skipped - network timeout)
- ⏭️ Wait for elements (skipped - network timeout)
- ⏭️ Find multiple elements (skipped - network timeout)
- ⏭️ Click link and navigate (skipped - network timeout)

### 6. ElectronContext.test.ts (5 tests)
**Status:** ✅ All passing

Unit tests for ElectronContext:
- Constructor and initialization
- Interface method presence
- Config and cookie storage
- IBrowserContext compliance
- API parity with PlaywrightContext

### 7. ElectronIntegration.test.ts (8 tests via dedicated Electron app)
**Status:** ✅ 8/8 passing (runs in `test-electron/`)

Electron integration tests (run via `npm run test:electron`):
- ✅ Import and initialize ElectronContext
- ✅ Navigate to example.com with hidden window
- ✅ Extract accessibility tree from live page
- ✅ Execute JavaScript in page context
- ✅ Capture screenshot (16KB PNG verified)
- ✅ Cookie injection and retrieval
- ✅ Click elements using bounding box
- ✅ Navigation history (back/forward/reload)

**Note:** ElectronContext.test.ts provides unit tests that verify the API without needing an Electron app. The integration tests in `test-electron/` actually run inside Electron with xvfb.

## Running Tests

### All Tests

```bash
bun test
```

### Specific Test Files

```bash
# Unit tests (no external dependencies)
bun test src/test/A11yTree.test.ts
bun test src/test/CookieStore.test.ts
bun test src/test/ElectronContext.test.ts

# Integration tests (require Playwright)
bun test src/test/PlaywrightIntegration.test.ts
bun test src/test/WorkflowIntegration.test.ts

# Debug tests
bun test src/test/PlaywrightDebug.test.ts
```

### Running Electron Integration Tests

Electron requires a display server even for headless mode.

**On Linux (use xvfb):**

```bash
# Install xvfb
sudo apt-get install xvfb

# Run with virtual display
xvfb-run -a bun test src/test/ElectronIntegration.test.ts
```

**On macOS/Windows:**

Electron can create hidden windows natively:

```bash
bun test src/test/ElectronIntegration.test.ts
```

## Test Coverage

### What's Tested

✅ **Accessibility Tree Parsing**
- DOM traversal and element filtering
- ARIA attribute extraction
- Role computation (explicit and implicit)
- Accessible name calculation
- State extraction (checked, disabled, etc.)

✅ **Cookie Management**
- Storage and retrieval
- Domain/path scoping
- Subdomain matching
- Expiration handling
- Serialization

✅ **Playwright Backend**
- Real browser navigation (example.com)
- Accessibility tree extraction
- Screenshots
- JavaScript execution
- Cookie injection

✅ **Electron Backend**
- Constructor and initialization
- Method presence verification
- API parity with Playwright

✅ **Workflow Integration**
- Chainable API
- Task composition
- Context passing between tasks

### What's Not Tested (Skipped)

⏭️ **Network-Dependent Tests**
- Some tests skip due to network timeouts in container environments
- Would pass with stable network connection

⏭️ **Electron Integration Tests**
- Require xvfb display server on Linux
- Work natively on macOS/Windows with GUI

## Continuous Integration

For CI environments, install Playwright browsers:

```bash
npx playwright install chromium
npx playwright install-deps chromium
```

For Electron tests in CI:

```bash
# Linux CI
sudo apt-get install xvfb
xvfb-run -a bun test
```

## Manual Testing

Run the examples to manually test functionality:

```bash
# Playwright example
bun run examples/simple-login.ts

# Full example with all features
bun run examples/full-example.ts

# Electron example (Linux: use xvfb-run)
bun run examples/electron-example.ts
# or: xvfb-run -a bun run examples/electron-example.ts
```
