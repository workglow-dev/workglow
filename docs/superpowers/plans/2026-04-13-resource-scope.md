# ResourceScope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ResourceScope` class that lets workflow callers collect and control cleanup of heavyweight resources (browser instances, ML pipelines) acquired during graph execution.

**Architecture:** A standalone `ResourceScope` class in `@workglow/util` holds keyed disposer functions. It's threaded through the existing `IRunConfig` → `TaskGraphRunConfig` → `WorkflowRunConfig` → `IExecuteContext` chain, following the same pattern as `registry`. Task authors register disposers via `context.resourceScope?.register(key, fn)`. The caller controls when to call `disposeAll()`.

**Tech Stack:** TypeScript, vitest, bun test runner

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/util/src/resource/ResourceScope.ts` | ResourceScope class |
| Modify | `packages/util/src/common.ts` | Re-export ResourceScope |
| Create | `packages/test/src/test/resource/ResourceScope.test.ts` | Unit tests for ResourceScope |
| Modify | `packages/task-graph/src/task/ITask.ts` | Add `resourceScope` to `IExecuteContext`, `IRunConfig` |
| Modify | `packages/task-graph/src/task-graph/TaskGraph.ts` | Add `resourceScope` to `TaskGraphRunConfig` |
| Modify | `packages/task-graph/src/task-graph/IWorkflow.ts` | Add `resourceScope` to `WorkflowRunConfig` |
| Modify | `packages/task-graph/src/task/TaskRunner.ts` | Store and thread `resourceScope` |
| Modify | `packages/task-graph/src/task-graph/TaskGraphRunner.ts` | Store and thread `resourceScope` |
| Modify | `packages/task-graph/src/task/GraphAsTaskRunner.ts` | Pass `resourceScope` to sub-graph |
| Modify | `packages/task-graph/src/task/IteratorTaskRunner.ts` | Pass `resourceScope` to iterations |
| Modify | `packages/task-graph/src/task-graph/Workflow.ts` | Pass `resourceScope` from config to graph.run() |
| Create | `packages/test/src/test/task-graph/ResourceScope.test.ts` | Integration tests: scope threading through graphs |
| Modify | `packages/tasks/src/task/browser-control/tasks/BrowserSessionTask.ts` | Register browser disposer |
| Modify | `packages/ai/src/task/base/AiTask.ts` | Register pipeline disposer |

---

### Task 1: ResourceScope class

**Files:**
- Create: `packages/util/src/resource/ResourceScope.ts`
- Modify: `packages/util/src/common.ts:18`

- [ ] **Step 1: Write the failing test**

Create `packages/test/src/test/resource/ResourceScope.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import { ResourceScope } from "@workglow/util";

describe("ResourceScope", () => {
  it("should register and dispose a single resource", async () => {
    const scope = new ResourceScope();
    const disposer = vi.fn(async () => {});
    scope.register("test:1", disposer);

    expect(scope.has("test:1")).toBe(true);
    expect(scope.size).toBe(1);

    await scope.dispose("test:1");

    expect(disposer).toHaveBeenCalledOnce();
    expect(scope.has("test:1")).toBe(false);
    expect(scope.size).toBe(0);
  });

  it("should deduplicate — first registration wins", async () => {
    const scope = new ResourceScope();
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});

    scope.register("test:1", first);
    scope.register("test:1", second);

    expect(scope.size).toBe(1);

    await scope.dispose("test:1");
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("should no-op when disposing a non-existent key", async () => {
    const scope = new ResourceScope();
    await scope.dispose("nonexistent"); // should not throw
  });

  it("should disposeAll and clear the map", async () => {
    const scope = new ResourceScope();
    const d1 = vi.fn(async () => {});
    const d2 = vi.fn(async () => {});
    scope.register("a", d1);
    scope.register("b", d2);

    await scope.disposeAll();

    expect(d1).toHaveBeenCalledOnce();
    expect(d2).toHaveBeenCalledOnce();
    expect(scope.size).toBe(0);
  });

  it("disposeAll should not throw if one disposer fails", async () => {
    const scope = new ResourceScope();
    const good = vi.fn(async () => {});
    const bad = vi.fn(async () => {
      throw new Error("boom");
    });
    scope.register("good", good);
    scope.register("bad", bad);

    // Should not throw
    await scope.disposeAll();

    expect(good).toHaveBeenCalledOnce();
    expect(bad).toHaveBeenCalledOnce();
    expect(scope.size).toBe(0);
  });

  it("dispose(key) should propagate errors from the disposer", async () => {
    const scope = new ResourceScope();
    scope.register("bad", async () => {
      throw new Error("boom");
    });

    await expect(scope.dispose("bad")).rejects.toThrow("boom");
    expect(scope.has("bad")).toBe(false);
  });

  it("should iterate keys", () => {
    const scope = new ResourceScope();
    scope.register("a", async () => {});
    scope.register("b", async () => {});
    scope.register("c", async () => {});

    expect([...scope.keys()]).toEqual(["a", "b", "c"]);
  });

  it("should support Symbol.asyncDispose", async () => {
    const scope = new ResourceScope();
    const disposer = vi.fn(async () => {});
    scope.register("test", disposer);

    await scope[Symbol.asyncDispose]();

    expect(disposer).toHaveBeenCalledOnce();
    expect(scope.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun scripts/test.ts resource vitest`
Expected: FAIL — `ResourceScope` does not exist yet.

- [ ] **Step 3: Implement ResourceScope**

Create `packages/util/src/resource/ResourceScope.ts`:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A keyed collection of async disposer functions for heavyweight resources.
 *
 * Task authors register disposers during execution. The caller who created
 * the scope decides when (or whether) to invoke them.
 *
 * First-registration-wins: if a key is already present, subsequent
 * registrations for that key are silently ignored.
 */
export class ResourceScope {
  private readonly disposers = new Map<string, () => Promise<void>>();

  /**
   * Register a disposer under the given key.
   * If the key already exists, the call is a no-op (first registration wins).
   */
  register(key: string, disposer: () => Promise<void>): void {
    if (!this.disposers.has(key)) {
      this.disposers.set(key, disposer);
    }
  }

  /**
   * Call and remove the disposer for the given key.
   * No-op if the key does not exist. Errors propagate to the caller.
   */
  async dispose(key: string): Promise<void> {
    const disposer = this.disposers.get(key);
    if (disposer) {
      this.disposers.delete(key);
      await disposer();
    }
  }

  /**
   * Call all disposers via Promise.allSettled (best-effort), then clear.
   * Individual disposer errors are silently swallowed.
   */
  async disposeAll(): Promise<void> {
    const fns = [...this.disposers.values()];
    this.disposers.clear();
    await Promise.allSettled(fns.map((fn) => fn()));
  }

  /** Check if a key is registered. */
  has(key: string): boolean {
    return this.disposers.has(key);
  }

  /** Iterate registered keys. */
  keys(): IterableIterator<string> {
    return this.disposers.keys();
  }

  /** Number of registered disposers. */
  get size(): number {
    return this.disposers.size;
  }

  /** Support `await using scope = new ResourceScope()`. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.disposeAll();
  }
}
```

- [ ] **Step 4: Add the re-export to common.ts**

In `packages/util/src/common.ts`, add at the end (after line 18):

```ts
export * from "./resource/ResourceScope";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun scripts/test.ts resource vitest`
Expected: All 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/util/src/resource/ResourceScope.ts packages/util/src/common.ts packages/test/src/test/resource/ResourceScope.test.ts
git commit -m "feat(util): add ResourceScope class for heavyweight resource lifecycle"
```

---

### Task 2: Add resourceScope to IExecuteContext, IRunConfig, TaskGraphRunConfig, and WorkflowRunConfig

**Files:**
- Modify: `packages/task-graph/src/task/ITask.ts:30-42` (IExecuteContext), `packages/task-graph/src/task/ITask.ts:50-107` (IRunConfig)
- Modify: `packages/task-graph/src/task-graph/TaskGraph.ts:38-68` (TaskGraphRunConfig)
- Modify: `packages/task-graph/src/task-graph/IWorkflow.ts:12-15` (WorkflowRunConfig)

- [ ] **Step 1: Add resourceScope to IExecuteContext**

In `packages/task-graph/src/task/ITask.ts`, add the import at the top (alongside existing `@workglow/util` imports):

```ts
import type { EventEmitter, ServiceRegistry, ResourceScope } from "@workglow/util";
```

Then add the field to `IExecuteContext` (after line 41, before the closing `}`):

```ts
  /** Resource scope for registering heavyweight resource disposers. */
  resourceScope?: ResourceScope;
```

- [ ] **Step 2: Add resourceScope to IRunConfig**

In the same file, add to `IRunConfig` (after the `signal` field, before the `enforceEntitlements` field):

```ts
  /**
   * Resource scope for collecting heavyweight resource disposers.
   * When provided, tasks can register cleanup functions via context.resourceScope.
   * The caller controls when to invoke them.
   */
  resourceScope?: ResourceScope;
```

- [ ] **Step 3: Add resourceScope to TaskGraphRunConfig**

In `packages/task-graph/src/task-graph/TaskGraph.ts`, add the import:

```ts
import type { ResourceScope } from "@workglow/util";
```

Add to `TaskGraphRunConfig` (after the `enforceEntitlements` field):

```ts
  /**
   * Resource scope for collecting heavyweight resource disposers during graph execution.
   * Threaded to all tasks via IExecuteContext. The caller controls disposal.
   */
  resourceScope?: ResourceScope;
```

- [ ] **Step 4: Add resourceScope to WorkflowRunConfig**

In `packages/task-graph/src/task-graph/IWorkflow.ts`, add the import:

```ts
import type { ResourceScope } from "@workglow/util";
```

Add to `WorkflowRunConfig` (after the `registry` field):

```ts
  /** Resource scope for collecting heavyweight resource disposers. */
  readonly resourceScope?: ResourceScope;
```

- [ ] **Step 5: Build types to verify**

Run: `bun run build:types`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/task-graph/src/task/ITask.ts packages/task-graph/src/task-graph/TaskGraph.ts packages/task-graph/src/task-graph/IWorkflow.ts
git commit -m "feat(task-graph): add resourceScope to IExecuteContext, IRunConfig, and run configs"
```

---

### Task 3: Thread resourceScope through TaskRunner

**Files:**
- Modify: `packages/task-graph/src/task/TaskRunner.ts`

The pattern follows exactly how `registry` is handled: stored as an instance property in `handleStart()`, included in the `IExecuteContext` built in `executeTask()` and `executeStreamingTask()`, and propagated to owned children in `own()`.

- [ ] **Step 1: Write the failing integration test**

Create `packages/test/src/test/task-graph/ResourceScope.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import { ResourceScope } from "@workglow/util";
import {
  IExecuteContext,
  Task,
  TaskGraph,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util/schema";

// A task that registers a disposer on the resource scope
class ResourceAcquiringTask extends Task<{ name: string }, { name: string }> {
  static override readonly type = "ResourceAcquiringTask";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { name: { type: "string", default: "default" } },
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { name: { type: "string" } },
    } as const satisfies DataPortSchema;
  }
  override async execute(
    input: { name: string },
    context: IExecuteContext
  ): Promise<{ name: string }> {
    context.resourceScope?.register(`test:${input.name}`, async () => {});
    return { name: input.name };
  }
}

describe("ResourceScope threading", () => {
  it("task.run() should thread resourceScope to execute()", async () => {
    const scope = new ResourceScope();
    const task = new ResourceAcquiringTask({ id: "t1" });
    task.setDefaults({ name: "hello" });
    await task.run({}, { resourceScope: scope });
    expect(scope.has("test:hello")).toBe(true);
  });

  it("TaskGraph should thread resourceScope to all tasks", async () => {
    const scope = new ResourceScope();
    const graph = new TaskGraph();
    const t1 = new ResourceAcquiringTask({ id: "t1" });
    const t2 = new ResourceAcquiringTask({ id: "t2" });
    t1.setDefaults({ name: "alpha" });
    t2.setDefaults({ name: "beta" });
    graph.addTask(t1);
    graph.addTask(t2);
    await graph.run({}, { resourceScope: scope });
    expect(scope.has("test:alpha")).toBe(true);
    expect(scope.has("test:beta")).toBe(true);
  });

  it("Workflow should thread resourceScope to tasks", async () => {
    const scope = new ResourceScope();
    const wf = new Workflow({ id: "wf1" });
    const t1 = wf.addTask(new ResourceAcquiringTask({ id: "t1" }));
    t1.setDefaults({ name: "gamma" });
    await wf.run({}, { resourceScope: scope });
    expect(scope.has("test:gamma")).toBe(true);
  });

  it("sub-graphs should share the parent ResourceScope", async () => {
    const scope = new ResourceScope();
    const graph = new TaskGraph();

    // Create an inner workflow that contains a resource-acquiring task
    const inner = new Workflow({ id: "inner" });
    const innerTask = inner.addTask(new ResourceAcquiringTask({ id: "it1" }));
    innerTask.setDefaults({ name: "inner-resource" });

    graph.addTask(inner);
    await graph.run({}, { resourceScope: scope });
    expect(scope.has("test:inner-resource")).toBe(true);
  });

  it("deduplicates across tasks using the same resource key", async () => {
    const scope = new ResourceScope();
    const graph = new TaskGraph();
    // Two tasks register the same key
    const t1 = new ResourceAcquiringTask({ id: "t1" });
    const t2 = new ResourceAcquiringTask({ id: "t2" });
    t1.setDefaults({ name: "shared" });
    t2.setDefaults({ name: "shared" });
    graph.addTask(t1);
    graph.addTask(t2);
    await graph.run({}, { resourceScope: scope });
    // Only one entry despite two tasks
    expect(scope.size).toBe(1);
    expect(scope.has("test:shared")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun scripts/test.ts resource vitest`
Expected: FAIL — `resourceScope` is not threaded yet, so `scope.has()` returns false.

- [ ] **Step 3: Add resourceScope instance property to TaskRunner**

In `packages/task-graph/src/task/TaskRunner.ts`, add after the `registry` property (around line 73):

```ts
  /**
   * Resource scope for this task run
   */
  protected resourceScope?: ResourceScope;
```

Add the import at the top (extend the existing `@workglow/util` import):

```ts
import {
  getLogger,
  getTelemetryProvider,
  globalServiceRegistry,
  ResourceScope,
  ServiceRegistry,
  SpanStatusCode,
} from "@workglow/util";
```

- [ ] **Step 4: Store resourceScope in handleStart()**

In `TaskRunner.handleStart()` (around line 535, after the `if (config.registry)` block):

```ts
    if (config.resourceScope) {
      this.resourceScope = config.resourceScope;
    }
```

- [ ] **Step 5: Include resourceScope in executeTask() context**

In `TaskRunner.executeTask()` (lines 314-319), add `resourceScope` to the context object:

```ts
  protected async executeTask(input: Input): Promise<Output | undefined> {
    const result = await this.task.execute(input, {
      signal: this.abortController!.signal,
      updateProgress: this.handleProgress.bind(this),
      own: this.own,
      registry: this.registry,
      resourceScope: this.resourceScope,
    });
    return await this.executeTaskReactive(input, result || ({} as Output));
  }
```

- [ ] **Step 6: Include resourceScope in executeStreamingTask() context**

In `TaskRunner.executeStreamingTask()` (lines 374-380), add `resourceScope`:

```ts
    const stream = this.task.executeStream!(input, {
      signal: this.abortController!.signal,
      updateProgress: this.handleProgress.bind(this),
      own: this.own,
      registry: this.registry,
      inputStreams: this.inputStreams,
      resourceScope: this.resourceScope,
    });
```

- [ ] **Step 7: Propagate resourceScope in own()**

In `TaskRunner.own()` (lines 296-299), add `resourceScope` to the Object.assign:

```ts
    if (hasRunConfig(i)) {
      Object.assign(i.runConfig, {
        registry: this.registry,
        signal: this.abortController?.signal,
        resourceScope: this.resourceScope,
      });
    }
```

- [ ] **Step 8: Run the first test case to verify standalone task threading**

Run: `bun scripts/test.ts resource vitest`
Expected: First test (`task.run() should thread resourceScope to execute()`) PASS. Others still fail because TaskGraphRunner and Workflow don't thread it yet.

- [ ] **Step 9: Commit**

```bash
git add packages/task-graph/src/task/TaskRunner.ts packages/test/src/test/task-graph/ResourceScope.test.ts
git commit -m "feat(task-graph): thread resourceScope through TaskRunner"
```

---

### Task 4: Thread resourceScope through TaskGraphRunner

**Files:**
- Modify: `packages/task-graph/src/task-graph/TaskGraphRunner.ts`

Follows the same pattern as `registry`: stored in `handleStart()`, passed in the `IRunConfig` objects built for `task.runner.run()`.

- [ ] **Step 1: Add resourceScope instance property**

In `TaskGraphRunner` class (around line 111, after the `registry` property):

```ts
  /**
   * Resource scope for this graph run
   */
  protected resourceScope?: ResourceScope;
```

Add to the import from `@workglow/util` (line 8-17):

```ts
import {
  collectPropertyValues,
  ConvertAllToOptionalArray,
  getLogger,
  getTelemetryProvider,
  globalServiceRegistry,
  ResourceScope,
  ServiceRegistry,
  SpanStatusCode,
  uuid4,
} from "@workglow/util";
```

- [ ] **Step 2: Store resourceScope in handleStart()**

In `TaskGraphRunner.handleStart()` (after the registry setup, around line 974):

```ts
    if (config?.resourceScope !== undefined) {
      this.resourceScope = config.resourceScope;
    }
```

- [ ] **Step 3: Pass resourceScope in runTask() — non-streaming path**

In `TaskGraphRunner.runTask()` (lines 734-741), add `resourceScope`:

```ts
    const results = await task.runner.run(input, {
      outputCache: this.outputCache ?? false,
      updateProgress: async (task: ITask, progress: number, message?: string, ...args: any[]) =>
        await this.handleProgress(task, progress, message, ...args),
      registry: this.registry,
      resourceScope: this.resourceScope,
    });
```

- [ ] **Step 4: Pass resourceScope in runStreamingTask()**

In `TaskGraphRunner.runStreamingTask()` (lines 816-822), add `resourceScope`:

```ts
      const results = await task.runner.run(input, {
        outputCache: this.outputCache ?? false,
        shouldAccumulate,
        updateProgress: async (task: ITask, progress: number, message?: string, ...args: any[]) =>
          await this.handleProgress(task, progress, message, ...args),
        registry: this.registry,
        resourceScope: this.resourceScope,
      });
```

- [ ] **Step 5: Run tests**

Run: `bun scripts/test.ts resource vitest`
Expected: `TaskGraph should thread resourceScope to all tasks` — PASS. Workflow test still fails.

- [ ] **Step 6: Commit**

```bash
git add packages/task-graph/src/task-graph/TaskGraphRunner.ts
git commit -m "feat(task-graph): thread resourceScope through TaskGraphRunner"
```

---

### Task 5: Thread resourceScope through Workflow and sub-graph runners

**Files:**
- Modify: `packages/task-graph/src/task-graph/Workflow.ts:610-614`
- Modify: `packages/task-graph/src/task/GraphAsTaskRunner.ts:30-34`
- Modify: `packages/task-graph/src/task/IteratorTaskRunner.ts:273-277`

- [ ] **Step 1: Pass resourceScope in Workflow.run()**

In `packages/task-graph/src/task-graph/Workflow.ts` (lines 610-614), add `resourceScope`:

```ts
      const output = await this.graph.run<Output>(input, {
        parentSignal: this._abortController.signal,
        outputCache: this._outputCache,
        registry: config?.registry ?? this._registry,
        resourceScope: config?.resourceScope,
      });
```

- [ ] **Step 2: Pass resourceScope in GraphAsTaskRunner.executeTaskChildren()**

In `packages/task-graph/src/task/GraphAsTaskRunner.ts` (lines 30-34), add `resourceScope`:

```ts
    const results = await this.task.subGraph!.run<Output>(input, {
      parentSignal: this.abortController?.signal,
      outputCache: this.outputCache,
      registry: this.registry,
      resourceScope: this.resourceScope,
    });
```

Also add it to `executeTaskChildrenReactive()` (lines 46-48):

```ts
    return this.task.subGraph!.runReactive<Output>(this.task.runInputData, {
      registry: this.registry,
      resourceScope: this.resourceScope,
    });
```

Note: `TaskGraphRunReactiveConfig` also needs `resourceScope`. In `packages/task-graph/src/task-graph/TaskGraph.ts`, check if `TaskGraphRunReactiveConfig` inherits from `TaskGraphRunConfig`. If it uses `Omit`, ensure `resourceScope` isn't omitted. It currently uses `Omit<TaskGraphRunConfig, "enforceEntitlements" | "timeout">`, so `resourceScope` will be inherited automatically.

- [ ] **Step 3: Pass resourceScope in IteratorTaskRunner.executeSubgraphIteration()**

In `packages/task-graph/src/task/IteratorTaskRunner.ts` (lines 273-277), add `resourceScope`:

```ts
      const results = await graphClone.run<TaskOutput>(input as TaskInput, {
        parentSignal: this.abortController?.signal,
        outputCache: this.outputCache,
        registry: this.registry,
        resourceScope: this.resourceScope,
      });
```

- [ ] **Step 4: Run all tests**

Run: `bun scripts/test.ts resource vitest`
Expected: All 5 ResourceScope threading tests PASS.

- [ ] **Step 5: Run existing task-graph tests to check for regressions**

Run: `bun scripts/test.ts task-graph vitest`
Expected: All existing tests PASS — the new field is optional and doesn't change behavior when absent.

- [ ] **Step 6: Commit**

```bash
git add packages/task-graph/src/task-graph/Workflow.ts packages/task-graph/src/task/GraphAsTaskRunner.ts packages/task-graph/src/task/IteratorTaskRunner.ts
git commit -m "feat(task-graph): thread resourceScope through Workflow and sub-graph runners"
```

---

### Task 6: Adopt ResourceScope in BrowserSessionTask

**Files:**
- Modify: `packages/tasks/src/task/browser-control/tasks/BrowserSessionTask.ts:153-179`

- [ ] **Step 1: Write the pattern test**

Add to `packages/test/src/test/task-graph/ResourceScope.test.ts`. This test verifies the browser adoption pattern using a mock task (since BrowserSessionTask requires Playwright). It should pass immediately since threading is already in place from Tasks 3-5:

```ts
// Add to the existing describe block:

describe("ResourceScope browser pattern", () => {
  it("BrowserSessionTask-style task registers a disposer keyed by session ID", async () => {
    const scope = new ResourceScope();
    const disconnected: string[] = [];

    // Simulates BrowserSessionTask registering a disposer
    class MockBrowserSessionTask extends Task<{}, { sessionId: string }> {
      static override readonly type = "MockBrowserSessionTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { sessionId: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      override async execute(
        _input: {},
        context: IExecuteContext
      ): Promise<{ sessionId: string }> {
        const sessionId = "sess-123";
        context.resourceScope?.register(`browser:${sessionId}`, async () => {
          disconnected.push(sessionId);
        });
        return { sessionId };
      }
    }

    const task = new MockBrowserSessionTask({ id: "bs1" });
    await task.run({}, { resourceScope: scope });

    expect(scope.has("browser:sess-123")).toBe(true);
    expect(disconnected).toEqual([]);

    await scope.disposeAll();
    expect(disconnected).toEqual(["sess-123"]);
    expect(scope.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun scripts/test.ts resource vitest`
Expected: PASS — this test exercises the pattern using mocks. It should pass with the threading already in place.

- [ ] **Step 3: Modify BrowserSessionTask to register a disposer**

In `packages/tasks/src/task/browser-control/tasks/BrowserSessionTask.ts`, the `execute()` method (lines 153-179) currently ignores `_executeContext`. Change it to use the context:

Replace the parameter name from `_executeContext` to `executeContext`, and add the registration after `BrowserSessionRegistry.register()`:

```ts
  override async execute(
    _input: BrowserSessionTaskInput,
    executeContext: IExecuteContext
  ): Promise<BrowserSessionTaskOutput> {
    const deps = getBrowserDeps();

    const backend = this.config.backend ?? deps.defaultBackend;

    if (!deps.availableBackends.includes(backend)) {
      throw new Error(
        `BrowserSessionTask: backend "${backend}" is not available. Available backends: ${deps.availableBackends.join(", ")}`
      );
    }

    const options = {
      backend,
      projectId: this.config.projectId,
      profileName: this.config.profileName,
      headless: this.config.headless ?? true,
    };

    const ctx = deps.createContext(options);
    await ctx.connect(options);

    const sessionId = BrowserSessionRegistry.register(ctx);

    executeContext.resourceScope?.register(`browser:${sessionId}`, async () => {
      await ctx.disconnect();
      BrowserSessionRegistry.unregister(sessionId);
    });

    return { sessionId };
  }
```

- [ ] **Step 4: Run browser tests to verify no regressions**

Run: `bun scripts/test.ts browser vitest`
Expected: All existing browser tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tasks/src/task/browser-control/tasks/BrowserSessionTask.ts packages/test/src/test/task-graph/ResourceScope.test.ts
git commit -m "feat(tasks): register browser session disposer on ResourceScope"
```

---

### Task 7: Adopt ResourceScope in AiTask

**Files:**
- Modify: `packages/ai/src/task/base/AiTask.ts:107-123`

This is trickier than browser tasks because the pipeline cache key is constructed inside the provider layer (worker-side), not in the task itself. The AiTask has access to the `ModelConfig` which contains the provider config. The disposer should call the provider-specific unload function.

- [ ] **Step 1: Write the failing test**

Add to `packages/test/src/test/task-graph/ResourceScope.test.ts`:

```ts
describe("ResourceScope AI pattern", () => {
  it("AiTask-style task registers a disposer keyed by model", async () => {
    const scope = new ResourceScope();
    const unloaded: string[] = [];

    class MockAiTask extends Task<{ model: string }, { text: string }> {
      static override readonly type = "MockAiTask";
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { model: { type: "string", default: "test-model" } },
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { text: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      override async execute(
        input: { model: string },
        context: IExecuteContext
      ): Promise<{ text: string }> {
        const modelKey = `ai:${input.model}`;
        context.resourceScope?.register(modelKey, async () => {
          unloaded.push(input.model);
        });
        return { text: "result" };
      }
    }

    const task = new MockAiTask({ id: "ai1" });
    await task.run({}, { resourceScope: scope });

    expect(scope.has("ai:test-model")).toBe(true);
    await scope.disposeAll();
    expect(unloaded).toEqual(["test-model"]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun scripts/test.ts resource vitest`
Expected: PASS — the pattern works with threading in place.

- [ ] **Step 3: Modify AiTask.execute() to register a disposer**

In `packages/ai/src/task/base/AiTask.ts`, the `execute()` method (lines 107-123) already receives `executeContext: IExecuteContext`. Add disposer registration after the strategy executes:

```ts
  override async execute(
    input: Input,
    executeContext: IExecuteContext
  ): Promise<Output | undefined> {
    const model = input.model as ModelConfig;
    if (!model || typeof model !== "object") {
      throw new TaskConfigurationError(
        "AiTask: Model was not resolved to ModelConfig - this indicates a bug in the resolution system"
      );
    }

    const jobInput = await this.getJobInput(input);
    const strategy = getAiProviderRegistry().getStrategy(model);

    const output = await strategy.execute(jobInput, executeContext, this.runConfig.runnerId);

    // Register a disposer so the caller can unload the model when done.
    // The key includes the provider and model path to uniquely identify the resource.
    const providerRegistry = getAiProviderRegistry();
    const unloadFn = providerRegistry.getUnloadFn(model);
    if (unloadFn && executeContext.resourceScope) {
      const resourceKey = `ai:${model.provider}:${model.provider_config?.model_path ?? model.model}`;
      executeContext.resourceScope.register(resourceKey, async () => {
        await unloadFn(model);
      });
    }

    return output as Output;
  }
```

**Note:** This assumes `AiProviderRegistry` has (or can be given) a `getUnloadFn(model)` method that returns the provider-specific unload function. Check what's available on the registry — if this method doesn't exist, the alternative is to register a generic disposer that calls through the existing `UnloadModelTask` run function mechanism. The exact implementation depends on what the `AiProviderRegistry` exposes. If `getUnloadFn` doesn't exist, an alternative approach is:

```ts
    if (executeContext.resourceScope) {
      const resourceKey = `ai:${model.provider}:${model.provider_config?.model_path ?? model.model}`;
      executeContext.resourceScope.register(resourceKey, async () => {
        const unloadStrategy = providerRegistry.getStrategy(model);
        const unloadInput = { model: input.model, taskType: "UnloadModelTask" } as any;
        await unloadStrategy.execute(unloadInput, {
          signal: AbortSignal.timeout(30_000),
          updateProgress: async () => {},
          own: (x: any) => x,
          registry: executeContext.registry,
        }, undefined);
      });
    }
```

The exact approach should be determined during implementation based on the `AiProviderRegistry` API. The key principle is: the disposer registered on the scope should trigger the same cleanup path as `UnloadModelTask` for the given model.

- [ ] **Step 4: Run AI tests to verify no regressions**

Run: `bun scripts/test.ts ai vitest`
Expected: All existing AI tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/task/base/AiTask.ts packages/test/src/test/task-graph/ResourceScope.test.ts
git commit -m "feat(ai): register model unload disposer on ResourceScope"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `bun scripts/test.ts vitest`
Expected: All tests PASS.

- [ ] **Step 2: Build the project**

Run: `bun run build:packages`
Expected: Clean build, no errors.

- [ ] **Step 3: Verify type exports**

In a scratch file or mentally verify:
- `import { ResourceScope } from "@workglow/util"` resolves
- `import { IExecuteContext } from "@workglow/task-graph"` includes `resourceScope`

- [ ] **Step 4: Commit any remaining changes**

If there are any fixups from the verification steps, commit them.
