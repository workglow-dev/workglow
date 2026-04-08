<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Credential Management in Workglow: Keeping Secrets Secret Across Eight Providers and Three Runtimes

When you are building AI pipelines, you inevitably accumulate secrets. An Anthropic key here, an OpenAI key there, a Hugging Face token for inference, a Google Gemini key for embeddings. Before long you are juggling half a dozen environment variables, hard-coding keys into config objects, and hoping nobody accidentally logs `provider_config` to the console. Workglow is designed to orchestrate tasks across all of these providers -- and across browsers, servers, and background workers -- so credential management is not an afterthought. It is load-bearing infrastructure.

This post walks through the credential architecture in Workglow: why it exists, how it works, and how it keeps your secrets out of places they should never be.

---

## The Credential Problem

Consider a Workglow pipeline that classifies text with Claude, generates embeddings with OpenAI, and stores them in a knowledge base for later retrieval via Gemini. That is three providers, three API keys, and three opportunities to leak a secret. Now consider that:

- The pipeline might run on a Node.js server, in a Bun process, or in a browser tab.
- AI tasks are executed inside **worker threads** that have their own isolated global scope -- a separate `globalServiceRegistry`, no access to main-thread state, no shared memory with your credential store.
- A visual pipeline builder in the browser needs to scan a task graph *before execution* to determine whether credentials are required, so it can prompt the user to unlock an encrypted vault.

Environment variables alone do not solve this. They are not available in browsers. They are not scoped to providers. And they offer no encryption at rest. Hardcoding `api_key` strings into model configurations works for a quick prototype but becomes a liability the moment your pipeline definition is serialized, logged, or shared.

Workglow needs a system that is:

1. **Layered** -- resolve credentials from the best available source, falling back gracefully.
2. **Encrypted at rest** -- secrets should never sit in plaintext in persistent storage.
3. **Worker-safe** -- workers must never have ambient access to the credential store.
4. **Platform-agnostic** -- one interface, whether you are in a browser, on a server, or in a desktop app.

---

## The Resolution Strategy: Three Tiers of Fallback

Every provider client in Workglow follows the same resolution pattern. Here is the Anthropic client (and OpenAI, Gemini, and Hugging Face Inference are structurally identical):

```typescript
const apiKey =
  config?.credential_key ||    // 1. Resolved from credential store
  config?.api_key ||           // 2. Embedded directly in config
  process.env?.ANTHROPIC_API_KEY;  // 3. Environment variable
```

This three-tier fallback is deliberate and ordered by security posture:

**Tier 1: `credential_key`** -- A *reference* to a secret, not the secret itself. The key `"anthropic-prod"` is looked up in the active `ICredentialStore` before the model configuration reaches the worker. By the time the worker's `getClient` function sees `credential_key`, the input resolver has already replaced the reference with the actual API key. The pipeline definition never contains the raw secret -- only a pointer.

**Tier 2: `api_key`** -- The secret embedded directly in `provider_config`. Convenient for local development, scripts, and throwaway experiments. Less safe for anything that gets persisted or transmitted, because the secret travels with the configuration.

**Tier 3: Environment variable** -- The classic fallback. If neither `credential_key` nor `api_key` is set, the client checks `process.env`. This keeps zero-config setups working -- set `ANTHROPIC_API_KEY` in your shell, and every Anthropic task in the pipeline picks it up automatically.

This ordering means you can adopt credential management gradually. Start with environment variables. Move to `api_key` when you need per-model keys. Graduate to `credential_key` when you want encrypted storage and scoped references.

---

## Credential Stores: The Abstraction

At the heart of the system is `ICredentialStore`, a clean async interface:

```typescript
interface ICredentialStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string, options?: CredentialPutOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  keys(): Promise<readonly string[]>;
  deleteAll(): Promise<void>;
}
```

Notably, `keys()` returns key *names* only -- never values. The interface contract explicitly states: "Implementations MUST NOT log or expose credential values in error messages." This is not just documentation; it is a design principle that every implementation respects.

Workglow ships four implementations, each suited to different deployment contexts:

### InMemoryCredentialStore

A `Map`-backed store for development and testing. Credentials vanish when the process exits. It supports optional expiration metadata -- expired entries are lazily evicted on access. Fast, simple, disposable.

### EnvCredentialStore

Bridges the gap between environment variables and the credential store interface. You provide a mapping from logical credential names to environment variable names:

```typescript
const store = new EnvCredentialStore({
  "anthropic-api-key": "ANTHROPIC_API_KEY",
  "openai-api-key": "OPENAI_API_KEY",
});
const key = await store.get("anthropic-api-key"); // reads process.env.ANTHROPIC_API_KEY
```

An optional prefix convention handles the common case where your env vars follow a naming pattern. This store is effectively read-only for pre-existing env vars, though `put()` can set them for the current process lifetime.

### EncryptedKvCredentialStore

The production-grade option. It encrypts every credential value with AES-256-GCM before persisting it to *any* `IKvStorage` backend -- SQLite, PostgreSQL, IndexedDB, even an in-memory store. It uses the Web Crypto API (available in Node 20+, Bun, and all modern browsers), so there is no native dependency.

```typescript
const kv = new SqliteKvStorage(":memory:");
const store = new EncryptedKvCredentialStore(kv, "my-passphrase");

await store.put("openai-api-key", "sk-...", { provider: "openai" });
const key = await store.get("openai-api-key"); // decrypted on read
```

Each credential entry carries metadata -- label, provider association, creation and update timestamps, and optional expiration. The encrypted payload, IV, and metadata are serialized as a single JSON object in the KV store. Decryption keys are derived from the passphrase via PBKDF2 and cached per-instance to avoid redundant key derivation.

### ChainedCredentialStore

The composition layer. It chains multiple stores together, trying each in order until a value is found. Writes always go to the first (primary) store:

```typescript
const store = new ChainedCredentialStore([
  new InMemoryCredentialStore(),       // runtime overrides
  encryptedStore,                      // persistent encrypted vault
  new EnvCredentialStore({ ... }),     // environment fallback
]);
```

This is how real applications wire things up: runtime overrides take precedence, then the encrypted vault, then environment variables as a last resort. The chain is the credential equivalent of CSS specificity -- the most specific source wins.

---

## The Passphrase Problem: OtpPassphraseCache

If credentials are encrypted at rest, something needs to hold the passphrase in memory long enough to decrypt them. But holding a plaintext passphrase in a JavaScript string is uncomfortable -- strings are immutable and not zeroed by the garbage collector.

Workglow's `OtpPassphraseCache` addresses this with a one-time pad approach. When you store a passphrase, it:

1. Encodes the passphrase to a `Uint8Array`.
2. Generates a random pad of equal length via `crypto.getRandomValues`.
3. XOR-masks the passphrase with the pad.
4. Zeroes the original bytes.
5. Stores only the masked value and the pad -- never the plaintext.

Retrieval reverses the XOR. The cache supports both a hard TTL (default: 6 hours) and an idle TTL that resets on each access. When either timer fires, both buffers are zeroed and an `onExpiry` callback fires -- typically used to lock the `LazyEncryptedCredentialStore`.

This is not perfect security against a determined attacker with memory access (the JavaScript string still exists transiently during store/retrieve), but it dramatically shrinks the window of exposure compared to holding the passphrase in a plain variable for the lifetime of the process.

---

## LazyEncryptedCredentialStore: The Vault Door

Desktop and browser applications often need a "locked/unlocked" credential model -- think of a password manager that requires a master password before revealing any secrets.

`LazyEncryptedCredentialStore` wraps an `EncryptedKvCredentialStore` behind a lock:

```typescript
const lazy = new LazyEncryptedCredentialStore(kvStorage);
await lazy.get("key");          // undefined (locked)

lazy.unlock("my-passphrase");
await lazy.get("key");          // decrypted value

lazy.lock();                    // discards inner store and derived keys
await lazy.get("key");          // undefined again
```

When locked, `get()` returns `undefined` and `has()` returns `false` -- it silently falls through, which makes it safe to use inside a `ChainedCredentialStore`. The chain simply skips the locked store and tries the next one. When unlocked, all operations delegate to the inner encrypted store.

This design plays directly into the graph scanner, which we will get to next.

---

## Worker Isolation: The Security Boundary

Here is the most important architectural decision in the entire credential system: **workers do not have access to the credential store.**

Workglow executes AI tasks inside worker threads (Web Workers in the browser, worker_threads in Node/Bun). Each worker gets its own isolated `globalServiceRegistry`. The main thread's credential store is *not* registered in the worker's registry. The worker cannot call `getGlobalCredentialStore()` and get your secrets -- it gets the default empty `InMemoryCredentialStore` that was never populated.

So how does the worker get the API key it needs to call Claude or OpenAI? The answer is the **input resolution pipeline**:

1. On the main thread, the `TaskRunner` calls `resolveSchemaInputs()` before dispatching work.
2. The input resolver sees `credential_key` annotated with `format: "credential"` in the model schema.
3. It calls the registered `"credential"` input resolver, which looks up the key in the main-thread credential store and replaces the reference with the actual API key value.
4. The resolved `provider_config` (now containing the real key in `credential_key`) is serialized and sent to the worker as part of the job input.
5. The worker's `getClient()` function reads `config.credential_key` and uses it directly -- it is already the resolved value, not a store reference.

This means:

- **The credential store is never serialized or shared with workers.** Workers cannot enumerate keys, cannot read unrelated secrets, cannot corrupt the store.
- **Each worker invocation receives only the specific credential it needs** for that specific task execution. A worker running an OpenAI embedding task never sees your Anthropic key.
- **If a worker is compromised, the blast radius is limited** to the single credential that was passed to it for that job.

The `dangerouslyAllowBrowser` flag you see in the Anthropic and OpenAI client constructors is a separate concern -- it permits SDK usage inside browser/worker contexts where CORS rules apply. It has nothing to do with credential access.

---

## Graph Scanning: Know Before You Run

Workglow's `GraphFormatScanner` can inspect a task graph *before execution* to determine whether any task requires credentials:

```typescript
const result = scanGraphForCredentials(graph);
if (result.needsCredentials) {
  await ensureCredentialStoreUnlocked();
}
```

The scanner walks every task's `inputSchema()` and `configSchema()`, recursing into nested objects, looking for any property with `format: "credential"`. This is what powers the "unlock your vault" prompt in a visual builder: the application knows it needs credentials before the first task runs, not halfway through a pipeline when it is too late to ask.

---

## credential_key vs api_key: When to Use Which

| | `credential_key` | `api_key` |
|---|---|---|
| **What it stores** | A reference (e.g., `"anthropic-prod"`) | The raw secret (e.g., `"sk-ant-..."`) |
| **Security** | Secret stays in the credential store until resolution | Secret embedded in model config |
| **Serialization safety** | Safe -- only the key name is serialized | Unsafe -- the secret travels with the config |
| **Worker exposure** | Resolved on main thread, passed per-call | Passed directly, same exposure |
| **Rotation** | Update the store; all tasks pick up the new value | Update every config object that embeds the key |
| **Best for** | Production, shared pipelines, persisted graphs | Local dev, scripts, quick prototyping |

The recommendation is clear: use `credential_key` for anything beyond throwaway experiments. It costs almost nothing (one string lookup) and gives you rotation, scoping, and serialization safety.

---

## Platform Differences

Workglow's credential system works across its three target runtimes, but the deployment details differ:

**Server (Node.js / Bun):** All stores are available. `EnvCredentialStore` reads from `process.env`. `EncryptedKvCredentialStore` can use SQLite or PostgreSQL backends. The passphrase might come from an environment variable at startup, a secrets manager, or operator input.

**Browser:** No `process.env`. The `EnvCredentialStore` gracefully returns `undefined` for every key (the `typeof process !== "undefined"` guard handles this). The encrypted store uses IndexedDB as its KV backend, with credentials encrypted via the Web Crypto API. The `LazyEncryptedCredentialStore` pattern is natural here -- the user enters a master password in the UI, the store unlocks, and the passphrase cache auto-locks after idle timeout.

**Desktop (Electron/Tauri):** Combines both worlds. The main process has access to `process.env` and filesystem-backed SQLite. The renderer process uses the browser credential path. IPC bridges can expose a locked/unlocked credential store from the main process to the renderer.

The `ICredentialStore` interface abstracts all of this away. Task code and provider clients never know which backend they are talking to.

---

## Gradual Migration: From Env Vars to Managed Secrets

If you are starting a new Workglow project today, here is the recommended progression:

**Phase 1: Environment variables.** Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. in your shell or `.env` file. Everything works out of the box. No credential store configuration needed.

**Phase 2: Named credentials.** When you need per-model keys (separate keys for dev vs prod, or different keys for different OpenAI organizations), switch to `credential_key` references and set up an `EnvCredentialStore` with explicit mappings. Your pipeline definitions now contain key *names*, not key *values*.

**Phase 3: Encrypted storage.** When you need credentials to persist across restarts, or you are building a user-facing application, wire up an `EncryptedKvCredentialStore` backed by SQLite or IndexedDB. Wrap it in a `LazyEncryptedCredentialStore` if you want lock/unlock semantics.

**Phase 4: Chained resolution.** Compose everything with `ChainedCredentialStore`: runtime overrides, encrypted vault, environment fallback. Use `OtpPassphraseCache` to manage the vault passphrase with automatic expiry. Use `scanGraphForCredentials` to prompt users before pipeline execution.

Each phase is additive. You never have to rip out the previous approach -- the chain just adds a higher-priority layer on top.

---

## Closing Thoughts

Credential management in an AI pipeline framework is a problem that looks simple until you consider the full matrix: multiple providers, multiple runtimes, worker isolation, serialization safety, encryption at rest, and the UX of "when do I ask the user for a password?"

Workglow's approach is not revolutionary. It borrows liberally from established patterns: chained resolution (like AWS SDK credential chains), encrypted-at-rest KV stores (like password managers), OTP masking (like memory-safe secret handling in systems languages), and per-call credential passing (like capability-based security). What it does well is compose these patterns into a cohesive system that works consistently across browsers, servers, and workers -- and that gets out of your way until you need it.

The best credential system is one you adopt incrementally, that defaults to secure behavior, and that makes the unsafe path slightly less convenient than the safe one. That is what Workglow aims for.
