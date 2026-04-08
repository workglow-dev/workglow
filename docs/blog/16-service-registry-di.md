<!--
@license
Copyright 2025 Steven Roussey <sroussey@gmail.com>
SPDX-License-Identifier: Apache-2.0
-->

# The 112-Line Dependency Injection System That Powers Workglow

Most dependency injection frameworks want to be the center of your universe. They introduce decorators, reflection metadata, circular dependency resolution, module hierarchies, and configuration files that rival your actual application code in complexity. Workglow takes a different path: two small files, 112 lines of implementation code total, and a phantom type trick that gives you full TypeScript safety with zero runtime cost.

This is the story of why a pipeline framework needs DI at all, how Workglow's `Container` and `ServiceRegistry` work, and why we stopped long before building a "real" DI framework.

## Why Does a Pipeline Framework Need Dependency Injection?

Workglow is a DAG-based task pipeline engine. You define tasks, wire them together with dataflows, and run them. Sounds simple enough. But here is the catch: those tasks need _things_.

An AI text generation task needs a model repository to look up which model to use. A vector search task needs a knowledge base instance. A queued task needs a job queue factory. A task that calls an external API needs credentials. And all of these "things" need to be different depending on context:

- **Swappable backends.** Storage can be in-memory, SQLite, PostgreSQL, IndexedDB, or a filesystem folder. You should not have to rewrite your pipeline to switch between them.
- **Test isolation.** When running tests, you want a fresh, independent set of services. You do not want one test's registered models leaking into another test's assertions.
- **Worker isolation.** AI provider tasks execute inside Web Workers or worker threads. Workers have their own JavaScript runtime with a separate global scope. The main thread's credential store, model registry, and service registries simply do not exist over there. Tasks must resolve everything they need on the main thread and pass serialized values through the job input.
- **Runtime flexibility.** Workglow runs in browsers, Node.js, and Bun. The "right" default for a logger, a credential store, or a telemetry provider is different in each environment.

You could solve all of this with module-level singletons and a lot of `if` statements. Or you could use a lightweight service locator pattern and solve it cleanly.

## The Container: Three Maps and Done

The core of the system is `Container`, found in `packages/util/src/di/Container.ts`. It is 106 lines including the license header, whitespace, and JSDoc. Here is its entire internal state:

```typescript
export class Container {
  private services: Map<string, any> = new Map();
  private factories: Map<string, () => any> = new Map();
  private singletons: Set<string> = new Set();
}
```

That is it. Three data structures:

- **`factories`** maps string tokens to factory functions that produce service instances.
- **`services`** caches already-created instances.
- **`singletons`** tracks which tokens should only ever be instantiated once.

When you call `container.register(token, factory, singleton)`, the factory goes into the map. When you call `container.get(token)`, it checks `services` first (already created?), then calls the factory. If the token is marked as a singleton, the result gets cached in `services` so the factory never runs again.

There is also `registerInstance`, which skips the factory entirely and shoves a pre-built object straight into the cache. This is the escape hatch for when you already have the thing and just need to make it available.

### Child Containers: Scoped Overrides Without Mutation

The `createChildContainer()` method copies all registrations and cached singletons into a new `Container`. The child inherits everything from the parent, but modifications to the child do not propagate back up. This is the foundation for test isolation:

```typescript
const child = parentContainer.createChildContainer();
child.registerInstance("model.repository", new TestModelRepository());
// Parent's model repository is untouched
```

The copy is shallow and immediate. This is not a prototype chain or a proxy-based lookup. When you create a child, you get a snapshot. This is a deliberate trade-off: it is simple, predictable, and fast at the cost of not seeing parent registrations that happen _after_ the child was created. In practice this is exactly what you want for test isolation and worker bootstrapping.

## ServiceRegistry: Where the Type Safety Lives

The `Container` operates on raw strings. That is fine for internal plumbing, but exposing `container.get<ModelRepository>("model.repository")` to application code is a recipe for typo-driven debugging sessions. You misspell the string, you get a runtime error. You pass the wrong type parameter, TypeScript shrugs.

`ServiceRegistry` fixes this with a wrapper that speaks in _typed tokens_ instead of strings:

```typescript
export interface ServiceToken<T> {
  readonly _type: T;
  readonly id: string;
}

export function createServiceToken<T>(id: string): ServiceToken<T> {
  return { id, _type: null as any };
}
```

And then `ServiceRegistry` uses these tokens to thread the type parameter through to the container:

```typescript
export class ServiceRegistry {
  public container: Container;

  register<T>(token: ServiceToken<T>, factory: () => T, singleton = true): void {
    this.container.register(token.id, factory, singleton);
  }

  get<T>(token: ServiceToken<T>): T {
    return this.container.get<T>(token.id);
  }

  has<T>(token: ServiceToken<T>): boolean {
    return this.container.has(token.id);
  }
}
```

Now when you write `registry.get(MODEL_REPOSITORY)`, TypeScript _knows_ the return type is `ModelRepository`. No manual annotation. No casting. No chance of mismatch.

## The Phantom Type Trick

Look at the `ServiceToken` interface again:

```typescript
export interface ServiceToken<T> {
  readonly _type: T;
  readonly id: string;
}
```

The `_type` field is never read. It is never set to a meaningful value. When you create a token, it gets `null as any`:

```typescript
export function createServiceToken<T>(id: string): ServiceToken<T> {
  return { id, _type: null as any };
}
```

At runtime, `_type` is always `null`. It exists purely to carry the type parameter `T` through the TypeScript type system. This is a _phantom type_ -- a type-level marker with no runtime representation.

Why go to this trouble? Because TypeScript's type parameters are erased at compile time. If `ServiceToken` were just `{ id: string }`, there would be no way for `registry.get(token)` to infer what `T` is. The phantom `_type: T` field gives TypeScript something to grab onto.

The cost is exactly one `null` property per token. Since tokens are created once at module scope and reused forever, this overhead is essentially zero. But the benefit is enormous: every `register`, `registerInstance`, `get`, and `has` call is fully type-checked without any type annotations at the call site.

Consider what happens if you try to register the wrong type:

```typescript
const MODEL_REPOSITORY = createServiceToken<ModelRepository>("model.repository");

// Type error: () => string is not assignable to () => ModelRepository
registry.register(MODEL_REPOSITORY, () => "not a model repository");
```

TypeScript catches this at compile time. With raw string keys, it would be a silent bug that only manifests at runtime, probably in production, probably on a Friday.

## Global vs. Scoped: Two Registries, One Pattern

Workglow exports a `globalContainer` and a `globalServiceRegistry` built on top of it:

```typescript
export const globalContainer = new Container();
export const globalServiceRegistry = new ServiceRegistry(globalContainer);
```

This is the app-wide registry. When you import `globalServiceRegistry` anywhere in your codebase, you get the same instance. Every package in the monorepo uses it to register its defaults:

```typescript
// In ModelRegistry.ts
if (!globalServiceRegistry.has(MODEL_REPOSITORY)) {
  globalServiceRegistry.register(
    MODEL_REPOSITORY,
    (): ModelRepository => new InMemoryModelRepository(),
    true
  );
}
```

The `if (!globalServiceRegistry.has(...))` guard is a recurring pattern. It means: "register a sensible default, but do not overwrite if the application (or a previous import) already registered something." This lets packages provide defaults that can be overridden by composition rather than configuration.

For isolated contexts, you create a scoped `ServiceRegistry` backed by a child container:

```typescript
const child = globalContainer.createChildContainer();
const scopedRegistry = new ServiceRegistry(child);

// Override just what you need
scopedRegistry.registerInstance(MODEL_REPOSITORY, testModelRepo);

// Everything else falls through from the parent snapshot
```

This pattern appears in the test suite, where each test gets a fresh `ServiceRegistry` backed by a fresh `Container`:

```typescript
let registry: ServiceRegistry;

beforeEach(() => {
  registry = new ServiceRegistry(new Container());
});
```

Clean. Isolated. No global state bleed between tests.

## Service Tokens in Practice

Across the Workglow monorepo, tokens are used for everything that needs to be swappable or discoverable at runtime. Here is a sampling:

| Token | Type | Package | Purpose |
|-------|------|---------|---------|
| `MODEL_REPOSITORY` | `ModelRepository` | `@workglow/ai` | Where to find model configurations |
| `TASK_CONSTRUCTORS` | `Map<string, AnyTaskConstructor>` | `@workglow/task-graph` | Registry of all known task types |
| `KNOWLEDGE_BASES` | `Map<string, KnowledgeBase>` | `@workglow/knowledge-base` | Live knowledge base instances |
| `TABULAR_REPOSITORIES` | `Map<string, AnyTabularStorage>` | `@workglow/storage` | Named tabular storage instances |
| `MCP_SERVERS` | `Map<string, McpServerConnection>` | `@workglow/tasks` | MCP server connections |
| `CREDENTIAL_STORE` | `ICredentialStore` | `@workglow/util` | Secret/API key storage |
| `LOGGER` | `ILogger` | `@workglow/util` | Application logger |
| `TELEMETRY_PROVIDER` | `ITelemetryProvider` | `@workglow/util` | Telemetry/tracing provider |
| `QUEUE_STORAGE` | `IQueueStorage` | `@workglow/storage` | Job queue backend |
| `RATE_LIMITER_STORAGE` | `IRateLimiterStorage` | `@workglow/storage` | Rate limiter backend |
| `JOB_QUEUE_FACTORY` | `JobQueueFactory` | `@workglow/task-graph` | Creates job queues for task types |
| `ENTITLEMENT_ENFORCER` | `IEntitlementEnforcer` | `@workglow/task-graph` | Controls task execution permissions |

Notice the naming convention: tokens are `UPPER_SNAKE_CASE` constants, created at module scope. Their string IDs follow a dotted namespace pattern (`"model.repository"`, `"storage.tabular.repositories"`, `"knowledge-base.registry"`). The type parameter does the heavy lifting; the string is just a human-readable key for debugging.

## `register` vs. `registerInstance`: Lazy vs. Eager

The two registration methods serve different purposes:

**`register(token, factory, singleton)`** is lazy. The factory function is not called until someone first asks for the service. This matters for expensive initializations. The `LOGGER` token, for example, registers a factory that inspects environment variables to decide whether to create a `ConsoleLogger` or a `NullLogger`. That check only happens when `getLogger()` is first called:

```typescript
globalServiceRegistry.register(LOGGER, createDefaultLogger, true);
```

**`registerInstance(token, instance)`** is eager. You already have the object; you are just making it available. This is the pattern used by `set*` convenience functions throughout the codebase:

```typescript
export function setGlobalModelRepository(repository: ModelRepository): void {
  globalServiceRegistry.registerInstance(MODEL_REPOSITORY, repository);
}
```

Both methods mark the registration as a singleton (instances are inherently single-instance; factories default to `singleton = true`). This means calling `get` twice always returns the same object. In a pipeline framework where tasks share model registries and storage backends, this is essential. You do not want two tasks accidentally working with different repository instances.

## The Convenience Wrapper Pattern

Every package follows the same three-function pattern around its tokens:

```typescript
// 1. Define the token
export const SOME_SERVICE = createServiceToken<SomeType>("namespace.service");

// 2. Register a default factory (guarded)
if (!globalServiceRegistry.has(SOME_SERVICE)) {
  globalServiceRegistry.register(SOME_SERVICE, () => new DefaultImpl(), true);
}

// 3. Provide getter/setter convenience functions
export function getGlobalSomeService(): SomeType {
  return globalServiceRegistry.get(SOME_SERVICE);
}

export function setGlobalSomeService(instance: SomeType): void {
  globalServiceRegistry.registerInstance(SOME_SERVICE, instance);
}
```

This pattern recurs in `ModelRegistry.ts`, `LoggerRegistry.ts`, `TelemetryRegistry.ts`, `CredentialStoreRegistry.ts`, `KnowledgeBaseRegistry.ts`, `McpServerRegistry.ts`, and more. The consistency is deliberate: every service in the system is overridable in exactly the same way.

The convenience functions are not strictly necessary -- you could always use `globalServiceRegistry.get(TOKEN)` directly. But they provide discoverability (autocomplete finds `getGlobalModelRepository` easily) and serve as a natural documentation layer for how each service is meant to be accessed.

## Why Not a "Real" DI Framework?

Workglow's DI system is, by most framework standards, aggressively minimal. It does not have:

- **Decorators.** No `@Injectable()`, no `@Inject()`, no metadata reflection. TypeScript decorators (both legacy and the TC39 proposal) add complexity and tooling requirements that are hard to justify for a library that targets browsers, Node, and Bun.
- **Automatic dependency resolution.** If service A depends on service B, you have to make sure B is registered first. There is no topological sort, no dependency graph, no automatic instantiation order.
- **Circular dependency detection.** If you create a cycle (A's factory calls `get(B)`, B's factory calls `get(A)`), you get a stack overflow. The system does not detect or prevent this.
- **Scoped lifetimes.** There is singleton and there is transient (pass `singleton = false`). There is no "per-request" or "per-scope" lifetime. Child containers provide isolation, but there is no lifecycle management.
- **Async resolution.** Factories must be synchronous. If you need async initialization, do it outside the container and use `registerInstance`.

These are not missing features. They are deliberate omissions. Workglow's DI solves exactly one problem: "how do I let different parts of the system find each other without hard-coding implementations?" It does not try to manage object lifecycles, enforce architectural boundaries, or replace module imports.

The entire system fits in your head. A `Container` is three maps. A `ServiceRegistry` adds type-safe tokens on top. A `globalServiceRegistry` is the default instance. Child containers copy the parent for isolation. That is the whole thing.

In a framework where the real complexity lies in DAG execution, reactive streaming, worker orchestration, and cross-platform storage backends, the DI layer is infrastructure that should fade into the background. It should be so simple that you never have to think about it, and so reliable that you never have to debug it.

112 lines. Zero dependencies. Full type safety. Sometimes the best architecture is the one that knows when to stop.

