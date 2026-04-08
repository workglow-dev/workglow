<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Service Registry and Dependency Injection

## Overview

Workglow includes a lightweight dependency injection (DI) container that manages service instances
across the entire monorepo. The system is intentionally minimal — no decorators, no reflection, no
configuration files. It consists of three primitives:

1. **`Container`** — a string-keyed map of factories and cached singletons.
2. **`ServiceToken<T>`** — a phantom-typed wrapper around a string key that carries type
   information at compile time.
3. **`ServiceRegistry`** — a type-safe facade over `Container` that accepts `ServiceToken<T>`
   instead of raw strings.

A single **`globalServiceRegistry`** instance (backed by a **`globalContainer`**) is the default
registry used by every package. Child containers can be created for scoped overrides (e.g., per-run
isolation in the task graph runner).

```
┌─────────────────────────────────────────────────────────┐
│                   ServiceRegistry                       │
│  (type-safe facade: ServiceToken<T> → T)                │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │                   Container                       │  │
│  │                                                   │  │
│  │  factories:  Map<string, () => any>               │  │
│  │  services:   Map<string, any>          (cache)    │  │
│  │  singletons: Set<string>               (flags)    │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

All DI primitives live in `@workglow/util` and are re-exported from the package root:

```typescript
import {
  Container,
  globalContainer,
  ServiceRegistry,
  globalServiceRegistry,
  createServiceToken,
} from "@workglow/util";
```

Source files:

| File | Purpose |
|------|---------|
| `packages/util/src/di/Container.ts` | `Container` class and `globalContainer` singleton |
| `packages/util/src/di/ServiceRegistry.ts` | `ServiceToken<T>`, `createServiceToken()`, `ServiceRegistry` class, `globalServiceRegistry` |
| `packages/util/src/di/InputResolverRegistry.ts` | Format-based input resolver system (uses DI internally) |
| `packages/util/src/di/InputCompactorRegistry.ts` | Reverse resolver (instance-to-ID) system |

---

## Container Class

`Container` is the low-level engine. It stores three private data structures:

| Field | Type | Purpose |
|-------|------|---------|
| `services` | `Map<string, any>` | Cached singleton instances |
| `factories` | `Map<string, () => any>` | Factory functions that create services on demand |
| `singletons` | `Set<string>` | Tokens flagged as singleton (create once, cache forever) |

### Methods

#### `register<T>(token: string, factory: () => T, singleton = true): void`

Registers a factory function under a string key. When `singleton` is `true` (the default), the
factory is invoked at most once; the result is cached in the `services` map for all subsequent
`get()` calls. When `singleton` is `false`, the factory is called on every `get()`.

```typescript
container.register("logger", () => new ConsoleLogger(), true);
```

#### `registerInstance<T>(token: string, instance: T): void`

Stores a pre-constructed instance directly in the `services` map and marks it as a singleton. This
bypasses the factory mechanism entirely. Useful for injecting externally created objects or for
overriding a previously registered factory.

```typescript
container.registerInstance("logger", myCustomLogger);
```

#### `get<T>(token: string): T`

Resolves a service by its string key. The resolution order is:

1. If the `services` map already has a cached instance, return it immediately.
2. Otherwise, look up the factory in the `factories` map.
3. If no factory exists, throw `Error("Service not registered: <token>")`.
4. Invoke the factory. If the token is in the `singletons` set, cache the result in `services`.
5. Return the instance.

```typescript
const logger = container.get<ILogger>("logger");
```

#### `has(token: string): boolean`

Returns `true` if a service is registered (either as a cached instance or as a factory).

#### `remove(token: string): void`

Completely removes a service — deletes the cached instance, factory, and singleton flag. This is
rarely needed in application code but is useful in tests.

#### `createChildContainer(): Container`

Creates a new `Container` that starts with a shallow copy of the parent's factories, singleton
flags, and cached singleton instances. The child is fully independent after creation — mutations
to the child do not affect the parent, and vice versa.

```typescript
const child = globalContainer.createChildContainer();
child.registerInstance("logger", testLogger); // Override in child only
```

See [Child Containers](#child-containers) for details on how and when this is used.

---

## ServiceToken\<T\>

A `ServiceToken<T>` is a simple interface with two fields:

```typescript
interface ServiceToken<T> {
  readonly _type: T;   // Phantom field — never assigned at runtime
  readonly id: string; // The string key used by the underlying Container
}
```

The `_type` field exists solely for the TypeScript compiler. It carries the type `T` through the
type system so that `ServiceRegistry.get()` can return `T` without an explicit type argument. At
runtime, `_type` is always `null`.

### `createServiceToken<T>(id: string): ServiceToken<T>`

Factory function that creates a token. The `id` string should use a dot-separated namespace
convention:

```typescript
const MODEL_REPOSITORY = createServiceToken<ModelRepository>("model.repository");
const TASK_CONSTRUCTORS = createServiceToken<Map<string, AnyTaskConstructor>>("task.constructors");
const LOGGER = createServiceToken<ILogger>("logger");
```

Tokens are typically declared as module-level `export const` values. The convention is
`UPPER_SNAKE_CASE` for the variable name, reflecting that they are effectively constants used as
keys into the DI container.

---

## ServiceRegistry

`ServiceRegistry` is a thin, type-safe wrapper around `Container`. Every method accepts a
`ServiceToken<T>` instead of a raw string, letting TypeScript infer the return type automatically.

```typescript
class ServiceRegistry {
  public container: Container;

  constructor(container: Container = globalContainer);

  register<T>(token: ServiceToken<T>, factory: () => T, singleton?: boolean): void;
  registerInstance<T>(token: ServiceToken<T>, instance: T): void;
  get<T>(token: ServiceToken<T>): T;
  has<T>(token: ServiceToken<T>): boolean;
}
```

The `container` property is public, allowing direct access when you need to call
`createChildContainer()` or `remove()`.

### Type safety in practice

Because `ServiceToken<T>` carries the phantom type, the compiler enforces correctness at every
call site:

```typescript
const MODEL_REPOSITORY = createServiceToken<ModelRepository>("model.repository");

// Registration: factory must return ModelRepository
globalServiceRegistry.register(MODEL_REPOSITORY, () => new InMemoryModelRepository());

// Resolution: result is typed as ModelRepository — no cast needed
const repo = globalServiceRegistry.get(MODEL_REPOSITORY);
repo.findByName("gpt-4"); // Autocomplete works
```

---

## Registration

### Factory registration

The primary registration method supplies a lazy factory function:

```typescript
globalServiceRegistry.register(
  MODEL_REPOSITORY,
  () => new InMemoryModelRepository(),
  true // singleton (default)
);
```

The factory is not invoked at registration time. It runs on the first `get()` call. For singletons,
the result is cached and the factory is never called again.

### Instance registration

When you already have an object in hand, use `registerInstance()`:

```typescript
const repository = new SqliteModelRepository(db);
globalServiceRegistry.registerInstance(MODEL_REPOSITORY, repository);
```

This stores the instance directly, bypassing any previously registered factory. It is the standard
way to override a default registration.

### The idempotent guard pattern

Across the codebase, every package that registers a default uses a guard:

```typescript
if (!globalServiceRegistry.has(MODEL_REPOSITORY)) {
  globalServiceRegistry.register(
    MODEL_REPOSITORY,
    () => new InMemoryModelRepository(),
    true
  );
}
```

This means: "provide a sensible default, but do not overwrite if the application (or a previously
imported module) already registered something." The pattern enables composition-based configuration —
application code can register a concrete implementation before importing the package that provides
the default, and the default registration will be skipped.

### Convenience accessor pattern

Each well-known token typically comes with a pair of `get` / `set` functions:

```typescript
export function getGlobalModelRepository(): ModelRepository {
  return globalServiceRegistry.get(MODEL_REPOSITORY);
}

export function setGlobalModelRepository(repository: ModelRepository): void {
  globalServiceRegistry.registerInstance(MODEL_REPOSITORY, repository);
}
```

These functions are not strictly necessary — you could always call
`globalServiceRegistry.get(MODEL_REPOSITORY)` directly. But they provide discoverability (IDE
autocomplete finds `getGlobalModelRepository` easily) and serve as a natural documentation layer for
how each service is meant to be accessed.

---

## Resolution

### `get<T>(token: ServiceToken<T>): T`

Resolution follows the `Container.get()` semantics described above, with the added benefit of
compile-time type inference from the token.

```typescript
const logger = globalServiceRegistry.get(LOGGER);
// TypeScript infers: logger is ILogger
```

If the token has not been registered, `get()` throws:

```
Error: Service not registered: logger
```

### `has<T>(token: ServiceToken<T>): boolean`

Check before resolving when the service may not be present:

```typescript
if (registry.has(ENTITLEMENT_ENFORCER)) {
  const enforcer = registry.get(ENTITLEMENT_ENFORCER);
  // ...
}
```

### Factory invocation and caching

For singleton services (`singleton = true`, the default), the lifecycle is:

```
register(TOKEN, factory)
    │
    ▼
get(TOKEN) ─── factory not yet called ───► invoke factory()
    │                                          │
    │                                          ▼
    │                                   cache result in services map
    │                                          │
    ▼                                          ▼
get(TOKEN) ─── cached instance found ───► return cached instance
```

For transient services (`singleton = false`):

```
register(TOKEN, factory, false)
    │
    ▼
get(TOKEN) ───► invoke factory() ───► return new instance (no caching)
    │
    ▼
get(TOKEN) ───► invoke factory() ───► return another new instance
```

In practice, nearly every registration in the codebase uses singleton semantics. Transient
factories are rare and reserved for cases where fresh instances are needed each time.

---

## Child Containers

`Container.createChildContainer()` produces a new container initialized with a snapshot of the
parent's state:

- All factory registrations are copied.
- All singleton flags are copied.
- All cached singleton instances are copied (shared by reference).

After creation, the child is fully independent. Registering or overriding a service in the child
does not affect the parent. This property is used for scoped isolation.

### Usage in TaskGraphRunner

The `TaskGraphRunner` creates a child container at the start of each graph execution:

```typescript
// From packages/task-graph/src/task-graph/TaskGraphRunner.ts
protected async handleStart(config?: TaskGraphRunConfig): Promise<void> {
  if (config?.registry !== undefined) {
    this.registry = config.registry;
  } else if (this.registry === undefined) {
    this.registry = new ServiceRegistry(
      globalServiceRegistry.container.createChildContainer()
    );
  }
  // ...
}
```

This means each graph run gets its own service registry that inherits all global defaults but can
override individual services without affecting other concurrent runs. For example, a test harness
can inject a mock model repository into the child without polluting the global registry.

### Override semantics

Because the child starts with a copy, overrides work by shadowing:

```typescript
const child = globalContainer.createChildContainer();
const childRegistry = new ServiceRegistry(child);

// Global still returns InMemoryModelRepository
const globalRepo = globalServiceRegistry.get(MODEL_REPOSITORY);

// Override in child only
childRegistry.registerInstance(MODEL_REPOSITORY, new SqliteModelRepository(db));

// Child now returns SqliteModelRepository
const childRepo = childRegistry.get(MODEL_REPOSITORY);

// Global is unaffected
assert(globalServiceRegistry.get(MODEL_REPOSITORY) === globalRepo);
```

---

## Global Registry

Workglow exports two module-level singletons:

```typescript
// packages/util/src/di/Container.ts
export const globalContainer = new Container();

// packages/util/src/di/ServiceRegistry.ts
export const globalServiceRegistry = new ServiceRegistry(globalContainer);
```

`globalServiceRegistry` is the app-wide default. Every package in the monorepo imports it, registers
its defaults, and resolves dependencies through it. The `TaskRunner`, `TaskGraphRunner`, and
provider implementations all default to `globalServiceRegistry` unless an explicit registry is
passed.

### Worker isolation

Workers (Web Workers, Bun workers, Node worker threads) run in an isolated JavaScript runtime.
When a worker imports `@workglow/util`, it gets its own `globalServiceRegistry` — completely
separate from the main thread's registry. This is by design.

**Do not** attempt to access main-thread services (credential stores, model repositories, etc.)
from worker code. Instead, resolve those values on the main thread (e.g., in `AiTask.getJobInput()`)
and pass the resolved data through the serialized job input.

---

## Well-Known Tokens

The following table lists the most important service tokens defined across the monorepo. Each token
follows the idempotent guard pattern and provides `get`/`set` convenience accessors.

| Token | Type | Default | Package | String ID |
|-------|------|---------|---------|-----------|
| `LOGGER` | `ILogger` | `NullLogger` (or `ConsoleLogger` if `LOGGER_LEVEL` env is set) | `@workglow/util` | `"logger"` |
| `TELEMETRY_PROVIDER` | `ITelemetryProvider` | `NoopTelemetryProvider` (or `ConsoleTelemetryProvider` in dev) | `@workglow/util` | `"telemetry"` |
| `CREDENTIAL_STORE` | `ICredentialStore` | *(none — must be registered by the app)* | `@workglow/util` | `"credential.store"` |
| `MODEL_REPOSITORY` | `ModelRepository` | `InMemoryModelRepository` | `@workglow/ai` | `"model.repository"` |
| `TASK_CONSTRUCTORS` | `Map<string, AnyTaskConstructor>` | Backed by `TaskRegistry.all` | `@workglow/task-graph` | `"task.constructors"` |
| `TASK_OUTPUT_REPOSITORY` | `TaskOutputRepository` | *(none — must be registered)* | `@workglow/task-graph` | `"task.outputRepository"` |
| `JOB_QUEUE_FACTORY` | `JobQueueFactory` | In-memory queue factory | `@workglow/task-graph` | `"taskgraph.jobQueueFactory"` |
| `ENTITLEMENT_ENFORCER` | `IEntitlementEnforcer` | *(none — permissive fallback if absent)* | `@workglow/task-graph` | `"task.entitlementEnforcer"` |
| `TABULAR_REPOSITORIES` | `Map<string, AnyTabularStorage>` | Empty `Map` | `@workglow/storage` | `"storage.tabular.repositories"` |
| `KV_REPOSITORY` | `IKvStorage` | *(none — must be registered)* | `@workglow/storage` | `"storage.kvRepository"` |
| `KNOWLEDGE_BASES` | `Map<string, KnowledgeBase>` | Empty `Map` | `@workglow/knowledge-base` | `"knowledge-base.registry"` |
| `KNOWLEDGE_BASE_REPOSITORY` | `KnowledgeBaseRepository` | `InMemoryKnowledgeBaseRepository` | `@workglow/knowledge-base` | `"knowledge-base.repository"` |
| `MCP_SERVERS` | `Map<string, McpServerConnection>` | Empty `Map` | `@workglow/tasks` | `"mcp-server.registry"` |
| `MCP_SERVER_REPOSITORY` | `McpServerRepository` | `InMemoryMcpServerRepository` | `@workglow/tasks` | `"mcp-server.repository"` |
| `HUMAN_CONNECTOR` | `IHumanConnector` | *(none — must be registered by the app)* | `@workglow/tasks` | `"HUMAN_CONNECTOR"` |
| `INPUT_RESOLVERS` | `Map<string, InputResolverFn>` | Empty `Map` | `@workglow/util` | `"task.input.resolvers"` |
| `INPUT_COMPACTORS` | `Map<string, InputCompactorFn>` | Empty `Map` | `@workglow/util` | `"task.input.compactors"` |

### Storage backend tokens

Each storage backend also declares its own token for direct access. These are less commonly used in
application code (since the abstract tokens like `TABULAR_REPOSITORIES` are preferred) but are
available for backend-specific configuration:

| Token | Package | String ID |
|-------|---------|-----------|
| `MEMORY_TABULAR_REPOSITORY` | `@workglow/storage` | `"storage.tabular.memory"` |
| `SQLITE_TABULAR_REPOSITORY` | `@workglow/storage` | `"storage.tabular.sqlite"` |
| `POSTGRES_TABULAR_REPOSITORY` | `@workglow/storage` | `"storage.tabular.postgres"` |
| `IDB_TABULAR_REPOSITORY` | `@workglow/storage` | `"storage.tabular.indexeddb"` |
| `MEMORY_KV_REPOSITORY` | `@workglow/storage` | `"storage.kvRepository.memory"` |
| `SQLITE_KV_REPOSITORY` | `@workglow/storage` | `"storage.kvRepository.sqlite"` |
| `RATE_LIMITER_STORAGE` | `@workglow/storage` | `"ratelimiter.storage"` |
| `QUEUE_STORAGE` | `@workglow/storage` | `"jobqueue.storage"` |

---

## Input Resolver and Compactor Registries

Two specialized registries sit on top of the DI system to provide runtime resolution of string IDs
to live objects and back. They are themselves managed as services via `INPUT_RESOLVERS` and
`INPUT_COMPACTORS` tokens.

### Input Resolvers

When a task input property has a `format` annotation (e.g., `format: "model:TextEmbedding"` or
`format: "knowledge-base"`), the task runner resolves the string value to a live object at runtime
using the registered resolver for that format prefix.

```typescript
registerInputResolver("model", async (id, format, registry) => {
  const repo = registry.get(MODEL_REPOSITORY);
  const model = await repo.findByName(id);
  if (!model) throw new Error(`Model "${id}" not found`);
  return model;
});
```

### Input Compactors

The reverse operation: converting a resolved instance back to its string ID for serialization.

```typescript
registerInputCompactor("model", (value) => {
  if (typeof value === "object" && value !== null && "model_id" in value) {
    return (value as Record<string, unknown>).model_id as string;
  }
  return undefined;
});
```

Both systems accept a `ServiceRegistry` parameter, enabling resolvers to work with scoped
registries (child containers) rather than only the global one.

---

## API Reference

### `Container`

| Method | Signature | Description |
|--------|-----------|-------------|
| `register` | `register<T>(token: string, factory: () => T, singleton?: boolean): void` | Register a factory. Default `singleton = true`. |
| `registerInstance` | `registerInstance<T>(token: string, instance: T): void` | Store a pre-built instance as a singleton. |
| `get` | `get<T>(token: string): T` | Resolve a service. Throws if not registered. |
| `has` | `has(token: string): boolean` | Check whether a token is registered. |
| `remove` | `remove(token: string): void` | Remove a registration entirely. |
| `createChildContainer` | `createChildContainer(): Container` | Snapshot-copy into a new independent container. |

### `ServiceRegistry`

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `new ServiceRegistry(container?: Container)` | Wrap a container. Defaults to `globalContainer`. |
| `register` | `register<T>(token: ServiceToken<T>, factory: () => T, singleton?: boolean): void` | Type-safe factory registration. |
| `registerInstance` | `registerInstance<T>(token: ServiceToken<T>, instance: T): void` | Type-safe instance registration. |
| `get` | `get<T>(token: ServiceToken<T>): T` | Type-safe resolution. |
| `has` | `has<T>(token: ServiceToken<T>): boolean` | Type-safe existence check. |

| Property | Type | Description |
|----------|------|-------------|
| `container` | `Container` | The underlying container (public, for `createChildContainer()` access). |

### `ServiceToken<T>`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | The string key used by the underlying `Container`. |
| `_type` | `T` | Phantom field for compile-time type inference. Always `null` at runtime. |

### Module-level exports

| Export | Type | Description |
|--------|------|-------------|
| `globalContainer` | `Container` | The application-wide container singleton. |
| `globalServiceRegistry` | `ServiceRegistry` | The application-wide type-safe registry (wraps `globalContainer`). |
| `createServiceToken<T>()` | `(id: string) => ServiceToken<T>` | Factory for creating typed tokens. |

---

## Patterns and Best Practices

### Declaring a new service

Follow the established four-step pattern used throughout the codebase:

```typescript
// 1. Define the token
export const MY_SERVICE = createServiceToken<IMyService>("namespace.myService");

// 2. Register a default (guarded)
if (!globalServiceRegistry.has(MY_SERVICE)) {
  globalServiceRegistry.register(MY_SERVICE, () => new DefaultMyService(), true);
}

// 3. Provide convenience accessors
export function getMyService(): IMyService {
  return globalServiceRegistry.get(MY_SERVICE);
}

export function setMyService(instance: IMyService): void {
  globalServiceRegistry.registerInstance(MY_SERVICE, instance);
}
```

### Testing with overrides

In tests, create a child container to avoid polluting the global state:

```typescript
import { ServiceRegistry, globalServiceRegistry } from "@workglow/util";

const childRegistry = new ServiceRegistry(
  globalServiceRegistry.container.createChildContainer()
);

// Override only for this test
childRegistry.registerInstance(MODEL_REPOSITORY, mockModelRepository);

// Pass the scoped registry to the system under test
const runner = new TaskGraphRunner(graph);
await runner.run({ registry: childRegistry });
```

### Avoid circular resolution

The DI container does not detect circular dependencies. If service A's factory calls `get(B)` and
service B's factory calls `get(A)`, you will get a stack overflow. Keep factory functions simple —
resolve dependencies at call time (`get()`) rather than at registration time.

### String ID conventions

Use dot-separated, lowercase namespace identifiers:

- `"model.repository"` — not `"ModelRepository"` or `"MODEL_REPOSITORY"`
- `"storage.tabular.repositories"` — hierarchical grouping
- `"knowledge-base.registry"` — hyphens are acceptable within a segment
