<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Dual-Mode Execution

## Overview

The Workglow task graph engine provides two distinct execution modes that serve fundamentally different purposes:

1. **Full Execution (`run`)** -- Runs the task's `execute()` method, produces cached and immutable results, and transitions the task to `COMPLETED` status. This is the primary execution path for production workloads.

2. **Reactive Execution (`runReactive`)** -- Runs the task's `executeReactive()` method for lightweight, sub-millisecond UI previews. Tasks remain in their current status (typically `PENDING`), and output is treated as temporary and mutable.

This dual-mode architecture allows the same task graph to serve both batch processing and interactive UI scenarios. A user editing an input node in a visual builder sees instant preview updates via `runReactive()`, while the final "Run" button triggers `run()` to produce the authoritative, cached output.

---

## Full Execution: run()

### Purpose

Full execution is the authoritative execution path. It:

- Invokes the task's `execute()` method with full input validation
- Produces deterministic, cacheable results
- Transitions the task to `COMPLETED` status
- Locks the output as immutable
- Supports caching, streaming, abort signals, timeouts, and telemetry

### Task-Level Flow

When you call `task.run(overrides, runConfig)`, execution is delegated to `TaskRunner.run()`:

```
TaskRunner.run(overrides, config)
  |
  v
1. handleStart(config)
   - Set status = PROCESSING
   - Create AbortController
   - Link parent signal if provided
   - Configure output cache
   - Start telemetry span
   - Emit "start" and "status" events
  |
  v
2. setInput(overrides)
   - Merge overrides into runInputData
  |
  v
3. Resolve config schema annotations
   - Resolve format annotations (e.g., "mcp-server" references) in task.config
   - Uses originalConfig as the resolution source for re-runs
  |
  v
4. resolveSchemaInputs()
   - Resolve format annotations in input (e.g., format:"model", format:"storage:tabular")
   - Replace string identifiers with resolved instances from the ServiceRegistry
  |
  v
5. validateInput()
   - Validate runInputData against the compiled JSON Schema (inputSchema)
   - Throw TaskInvalidInputError if validation fails
  |
  v
6. Check abort
   - If the signal is already aborted, throw TaskAbortedError
  |
  v
7. Check cache (if cacheable)
   - Look up cached output by (task.type, input)
   - If found: use cached result, call executeReactive for UI state, skip execute()
  |
  v
8. Execute
   - If streamable: executeStreamingTask(input) -- consume executeStream() async iterable
   - Otherwise: executeTask(input) -- call task.execute(input, context)
   - Then: executeTaskReactive(input, output) -- merge reactive overlay
  |
  v
9. Store in cache (if cacheable and output is new)
  |
  v
10. handleComplete()
    - Set status = COMPLETED
    - Record completedAt timestamp
    - Set progress = 100
    - End telemetry span
    - Emit "complete" and "status" events
  |
  v
Return runOutputData (locked, immutable)
```

### Graph-Level Flow

When a TaskGraph executes via `run()`, the `TaskGraphRunner` orchestrates all tasks:

```
TaskGraph.run(input, config)
  |
  v
TaskGraphRunner.runGraph(input, config)
  |
  v
For each task in topological order:
  |
  v
  1. copyInputFromEdgesToNode(task)
     - For each incoming dataflow, read the dataflow's value
     - Write it into task.runInputData at the target port
  |
  v
  2. task.run(taskInput, runConfig)
     - Root tasks (no incoming dataflows) receive the graph-level input
     - Non-root tasks receive an empty override (dataflows provide data)
  |
  v
  3. pushOutputFromNodeToEdges(task, output)
     - For each outgoing dataflow, copy the relevant output port value
     - Set the dataflow's status to COMPLETED
  |
  v
Collect results from ending nodes (tasks with no outgoing dataflows)
Return GraphResultArray<Output>
```

### Error Handling

If any task throws during `execute()`, the TaskRunner catches the error and:

1. Sets `task.status = FAILED`
2. Stores the error on `task.error`
3. Aborts any child subgraphs
4. Emits `"error"` and `"status"` events
5. Re-throws the error to the caller

The `TaskGraphRunner` catches per-task errors and can abort the entire graph depending on the failure mode.

### Timeout Support

Tasks support per-task timeouts via the `timeout` config property:

```typescript
const task = new MyTask({ timeout: 5000 }); // 5 seconds
```

When the timeout elapses, the TaskRunner aborts the task and throws a `TaskTimeoutError`. The graph-level `timeout` option in `TaskGraphRunConfig` applies to the entire graph execution.

---

## Reactive Execution: runReactive()

### Purpose

Reactive execution exists for **UI previews and interactive feedback**. When a user edits a task's input in a visual builder, the system calls `runReactive()` to propagate lightweight updates through the graph without running heavy computation.

Key characteristics:

- Calls `executeReactive()` instead of `execute()`
- Does **not** change the task's status (PENDING stays PENDING)
- Output is temporary and mutable (not cached)
- Only affects `PENDING` tasks; `COMPLETED` tasks return cached output unchanged
- Must complete in under 1 millisecond per task

### Task-Level Flow

```
TaskRunner.runReactive(overrides)
  |
  v
1. Guard: if status == PROCESSING, return existing output (no re-entry)
  |
  v
2. setInput(overrides)
   - Merge overrides into runInputData
  |
  v
3. Resolve config and input schema annotations
   - Same resolution as full run (models, repositories, etc.)
  |
  v
4. handleStartReactive()
   - Mark reactiveRunning = true (internal flag, no status change)
  |
  v
5. validateInput()
   - Validate against input schema
  |
  v
6. executeTaskReactive(input, output)
   - Call task.executeReactive(input, output, context)
   - Merge result with existing output: Object.assign({}, output, reactiveResult)
  |
  v
7. handleCompleteReactive()
   - Mark reactiveRunning = false
  |
  v
Return runOutputData (temporary, mutable)
```

### Graph-Level Reactive Flow

The graph-level reactive execution has critical differences from the full run:

```
TaskGraph.runReactive(input, config)
  |
  v
TaskGraphRunner.runGraphReactive(input, config)
  |
  v
For each task in topological order:
  |
  v
  IF task.status == PENDING:
    1. task.resetInputData()             -- Reset to construction defaults
    2. copyInputFromEdgesToNode(task)     -- Pull from incoming dataflows
  ELSE (COMPLETED):
    Skip input modification              -- Output is locked, do not touch
  |
  v
  IF isRootTask (no incoming dataflows):
    taskInput = input                    -- Pass graph input to root tasks
  ELSE:
    taskInput = {}
  |
  v
  task.runReactive(taskInput)
  |
  v
  pushOutputFromNodeToEdges()            -- Push output to dataflows
  |
  v
Return results from ending nodes
```

### The Less-Than-1ms Constraint

The `executeReactive()` method must be extremely fast. Its contract:

- **Target**: Complete in under 1 millisecond
- **Allowed**: Simple transformations, string formatting, preview generation
- **Forbidden**: Network requests, file I/O, heavy computation, model inference

```typescript
// CORRECT: Quick preview computation
async executeReactive(input, output, context) {
  return { ...output, preview: input.text.substring(0, 200) };
}

// INCORRECT: Heavy computation in reactive path
async executeReactive(input, output, context) {
  // This takes 30 seconds and violates the contract
  const result = await this.trainNeuralNetwork(input);
  return { result };
}
```

The default implementation simply returns the existing output unchanged:

```typescript
async executeReactive(input, output, context) {
  return output;
}
```

Tasks that do not need preview updates can leave this default in place.

---

## The Immutability Invariant

The most important invariant in the dual-mode system is: **COMPLETED tasks are immutable**.

Once `run()` finishes and a task transitions to `COMPLETED`:

1. `runOutputData` is locked and cached
2. `runInputData` must not be modified
3. `runReactive()` returns the cached output without calling `executeReactive()`
4. Dataflows from COMPLETED tasks carry fixed values

This invariant enables several guarantees:

- **Cache correctness**: The mapping from `(type, input)` to `output` is stable.
- **Determinism**: Re-running reactive execution on a partially-completed graph produces consistent results.
- **UI consistency**: COMPLETED nodes in a visual builder show their final, authoritative output regardless of how many reactive passes occur.

### Mixed COMPLETED/PENDING States

In interactive scenarios, a graph often contains a mix of COMPLETED and PENDING tasks. Consider a three-task pipeline:

```
[TaskA: COMPLETED] --> [TaskB: COMPLETED] --> [TaskC: PENDING]
```

If the user edits TaskC's input and triggers `runReactive()`:

- **TaskA** (COMPLETED): Input is not modified. Returns cached output. Dataflow carries the locked value.
- **TaskB** (COMPLETED): Same behavior -- returns cached output unchanged.
- **TaskC** (PENDING): Input is reset to defaults, then dataflow from TaskB populates it. `executeReactive()` runs with the new data.

If the user edits TaskA's defaults and wants to re-run the entire pipeline, the graph must first be reset (`resetGraph()`) to return all tasks to PENDING.

---

## Caching Integration

### How Caching Works

The output cache is a `TaskOutputRepository` that maps `(taskType, input)` to `output`. During `run()`:

```typescript
// Check cache
if (task.cacheable) {
  const cached = await outputCache.getOutput(task.type, inputs);
  if (cached) {
    // Cache hit: use cached result, skip execute()
    task.runOutputData = cached;
    // Still call executeReactive() for UI state update
    task.runOutputData = await executeTaskReactive(inputs, cached);
    return;
  }
}

// Cache miss: execute and store
const result = await task.execute(input, context);
if (task.cacheable && result !== undefined) {
  await outputCache.saveOutput(task.type, inputs, result);
}
```

### Cache Configuration

Caching can be configured at multiple levels:

```typescript
// Task-level: static property
class MyTask extends Task {
  static readonly cacheable = true;
}

// Instance-level: config override
const task = new MyTask({ cacheable: false });

// Runtime-level: runConfig override
await task.run({}, { cacheable: true });

// Graph-level: enable global cache
await graph.run({}, { outputCache: true });

// Graph-level: custom cache backend
await graph.run({}, { outputCache: myPostgresCache });
```

The precedence order (highest to lowest):

1. `runConfig.cacheable` (runtime override)
2. `config.cacheable` (instance-level)
3. `static cacheable` (class-level)

### Cache and Reactive Execution

Reactive execution never reads from or writes to the cache. It operates purely on temporary in-memory state.

---

## Performance Guidelines

### For execute() (Full Mode)

- No performance constraint beyond reasonable execution time
- Use `context.updateProgress(progress, message)` to report progress
- Check `context.signal.aborted` periodically for long operations
- Use the `timeout` config property for safety bounds

```typescript
async execute(input, context) {
  for (let i = 0; i < items.length; i++) {
    if (context.signal.aborted) throw new TaskAbortedError();
    await processItem(items[i]);
    await context.updateProgress(Math.round((i / items.length) * 100));
  }
  return { processed: items.length };
}
```

### For executeReactive() (Reactive Mode)

- **Must complete in under 1 millisecond**
- No async I/O, no network calls, no heavy computation
- Return previews, summaries, or the existing output unchanged
- Use synchronous operations only when possible

```typescript
async executeReactive(input, output, context) {
  // Quick string preview: microseconds
  if (input.text) {
    return { ...output, preview: `${input.text.length} characters` };
  }
  return output;
}
```

### For Graph-Level Operations

- Use `runReactive()` for interactive feedback during editing
- Call `run()` only when the user explicitly requests execution
- Use `graph.subscribeToTaskProgress()` to show a progress bar
- Set `timeout` and `maxTasks` to prevent runaway execution

---

## API Reference

### Task Methods

| Method                                      | Mode     | Description                                         |
|---------------------------------------------|----------|-----------------------------------------------------|
| `task.run(overrides?, runConfig?)`           | Full     | Execute and return immutable output                 |
| `task.runReactive(overrides?)`              | Reactive | Execute reactive preview and return temporary output |
| `task.execute(input, context)`              | Full     | Override this to implement task logic                |
| `task.executeReactive(input, output, ctx)`  | Reactive | Override for sub-1ms preview logic                   |
| `task.abort()`                              | Both     | Abort the task via its AbortController              |
| `task.disable()`                            | Both     | Set task to DISABLED status                         |
| `task.resetInputData()`                     | Both     | Reset runInputData to construction defaults         |
| `task.setInput(partial)`                    | Both     | Merge partial input into runInputData               |
| `task.setDefaults(partial)`                 | Both     | Update default input values                         |
| `task.validateInput(input)`                 | Both     | Validate input against compiled schema              |

### TaskGraph Methods

| Method                                      | Mode     | Description                                         |
|---------------------------------------------|----------|-----------------------------------------------------|
| `graph.run(input?, config?)`                | Full     | Execute all tasks in topological order              |
| `graph.runReactive(input?, config?)`        | Reactive | Reactive execution for UI previews                  |
| `graph.abort()`                             | Both     | Abort all running tasks                             |
| `graph.resetGraph()`                        | Both     | Reset all tasks to PENDING                          |

### TaskRunner Properties

| Property          | Type                    | Description                                    |
|-------------------|-------------------------|------------------------------------------------|
| `running`         | `boolean`               | Whether a full run is in progress              |
| `reactiveRunning` | `boolean`               | Whether a reactive run is in progress          |
| `task`            | `ITask`                 | The task being managed                         |
| `inputStreams`    | `Map<string, Stream>`   | Input streams for pass-through streaming       |
| `shouldAccumulate`| `boolean`               | Whether to accumulate streaming deltas         |

### IExecuteContext

Provided to `execute()`:

```typescript
interface IExecuteContext {
  signal: AbortSignal;                              // For cancellation
  updateProgress: (progress: number, message?: string) => Promise<void>;
  own: <T>(task: T) => T;                          // Register child task
  registry: ServiceRegistry;                        // DI container
  inputStreams?: Map<string, ReadableStream>;        // Upstream streams
}
```

### IExecuteReactiveContext

Provided to `executeReactive()`:

```typescript
interface IExecuteReactiveContext {
  own: <T>(task: T) => T;  // Register child task
}
```

---

## Common Patterns

### Pattern: Progressive Preview

Update the preview as the user types, then run full execution on submit:

```typescript
class TextAnalysisTask extends Task<{ text: string }, { wordCount: number; analysis: string }> {
  // Full execution: call an AI model
  async execute(input, context) {
    const analysis = await callAIModel(input.text, { signal: context.signal });
    return { wordCount: input.text.split(/\s+/).length, analysis };
  }

  // Reactive preview: instant word count, placeholder analysis
  async executeReactive(input, output) {
    return {
      wordCount: (input.text || "").split(/\s+/).filter(Boolean).length,
      analysis: output.analysis ?? "Run to generate analysis...",
    };
  }
}
```

### Pattern: Conditional Reactive Behavior

Only compute a preview when the input has actually changed:

```typescript
class ImageFilterTask extends Task<{ image: Blob; filter: string }, { preview: string }> {
  private lastFilter: string | undefined;

  async executeReactive(input, output) {
    if (input.filter === this.lastFilter) {
      return output; // No change, return existing output
    }
    this.lastFilter = input.filter;
    return { preview: `Preview: ${input.filter} applied` };
  }
}
```

### Pattern: Mixed-State Graph Interaction

Handle a graph where some tasks are complete and others are pending:

```typescript
const graph = new TaskGraph();
// ... add tasks and dataflows ...

// First run completes everything
await graph.run({ text: "hello" });
// All tasks are now COMPLETED

// User edits a middle task's input -- need to re-run from that point
// Reset only downstream tasks (or reset entire graph)
graph.resetGraph();

// Now all tasks are PENDING again; run with new input
await graph.run({ text: "hello world" });
```

---

## Summary: run() vs runReactive()

| Aspect                | `run()`                 | `runReactive()`          |
|-----------------------|-------------------------|--------------------------|
| **Purpose**           | Full, authoritative run | UI previews              |
| **Method called**     | `execute()`             | `executeReactive()`      |
| **Final status**      | COMPLETED               | Unchanged (stays PENDING)|
| **Output**            | Locked, immutable       | Temporary, mutable       |
| **Caching**           | Read + Write            | Neither                  |
| **Dataflow updates**  | Always applied          | Only for PENDING tasks   |
| **Performance target**| No constraint           | < 1ms per task           |
| **Telemetry**         | Spans recorded          | No telemetry             |
| **Abort support**     | Full (signal + timeout) | No abort support         |
| **Progress events**   | Emitted                 | Not emitted              |
