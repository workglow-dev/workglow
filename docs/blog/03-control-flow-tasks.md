<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Loops, Branches, and Recursion in a DAG: How Workglow Solves Control Flow

**The paradox at the heart of every pipeline engine.**

You have a Directed Acyclic Graph. Acyclic -- no cycles. And yet your users want loops. They want `while` conditions that re-run a subgraph until convergence. They want `map` operations that fan out across array elements. They want `if/else` routing that sends data down one branch or another. Every one of these patterns, taken at face value, violates the fundamental invariant that makes your DAG a DAG.

So how does Workglow do it?

The answer is not to break acyclicity. It is to go _deeper_ -- to nest entire graphs inside single nodes, creating a hierarchy of execution contexts where iteration lives _within_ a task rather than _across_ the graph. This post walks through the five control flow tasks that make this possible: `GraphAsTask`, `MapTask`, `ReduceTask`, `WhileTask`, and `ConditionalTask`.

---

## The Challenge: DAGs Do Not Loop

A Directed Acyclic Graph is the natural data structure for data pipelines. Dependencies flow in one direction, topological sorting gives you execution order for free, and you never have to worry about infinite cycles. These properties make DAGs easy to reason about, easy to cache, and easy to parallelize.

But real-world pipelines demand control flow. Consider these scenarios:

- **Array parallelism**: You have 50 URLs to fetch and process. You want to run the same three-task pipeline for each URL, then collect the results.
- **Iterative refinement**: An LLM generates text, a quality evaluator scores it, and if the score is below a threshold, you feed the output back in for another pass.
- **Conditional routing**: A classifier labels incoming documents, and depending on the label, different processing pipelines should execute.
- **Sequential accumulation**: You are building a summary by processing chapters one at a time, each iteration adding to an accumulator that grows with context.

Every one of these patterns implies either cycles (looping back) or dynamic topology (spawning new paths). A naive approach would break the DAG contract. Workglow's approach preserves it by making control flow a matter of _composition_, not _mutation_.

---

## GraphAsTask: The Foundational Abstraction

At the base of all control flow in Workglow sits `GraphAsTask` -- a task that _contains_ an entire `TaskGraph` as its subgraph. From the outside, it looks like any other task: it has an input schema, an output schema, and it transitions through `PENDING -> PROCESSING -> COMPLETED`. From the inside, it is a full DAG with its own tasks, dataflows, and execution semantics.

```typescript
const group = new GraphAsTask();

// The subgraph is a full TaskGraph
group.subGraph.addTask(new FetchUrlTask({ defaults: { url: "" } }));
group.subGraph.addTask(new ParseHtmlTask());
group.subGraph.addDataflow(
  new Dataflow(fetchTask.id, "text", parseTask.id, "html")
);
```

The key insight is that **schemas are inferred dynamically**. `GraphAsTask` overrides `inputSchema()` and `outputSchema()` to compute them from the subgraph structure at runtime:

- **Input schema**: Collects properties from root tasks (those with no incoming dataflows). Required properties of non-root tasks that are not satisfied by any internal dataflow are also surfaced -- this ensures that if a downstream task needs a `model` parameter that no upstream task provides, it appears in the group's input schema.
- **Output schema**: Collects properties from ending tasks (those with no outgoing dataflows) and merges them according to a configurable `CompoundMergeStrategy`.

This dynamic schema inference means you can restructure a subgraph and the parent graph's type information updates automatically. No manual schema maintenance.

Execution is delegated to `GraphAsTaskRunner`, which calls `subGraph.run()` with the parent's input and wires up progress events so the parent graph can report aggregate progress. Streaming is also supported: `executeStream()` subscribes to streaming events from ending nodes in the subgraph and forwards them upward.

### Hierarchical Composition

Because `GraphAsTask` is itself a `Task`, it can be nested. A `GraphAsTask` can contain another `GraphAsTask`, which can contain a `MapTask`, which can contain a `WhileTask`. The hierarchy can go arbitrarily deep. Each level maintains its own execution context, its own abort controller, and its own progress tracking. This is the mechanism that enables complex control flow without ever introducing a cycle in any single graph.

---

## IteratorTask: The Shared Iteration Engine

Before diving into `MapTask` and `ReduceTask`, it is worth understanding their common parent: `IteratorTask`. This abstract class extends `GraphAsTask` and provides the machinery that all iteration-based tasks share.

### Input Analysis

The core problem an iterator must solve is: _which inputs should be iterated, and which should be passed through as constants?_ `IteratorTask` resolves this through a three-tier precedence system:

1. **Explicit annotation**: A property schema with `"x-ui-iteration": true` is always iterated.
2. **Schema inference**: If the schema declares `type: "array"`, the property is iterated. If it declares a scalar type, it is a constant.
3. **Runtime fallback**: If the schema is ambiguous (e.g., a `oneOf` union), `Array.isArray(value)` at runtime decides.

The `analyzeIterationInput()` method returns an `IterationAnalysisResult` that tells the runner exactly how many iterations to perform and how to extract per-iteration input. All iterated array inputs must have the same length (zip semantics) -- mismatched lengths throw a `TaskConfigurationError`.

### Iteration Context

Each iteration receives two injected context variables: `_iterationIndex` (0-based current position) and `_iterationCount` (total number of iterations). These are marked with `"x-ui-iteration": true` so UI builders know to hide them from the parent-level display.

### Subgraph Cloning

A critical detail: `IteratorTaskRunner` **clones the subgraph** for each iteration. The `cloneGraph()` method reconstructs each task from its constructor, preserving non-serializable config like function references (important for `WhileTask` conditions). This means iterations are fully isolated -- one iteration's side effects cannot leak into another.

### Flexible Input Schemas

The iteration input schema wraps each inner property in a flexible `anyOf: [T, T[]]` union by default. This means the same port can accept either a scalar (broadcast to all iterations) or an array (one element per iteration). You can override this per-property with `setPropertyInputMode()`:

```typescript
mapTask.setPropertyInputMode("model", "scalar");   // Same model for all iterations
mapTask.setPropertyInputMode("text", "array");      // Different text per iteration
mapTask.setPropertyInputMode("temperature", "flexible"); // Caller decides
```

---

## MapTask: Array Parallelism

`MapTask` is the workhorse of array processing. Given one or more array inputs, it runs the subgraph once per element (or per zip-tuple of elements), then collects the results into output arrays.

### The Workflow Builder

The fluent API makes `MapTask` feel natural:

```typescript
const workflow = new Workflow()
  .map({ concurrencyLimit: 5 })
    .fetchUrl()
    .extractText()
    .textEmbedding({ model: "text-embedding-ada-002" })
  .endMap();

const result = await workflow.run({
  url: ["https://a.com", "https://b.com", "https://c.com"],
});
// result.text => ["...", "...", "..."]
// result.vector => [Float32Array, Float32Array, Float32Array]
```

Between `.map()` and `.endMap()`, you are building in a _loop builder_ context -- a child `Workflow` whose graph becomes the `MapTask`'s subgraph. The `endMap()` call finalizes the template and returns you to the parent workflow.

### Concurrency and Batching

`MapTask` supports two orthogonal controls:

- **`concurrencyLimit`**: Maximum number of iterations running simultaneously. The runner creates a pool of `workerCount` async "workers" that pull from a shared cursor. This is not OS-level threading -- it is cooperative concurrency via `Promise.all`.
- **`batchSize`**: Groups iterations into batches. Items within a batch run up to the concurrency limit, then the next batch starts. Useful when you need to respect rate limits or memory constraints.

```typescript
.map({
  concurrencyLimit: 3,   // At most 3 iterations in flight
  batchSize: 10,         // Process in batches of 10
  preserveOrder: true,   // Results match input order (default)
})
```

### Output Schema

`MapTask` wraps the inner workflow's output properties in arrays. If the inner workflow produces `{ text: string, score: number }`, the `MapTask` output schema becomes `{ text: string[], score: number[] }`. The `flatten` option will concatenate nested arrays when each iteration itself returns an array.

### Progress Tracking

Each iteration tracks its own progress independently. The runner maintains a `mapPartialProgress` array with per-iteration completion percentages, then emits a weighted average as the parent task's progress. Progress messages include a running count: "Map 3/10 iterations".

---

## ReduceTask: Sequential Accumulation

Where `MapTask` fans out, `ReduceTask` folds in. It processes iterated inputs one at a time, threading an accumulator from each iteration to the next.

```typescript
const workflow = new Workflow()
  .reduce({ initialValue: { summary: "" } })
    .summarizeChapter()     // Takes { text, accumulator } -> { summary }
  .endReduce();

const result = await workflow.run({
  text: [chapter1, chapter2, chapter3],
});
// result.summary => cumulative summary of all three chapters
```

### Sequential Execution

`ReduceTask` enforces sequential processing by hardcoding `concurrencyLimit: 1` and `batchSize: 1` in its constructor. There is no way to parallelize a reduce -- each iteration depends on the previous one's output.

The runner's `executeReduceIterations()` method loops through each index, calling `buildIterationRunInput()` which injects the current `accumulator` alongside the per-iteration input and context variables. After each iteration, `mergeIterationIntoAccumulator()` updates the accumulator with the subgraph's output.

### Output Schema

Unlike `MapTask`, `ReduceTask` does _not_ wrap output properties in arrays. Its output schema mirrors the inner workflow's ending nodes directly -- the final accumulator value is the output.

---

## WhileTask: Conditional Looping

`WhileTask` is the closest thing to a traditional `while` loop. It runs its subgraph repeatedly until a condition function returns `false` or a maximum iteration count is reached.

```typescript
const workflow = new Workflow()
  .while({
    condition: (output, iteration) => output.quality < 0.9 && iteration < 10,
    maxIterations: 20,
  })
    .refineText()
    .evaluateQuality()
  .endWhile();
```

### Condition Functions

The condition function receives the merged output of the last iteration and the current iteration number. It can be:

- A **runtime function** (`WhileConditionFn<Output>`) for programmatic conditions
- A **serialized condition** using `conditionField`, `conditionOperator`, and `conditionValue` for conditions defined in a visual builder UI

Serialized conditions support twelve comparison operators (equals, not_equals, greater_than, contains, is_empty, is_true, and more) and nested field access via dot notation (e.g., `"result.score"`).

### Iteration Chaining

When `chainIterations` is `true` (the default), the output of iteration N is merged into the input of iteration N+1. This is what makes iterative refinement work -- each pass builds on the previous one. The chained output properties are marked with `"x-ui-iteration": true` in the schema so UI builders can distinguish them from the task's "real" inputs.

### Safety Limits

The `maxIterations` config (default: 100) prevents runaway loops. Even if the condition function has a bug that always returns `true`, the loop will terminate. Progress is reported as a percentage of `maxIterations`, capped at 99% since the loop may stop early.

### Array Decomposition

`WhileTask` also supports an `iterationInputConfig` that decomposes array inputs into per-iteration scalars, similar to how `IteratorTask` works. This enables a "for-each with early exit" pattern: iterate through array elements one at a time, stopping when the condition fails.

---

## ConditionalTask: Branching Logic

`ConditionalTask` implements if/else and switch/case routing. Unlike the other control flow tasks, it does not extend `GraphAsTask` -- it extends `Task` directly, because it does not contain a subgraph. Instead, it evaluates conditions and selectively populates output ports that downstream tasks connect to.

```typescript
const router = new ConditionalTask({
  branches: [
    { id: "premium", condition: (input) => input.tier === "premium", outputPort: "premium" },
    { id: "standard", condition: (input) => input.tier === "standard", outputPort: "standard" },
    { id: "free", condition: (input) => input.tier === "free", outputPort: "free" },
  ],
  defaultBranch: "standard",
  exclusive: true,
});
```

### Exclusive vs. Multi-Path Mode

- **Exclusive mode** (`exclusive: true`, the default): Branches are evaluated in order. The first match wins. This is switch/case behavior.
- **Multi-path mode** (`exclusive: false`): All matching branches activate simultaneously. This enables fan-out patterns where the same input triggers multiple processing paths.

### Dynamic Output Schema

The output schema is generated dynamically based on configured branches. Each branch's output port appears as an object property. An `_activeBranches` array in the output records which branches were taken, useful for debugging and downstream conditional logic.

### Disabled Propagation

When a branch is not taken, its output port is empty. The graph runner uses the `activeBranches` set to determine which outgoing dataflows should be marked as `DISABLED`, cascading the disabled status to downstream tasks that have no other active inputs. This means entire subgraphs connected to an inactive branch are cleanly skipped without error.

---

## Composition Patterns: Nesting Control Flow

The real power of this architecture emerges when you nest control flow tasks inside each other. Because every control flow task is a `Task`, and every `Task` can live inside a `GraphAsTask` subgraph, the combinations are unlimited.

### MapTask Inside WhileTask

Iterative refinement with parallel processing at each step:

```typescript
const workflow = new Workflow()
  .while({
    condition: (output) => output.avgScore < 0.95,
    maxIterations: 5,
  })
    .map({ concurrencyLimit: 10 })
      .refineDocument()
      .scoreQuality()
    .endMap()
    .computeAverageScore()
  .endWhile();
```

Each while iteration fans out across all documents in parallel, scores them, computes the average, and decides whether another refinement pass is needed.

### ReduceTask Inside MapTask

Per-element accumulation across a collection:

```typescript
const workflow = new Workflow()
  .map()
    .reduce({ initialValue: { summary: "" } })
      .processSection()
    .endReduce()
  .endMap();
```

For each element in the outer array, a reduce loop sequentially processes sub-elements.

### ConditionalTask with MapTask

Route arrays to different processing pipelines:

```typescript
const graph = new TaskGraph();
graph.addTask(classifier);
graph.addTask(conditionalRouter);
graph.addTask(premiumMapPipeline);   // MapTask for premium tier
graph.addTask(standardMapPipeline);  // MapTask for standard tier

graph.addDataflow(new Dataflow(classifier.id, "tier", conditionalRouter.id, "tier"));
graph.addDataflow(new Dataflow(conditionalRouter.id, "premium", premiumMapPipeline.id, "*"));
graph.addDataflow(new Dataflow(conditionalRouter.id, "standard", standardMapPipeline.id, "*"));
```

---

## Under the Hood: Why This Works

The key architectural insight is the separation between the **outer graph** (which remains a strict DAG) and the **inner execution** (which can repeat, branch, or recurse within a single node).

From the outer graph's perspective, a `WhileTask` that runs 47 iterations is no different from a `Task` that takes 47 seconds. It is a single node that transitions from `PENDING` to `PROCESSING` to `COMPLETED`. The iteration happens entirely within the `WhileTaskRunner.execute()` call, invisible to the parent graph's topological sort.

This design also preserves cacheability. A `GraphAsTask` with no children is cacheable by default. Iterator tasks are not cached at the iteration level (since each cloned subgraph is ephemeral), but the outer result can be cached if the task's `cacheable` flag is set. The output cache is threaded down through the runner hierarchy, so inner tasks can still benefit from caching.

Progress reporting composes hierarchically. Each `IteratorTaskRunner` maintains per-iteration progress arrays and computes weighted averages that bubble up through `emit("progress")`. A three-level nesting (WhileTask > MapTask > inner pipeline) produces progress messages that reflect the actual state at every level.

Abort signals also propagate downward. The parent graph's abort controller signal is passed to each subgraph run via `parentSignal`, and each cloned subgraph checks `signal.aborted` before starting a new iteration. Canceling a workflow cancels everything, at every level of nesting.

---

## Conclusion

Workglow's control flow tasks demonstrate that DAGs and loops are not incompatible -- they just live at different levels of the hierarchy. By treating an entire graph as a single task node, the framework creates a clean boundary between the acyclic structure that makes pipelines tractable and the iterative logic that makes them powerful.

`GraphAsTask` provides the foundation: hierarchical composition with dynamic schema inference. `IteratorTask` adds the iteration engine with input analysis, subgraph cloning, and concurrency management. `MapTask` and `ReduceTask` specialize it for parallel and sequential patterns. `WhileTask` brings conditional looping with safety limits. And `ConditionalTask` adds branching without subgraphs, using output port routing and disabled propagation.

Together, these five primitives can express any control flow pattern you need -- without ever breaking the DAG.
