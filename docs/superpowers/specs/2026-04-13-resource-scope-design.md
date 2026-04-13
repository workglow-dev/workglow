# Resource Scope: Lifecycle Management for Heavyweight Resources

## Problem

Workflow graph runs acquire heavyweight resources (Playwright browser instances, HuggingFace
Transformers pipelines, llama.cpp model bindings, MediaPipe models) that are never released
automatically. These resources persist in memory indefinitely unless explicitly unloaded by a
dedicated task like `UnloadModelTask` or a manual `disconnect()` call.

There is no unified mechanism for:

- Tracking which resources a graph run acquired
- Giving the caller control over when to release them
- Deduplicating cleanup when multiple tasks share the same resource

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Resource scope | Heavyweight only (browsers, ML pipelines) | Lighter resources are GC'd or managed with try/finally |
| Cleanup trigger | Caller-controlled, not automatic | Graph collects disposers; caller decides when to invoke them |
| Scope object | Standalone, passed via run config | Caller creates scope, can share across multiple graph runs |
| Sub-graph behavior | Inherit parent scope (flat) | One bag of disposers regardless of nesting depth |
| Task API | Add to existing `IExecuteContext` | Already the second parameter to `execute()` |
| Disposer identity | Named/keyed entries | Enables dedup, selective disposal, introspection |

## ResourceScope Class

Lives in `@workglow/util`. No base class, no events.

```ts
export class ResourceScope {
  private readonly disposers: Map<string, () => Promise<void>>;

  /** Register a disposer. If the key already exists, this is a no-op (first registration wins). */
  register(key: string, disposer: () => Promise<void>): void;

  /** Call and remove the disposer for the given key. No-op if key doesn't exist. */
  dispose(key: string): Promise<void>;

  /** Call all disposers via Promise.allSettled, then clear. */
  disposeAll(): Promise<void>;

  /** Check if a key is registered. */
  has(key: string): boolean;

  /** Iterate registered keys. */
  keys(): IterableIterator<string>;

  /** Number of registered disposers. */
  readonly size: number;

  /** Support `await using scope = new ResourceScope()`. */
  [Symbol.asyncDispose](): Promise<void>;
}
```

### Behavior

- `register(key, fn)` — if `key` is already in the map, the call is a no-op. First registration
  wins. This handles the common case where multiple tasks in a graph use the same pipeline or
  browser session.
- `dispose(key)` — calls the disposer, removes the entry. If the disposer throws, the error
  propagates to the caller. If the key doesn't exist, no-op.
- `disposeAll()` — calls every disposer via `Promise.allSettled()` (one failure doesn't block
  others), then clears the map. Errors from individual disposers are silently swallowed —
  best-effort cleanup. If error reporting is needed later, the return type can be changed to
  expose settled results without breaking existing callers.
- `[Symbol.asyncDispose]()` — delegates to `disposeAll()`.

## IExecuteContext Extension

In `@workglow/task-graph`, `IExecuteContext` gains one optional field:

```ts
export interface IExecuteContext {
  signal: AbortSignal;
  updateProgress: (progress: number, message?: string, ...args: any[]) => Promise<void>;
  own: <T extends ITask | ITaskGraph | IWorkflow>(i: T) => T;
  registry: ServiceRegistry;
  inputStreams?: Map<string, ReadableStream<StreamEvent>>;
  resourceScope?: ResourceScope; // new
}
```

Optional so all existing task implementations continue to work without changes.

## Run Config Integration

The existing `runConfig` parameter on `TaskGraph.run()` and `Workflow.run()` accepts an optional
`resourceScope`:

```ts
const scope = new ResourceScope();
await workflow.run(input, { resourceScope: scope });

// Later, when the caller is ready:
await scope.disposeAll();

// Or selectively:
await scope.dispose("browser:session-1");

// Or share across multiple runs:
await workflow2.run(input2, { resourceScope: scope });
await scope.disposeAll(); // cleans up resources from both runs
```

## Threading Through the Graph

`TaskGraphRunner` reads `resourceScope` from the run config and includes it in the
`IExecuteContext` it constructs for each task.

For sub-graphs (`GraphAsTask`, `IteratorTask`, `MapTask`, `WhileTask`, `ConditionalTask`), the
same `ResourceScope` reference is passed down. No child scopes, no hierarchy — everything
registers into the single flat scope the caller holds.

## Adoption in Resource-Heavy Tasks

### Browser control

`BrowserSessionTask` (or the task that calls `backend.connect()`) registers after acquiring the
browser:

```ts
async execute(input: SessionInput, context: IExecuteContext) {
  const backend = /* ... */;
  await backend.connect();
  context.resourceScope?.register(
    `browser:${sessionId}`,
    () => backend.disconnect()
  );
  // ...
}
```

### HuggingFace Transformers

AI tasks that trigger pipeline loading register on the main thread (not in the worker, which has
an isolated runtime). The disposer calls the appropriate pipeline removal function:

```ts
async execute(input: AiInput, context: IExecuteContext) {
  // ... trigger pipeline load via job queue or direct execution ...
  context.resourceScope?.register(
    `hft:${cacheKey}`,
    () => removeCachedPipeline(cacheKey)
  );
  // ...
}
```

### Other providers

llama.cpp, MediaPipe, and any future heavyweight providers follow the same pattern: register a
keyed disposer in `execute()` using optional chaining for backward compatibility.

### Key conventions

- **Key format**: `{provider}:{identifier}` (e.g., `browser:session-1`, `hft:bert-base/feature-extraction/fp32`)
- **Registration site**: always on the main thread, in the task's `execute()` method
- **Optional chaining**: `context.resourceScope?.register(...)` so tasks work with or without a scope

## Package Impact

| Package | Change |
|---------|--------|
| `@workglow/util` | Add `ResourceScope` class |
| `@workglow/task-graph` | Add `resourceScope` to `IExecuteContext`, thread through `TaskGraphRunner`/`TaskRunner`, pass through sub-graph tasks |
| `@workglow/tasks` | Register disposers in browser control tasks |
| `@workglow/ai` | Register disposers in AI task base classes |

No new dependency edges. `@workglow/task-graph` already depends on `@workglow/util`.

## What This Design Does NOT Do

- **Auto-cleanup**: The graph never calls disposers. The caller is always in control.
- **Lightweight resources**: GC-managed objects, in-memory buffers, file handles — not in scope.
- **Reference counting**: No tracking of how many tasks use a resource. First-registration-wins
  dedup is sufficient.
- **Events/observability**: No event emission on register/dispose. Can be added later if needed.
- **Worker-side registration**: Workers have isolated runtimes and cannot access the scope.
  Registration always happens on the main thread.
