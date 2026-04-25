<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Control Flow Tasks

## Overview

The Workglow task graph engine is not limited to simple linear pipelines. It provides a set of **control flow tasks** that enable looping, branching, subgraph composition, and parallel iteration within a DAG. These tasks extend the base `Task` class (or more commonly, the `GraphAsTask` compound task) and integrate with the `Workflow` builder for a fluent API.

Control flow tasks in the `@workglow/task-graph` package:

| Task              | Base Class     | Purpose                                              |
|-------------------|----------------|------------------------------------------------------|
| `GraphAsTask`     | `Task`         | Embed a subgraph as a single node                    |
| `MapTask`         | `IteratorTask` | Transform array inputs in parallel                   |
| `ReduceTask`      | `IteratorTask` | Sequentially accumulate over array inputs            |
| `WhileTask`       | `GraphAsTask`  | Loop until a condition returns false                 |
| `ConditionalTask` | `Task`         | Branch execution based on conditions                 |
| `IteratorTask`    | `GraphAsTask`  | Abstract base for MapTask and ReduceTask             |

The inheritance hierarchy is:

```
Task
  |-- GraphAsTask
  |     |-- IteratorTask (abstract)
  |     |     |-- MapTask
  |     |     |-- ReduceTask
  |     |-- WhileTask
  |-- ConditionalTask
```

All control flow tasks (except ConditionalTask) contain an internal `TaskGraph` (subgraph) that defines the body of the loop or group. This subgraph is executed by a specialized runner (`GraphAsTaskRunner`, `IteratorTaskRunner`, or `WhileTaskRunner`) that knows how to propagate inputs, collect outputs, and manage iteration state.

---

## GraphAsTask: Subgraph Composition

### Purpose

`GraphAsTask` is the foundational compound task. It wraps an inner `TaskGraph` (subgraph) and presents it to the outer graph as a single node with dynamically computed input and output schemas.

### When to Use

- Encapsulate a reusable sub-pipeline as a single node
- Organize complex graphs hierarchically
- Create custom compound tasks with specific input/output contracts

### Dynamic Schemas

Unlike simple tasks that declare schemas statically, `GraphAsTask` computes its schemas from the subgraph at runtime:

- **Input schema**: Collected from root tasks (no incoming dataflows) in the subgraph, plus required properties from non-root tasks that are not satisfied by internal dataflows.
- **Output schema**: Collected from ending nodes (no outgoing dataflows) in the subgraph.

Because schemas depend on the subgraph structure, `GraphAsTask` sets `hasDynamicSchemas = true` and emits `"regenerate"` events when the subgraph changes.

### Execution Flow

```
GraphAsTask.run(input)
  |
  v
GraphAsTaskRunner.executeTask(input)
  |
  v
executeTaskChildren(input)
  |
  v
subGraph.run(input, { parentSignal })
  |
  v
mergeExecuteOutputsToRunOutput()
  |
  v
Return merged output from ending nodes
```

### Reactive Execution

```
GraphAsTask.runReactive(input)
  |
  v
GraphAsTaskRunner.executeTaskReactive(input, output)
  |
  v
subGraph.runReactive(this.task.runInputData)
  |
  v
mergeExecuteOutputsToRunOutput()
```

**Critical**: The parent's `runInputData` is passed to `subGraph.runReactive()` so that root tasks in the subgraph (like InputTask) receive the correct input values.

### Compound Merge Strategies

When the subgraph has multiple ending nodes, their outputs are merged using a `CompoundMergeStrategy`:

| Strategy             | Behavior                                                          |
|----------------------|-------------------------------------------------------------------|
| `PROPERTY_ARRAY`     | Consolidate each property; duplicate keys become arrays           |
| `GRAPH_RESULT_ARRAY` | Return an array of `{ id, type, data }` objects per ending node  |

### Streaming Pass-Through

`GraphAsTask` supports streaming pass-through. When the subgraph contains streaming tasks at its leaf nodes, the `executeStream()` method forwards `StreamEvent` chunks from those nodes to the outer graph:

```typescript
async *executeStream(input, context): AsyncIterable<StreamEvent<Output>> {
  // Forward upstream input streams (if this GraphAsTask is downstream of a streamer)
  if (context.inputStreams) {
    for (const [, stream] of context.inputStreams) { /* yield events */ }
  }
  // Run subgraph and forward streaming events from ending nodes
  if (this.hasChildren()) {
    // Subscribe to task streaming on ending nodes, yield chunks
    // Wait for subgraph.run() to complete
    // Yield final "finish" event with merged output
  }
}
```

### Workflow API

```typescript
const workflow = new Workflow()
  .group()                    // Start a GraphAsTask subgraph
    .addTask(taskA)
    .pipe(taskB)
  .endGroup()                 // Close the group
  .pipe(taskC);               // Continue in parent context
```

### Configuration

```typescript
interface GraphAsTaskConfig extends TaskConfig {
  subGraph?: TaskGraph;                    // Pre-built subgraph
  compoundMerge?: CompoundMergeStrategy;   // Output merge strategy
}
```

---

## MapTask: Array Parallelism

### Purpose

`MapTask` transforms one or more array inputs by running a subgraph workflow for each element (or each index across parallel arrays). It is the task-graph equivalent of `Array.prototype.map()` -- each iteration runs independently and results are collected into output arrays.

### How It Works

1. Input arrays are analyzed to determine which ports are iterated ("array ports") and which are passed as constants ("scalar ports").
2. The subgraph is run once per iteration index, with each iteration receiving:
   - The i-th element from each array port
   - The full value from each scalar port
   - Iteration context (`_iterationIndex`, `_iterationCount`)
3. Results from all iterations are collected and each output property becomes an array.

### Input Mode Detection

For each input property, the iteration mode is determined by this precedence:

1. **Explicit annotation**: `x-ui-iteration: true` or `x-ui-iteration: false` in the schema
2. **Schema inference**: If the schema type is `"array"`, it is iterated; if it has a concrete non-array type, it is scalar
3. **Runtime fallback**: If the value is an `Array`, it is iterated; otherwise scalar

All iterated arrays must have the same length (zip semantics). Mismatched lengths throw a `TaskConfigurationError`.

### Input Schema

MapTask wraps inner workflow input properties in a **flexible schema** `(T | T[])` by default, allowing each property to accept either a scalar (constant across iterations) or an array (one per iteration):

```typescript
// Inner workflow expects: { text: string }
// MapTask input becomes:  { text: string | string[] }
```

This can be overridden per-property:

```typescript
const mapTask = new MapTask({
  iterationInputConfig: {
    text: { mode: "array", baseSchema: { type: "string" } },
    language: { mode: "scalar", baseSchema: { type: "string" } },
  },
});
```

### Output Schema

Each output property from the inner workflow is wrapped in an array:

```typescript
// Inner workflow outputs: { result: string }
// MapTask output becomes: { result: string[] }
```

### Configuration

```typescript
interface MapTaskConfig extends IteratorTaskConfig {
  preserveOrder?: boolean;     // Keep results in input order (default: true)
  flatten?: boolean;           // Flatten nested arrays in results (default: false)
  concurrencyLimit?: number;   // Max concurrent iterations
  batchSize?: number;          // Items per batch
  maxIterations: IterationBound; // Required on the raw class; the fluent
                                 // Workflow builder defaults it to "unbounded".
}
```

### Workflow API

```typescript
const workflow = new Workflow()
  .map()                                  // maxIterations defaults to "unbounded"
    .addTask(new FetchUrlTask())
    .pipe(new ExtractTextTask())
  .endMap();                              // Close map loop

// Run with array input
const results = await workflow.run({
  url: ["https://a.com", "https://b.com", "https://c.com"],
});
// results.text = ["content of a", "content of b", "content of c"]
```

### Example: Parallel Processing with Concurrency Limit

```typescript
const workflow = new Workflow()
  .map({ concurrencyLimit: 3, maxIterations: "unbounded" }) // 3 concurrent + explicit unbounded
    .addTask(new TranslateTask())
  .endMap();

await workflow.run({
  text: ["Hello", "World", "Goodbye", "Thanks", "Welcome"],
  targetLanguage: "fr",  // Scalar: same for all iterations
});
```

### Empty Input Handling

When an array input is empty, MapTask returns an empty result with arrays for each output property:

```typescript
await workflow.run({ text: [] });
// Returns: { result: [] }
```

---

## ReduceTask: Sequential Accumulation

### Purpose

`ReduceTask` processes array inputs sequentially with an accumulator, equivalent to `Array.prototype.reduce()`. Each iteration receives the accumulated result from the previous iteration, enabling stateful computation across elements.

### How It Works

1. ReduceTask analyzes inputs the same way as MapTask (array ports vs scalar ports).
2. Iterations run **sequentially** (concurrencyLimit is forced to 1).
3. Each iteration receives:
   - The i-th element from each array port
   - Scalar port values
   - The current accumulator value
   - Iteration context (`_iterationIndex`, `_iterationCount`)
4. The output from each iteration replaces the accumulator.
5. The final accumulator is returned as the task output.

### Configuration

```typescript
interface ReduceTaskConfig extends IteratorTaskConfig {
  initialValue?: unknown;          // Starting value for the accumulator
  maxIterations: IterationBound;   // Required on the raw class; the fluent
                                   // Workflow builder defaults it to "unbounded".
}
```

### Output Schema

Unlike MapTask, ReduceTask does **not** wrap output properties in arrays. The output schema matches the inner workflow's ending nodes directly, since the final result is the last accumulator value.

### Workflow API

```typescript
const workflow = new Workflow()
  .reduce({ initialValue: { total: 0 } })      // maxIterations defaults to "unbounded"
    .addTask(new SumTask())
  .endReduce();

await workflow.run({
  values: [10, 20, 30],
});
// Returns: { total: 60 }
```

### Example: Text Concatenation

```typescript
const workflow = new Workflow()
  .reduce({ initialValue: { summary: "" }, maxIterations: "unbounded" })
    .addTask(new AppendSummaryTask())
  .endReduce();

await workflow.run({
  paragraphs: ["First paragraph.", "Second paragraph.", "Conclusion."],
});
// Returns: { summary: "First paragraph. Second paragraph. Conclusion." }
```

---

## WhileTask: Conditional Loops

### Purpose

`WhileTask` repeatedly executes its subgraph until a condition function returns `false` or a maximum iteration count is reached. Unlike MapTask and ReduceTask which iterate over arrays, WhileTask implements open-ended looping with a termination condition.

### Use Cases

- Iterative refinement (improve quality until a threshold is met)
- Polling until a condition is satisfied
- Convergence algorithms
- Retry logic with conditions

### How It Works

1. The condition function is evaluated after each iteration.
2. If `chainIterations` is true (default), the output from each iteration is merged into the input for the next iteration.
3. Execution continues until:
   - The condition returns `false`, OR
   - `maxIterations` is reached, OR
   - The abort signal is triggered

### Condition Functions

Conditions can be provided as functions or as serializable field/operator/value triples:

```typescript
// Function-based condition
const whileTask = new WhileTask({
  condition: (output, iteration) => output.quality < 0.9 && iteration < 10,
  maxIterations: 20,
});

// Serializable condition (for builder UIs)
const whileTask = new WhileTask({
  conditionField: "quality",
  conditionOperator: "lt",
  conditionValue: "0.9",
  maxIterations: 20,
});
```

### Iteration Context

WhileTask injects an `_iterationIndex` property into each iteration's input. Unlike MapTask/ReduceTask, it does not provide `_iterationCount` because the total number of iterations is unknown ahead of time.

### Configuration

```typescript
interface WhileTaskConfig extends GraphAsTaskConfig {
  condition?: (output: Output, iteration: number) => boolean;
  maxIterations: IterationBound; // Required on the raw class; the fluent
                                 // Workflow builder defaults it to "unbounded".
  chainIterations?: boolean;     // Pass output as next input (default: true)
  conditionField?: string;       // Serializable: field to check
  conditionOperator?: string;    // Serializable: comparison operator
  conditionValue?: string;       // Serializable: value to compare against
}
```

### Output Schema

WhileTask returns the final iteration's output, plus an `_iterations` metadata field:

```typescript
{
  _iterations: 7,          // Number of iterations executed
  quality: 0.95,           // From the final iteration's output
  result: "refined text",  // From the final iteration's output
}
```

### Workflow API

```typescript
const workflow = new Workflow()
  .while({
    condition: (output, iteration) => output.quality < 0.9,
    maxIterations: 10,
  })
    .addTask(new RefineTask())
    .pipe(new EvaluateQualityTask())
  .endWhile();

const result = await workflow.run({ text: "draft content" });
// result.quality >= 0.9 (or maxIterations reached)
```

### Array Decomposition

WhileTask also supports array decomposition via `iterationInputConfig`, allowing it to iterate over arrays while also checking a loop condition:

```typescript
const whileTask = new WhileTask({
  condition: (output) => !output.allProcessed,
  maxIterations: 100,
  iterationInputConfig: {
    items: { mode: "array" },
  },
});
```

When array inputs are present, the effective max iterations is `min(maxIterations, arrayLength)`.

---

## ConditionalTask: Branching

### Purpose

`ConditionalTask` evaluates conditions against its input and selectively routes data to different output ports. It implements if/else and switch/case semantics within the task graph, enabling conditional execution paths.

### How It Works

1. Branches are defined with an `id`, a `condition` function, and an `outputPort` name.
2. During execution, each branch's condition is evaluated against the input.
3. Active branches receive the input data on their output port; inactive branches receive nothing.
4. Downstream dataflows connected to inactive branches are set to `DISABLED` status, which cascades to downstream tasks.

### Execution Modes

#### Exclusive Mode (default)

In exclusive mode (`exclusive: true`), branches are evaluated in order and only the **first matching branch** activates. This is equivalent to a switch/case or if/else-if chain:

```typescript
const router = new ConditionalTask({
  branches: [
    { id: "high", condition: (i) => i.value > 100, outputPort: "highPath" },
    { id: "medium", condition: (i) => i.value > 50, outputPort: "mediumPath" },
    { id: "low", condition: (i) => i.value <= 50, outputPort: "lowPath" },
  ],
  exclusive: true,
  defaultBranch: "low",
});
```

#### Multi-Path Mode

In multi-path mode (`exclusive: false`), **all branches** whose conditions evaluate to true become active simultaneously. This enables fan-out patterns:

```typescript
const fanOut = new ConditionalTask({
  branches: [
    { id: "log", condition: () => true, outputPort: "logger" },
    { id: "notify", condition: (i) => i.priority === "high", outputPort: "notifier" },
    { id: "archive", condition: (i) => i.shouldArchive, outputPort: "archiver" },
  ],
  exclusive: false,
});
```

### Default Branch

When no branch condition matches, the `defaultBranch` option activates a fallback:

```typescript
const router = new ConditionalTask({
  branches: [
    { id: "premium", condition: (i) => i.tier === "premium", outputPort: "premium" },
    { id: "standard", condition: (i) => i.tier === "standard", outputPort: "standard" },
  ],
  defaultBranch: "standard",  // Activated when tier is neither "premium" nor "standard"
});
```

### Dynamic Output Schema

ConditionalTask generates its output schema dynamically based on configured branches. Each branch adds an object-typed property to the output schema:

```typescript
// With two branches configured:
{
  type: "object",
  properties: {
    _activeBranches: { type: "array", items: { type: "string" } },
    highPath: { type: "object", additionalProperties: true },
    lowPath: { type: "object", additionalProperties: true },
  }
}
```

### Querying Branch State

After execution, you can inspect which branches were taken:

```typescript
await conditionalTask.run({ value: 150 });

conditionalTask.isBranchActive("high");       // true
conditionalTask.getActiveBranches();           // Set { "high" }
conditionalTask.getPortActiveStatus();         // Map { "highPath" => true, "lowPath" => false }
```

### Serializable Conditions (UI Builder)

For visual builder UIs where conditions cannot be JavaScript functions, ConditionalTask supports a `conditionConfig` object:

```typescript
const router = new ConditionalTask({
  conditionConfig: {
    branches: [
      { id: "high", field: "value", operator: "gt", value: "100" },
      { id: "low", field: "value", operator: "lte", value: "100" },
    ],
    exclusive: true,
  },
});
```

---

## Iteration Context

Both `MapTask`/`ReduceTask` (via `IteratorTask`) and `WhileTask` inject iteration metadata into the subgraph input on each iteration.

### IteratorTask Context (MapTask, ReduceTask)

```typescript
{
  _iterationIndex: 3,    // Current iteration (0-based)
  _iterationCount: 10,   // Total number of iterations
}
```

Properties are annotated with `"x-ui-iteration": true` so the builder UI can hide them from the parent-level display.

### WhileTask Context

```typescript
{
  _iterationIndex: 3,    // Current iteration (0-based)
  // No _iterationCount -- total is unknown ahead of time
}
```

### Accessing Context in Inner Tasks

Tasks inside a loop subgraph can access iteration context through their normal input ports. If the inner workflow's root task has matching input properties, they are populated automatically:

```typescript
class MyInnerTask extends Task<{ text: string; _iterationIndex: number }, { result: string }> {
  async execute(input) {
    console.log(`Processing item ${input._iterationIndex}`);
    return { result: input.text.toUpperCase() };
  }
}
```

---

## Nesting Patterns

Control flow tasks can be nested to build complex execution structures.

### Nested Map Inside While

```typescript
const workflow = new Workflow()
  .while({
    condition: (output) => output.needsMoreData,
    maxIterations: 5,
  })
    .map({ concurrencyLimit: 3, maxIterations: "unbounded" })
      .addTask(new FetchTask())
    .endMap()
    .addTask(new AggregateTask())
    .pipe(new EvaluateTask())
  .endWhile();
```

### Conditional Inside Map

```typescript
const workflow = new Workflow()
  .map({ maxIterations: "unbounded" })
    .addTask(new ClassifyTask())
    .pipe(new ConditionalTask({
      branches: [
        { id: "text", condition: (i) => i.type === "text", outputPort: "textPath" },
        { id: "image", condition: (i) => i.type === "image", outputPort: "imagePath" },
      ],
    }))
  .endMap();
```

### Group Inside Group

```typescript
const workflow = new Workflow()
  .group()
    .addTask(new PrepareTask())
    .group()
      .addTask(new InnerTaskA())
      .pipe(new InnerTaskB())
    .endGroup()
    .pipe(new FinalizeTask())
  .endGroup();
```

---

## API Reference

### GraphAsTask

```typescript
class GraphAsTask<Input, Output, Config> extends Task<Input, Output, Config> {
  static type: "GraphAsTask";
  static category: "Flow Control";
  static compoundMerge: CompoundMergeStrategy;
  static hasDynamicSchemas: true;

  subGraph: TaskGraph;                              // The inner graph
  compoundMerge: CompoundMergeStrategy;             // How to merge ending-node outputs
  hasChildren(): boolean;                           // Whether subgraph has tasks
  regenerateGraph(): void;                          // Invalidate cached schemas
  inputSchema(): DataPortSchema;                    // Computed from subgraph roots
  outputSchema(): DataPortSchema;                   // Computed from subgraph leaves
  entitlements(): TaskEntitlements;                  // Aggregated from child tasks
  executeStream(input, context): AsyncIterable<StreamEvent>; // Streaming pass-through
}
```

### MapTask

```typescript
class MapTask<Input, Output, Config> extends IteratorTask<Input, Output, Config> {
  static type: "MapTask";
  static category: "Flow Control";
  static compoundMerge: typeof PROPERTY_ARRAY;

  preserveOrder: boolean;                           // Default: true
  flatten: boolean;                                 // Default: false
  getEmptyResult(): Output;                         // Empty arrays per output port
  collectResults(results: TaskOutput[]): Output;    // Merge + optional flatten
}
```

### ReduceTask

```typescript
class ReduceTask<Input, Output, Config> extends IteratorTask<Input, Output, Config> {
  static type: "ReduceTask";
  static category: "Flow Control";

  initialValue: Output;                             // Starting accumulator
  isReduceTask(): true;
  getInitialAccumulator(): Output;                  // Clone of initialValue
  getEmptyResult(): Output;                         // Returns initialValue
}
```

### IteratorTask (Abstract Base)

```typescript
abstract class IteratorTask<Input, Output, Config> extends GraphAsTask<Input, Output, Config> {
  static type: "IteratorTask";

  concurrencyLimit?: number;                        // Max concurrent iterations
  batchSize?: number;                               // Batch grouping size
  iterationInputConfig?: Record<string, IterationPropertyConfig>;

  analyzeIterationInput(input): IterationAnalysisResult;
  getIterationInputSchema(): DataPortSchema;
  setPropertyInputMode(name, mode, baseSchema?): void;
  buildIterationRunInput(analysis, index, count, extra?): Record<string, unknown>;
  collectResults(results: TaskOutput[]): Output;
  getEmptyResult(): Output;
}
```

### WhileTask

```typescript
class WhileTask<Input, Output, Config> extends GraphAsTask<Input, Output, Config> {
  static type: "WhileTask";
  static category: "Flow Control";

  condition?: WhileConditionFn<Output>;             // Loop condition
  maxIterations: IterationBound;                    // REQUIRED — number | "unbounded"
  chainIterations: boolean;                         // Default: true
  currentIteration: number;                         // Read-only counter

  execute(input, context): Promise<Output>;         // Runs the loop
  executeStream(input, context): AsyncIterable<StreamEvent<Output>>;
  getIterationContextSchema(): DataPortSchema;
  getChainedOutputSchema(): DataPortSchema | undefined;
}
```

### ConditionalTask

```typescript
class ConditionalTask<Input, Output, Config> extends Task<Input, Output, Config> {
  static type: "ConditionalTask";
  static category: "Flow Control";
  static hasDynamicSchemas: true;

  activeBranches: Set<string>;                      // Populated after execute()
  isBranchActive(branchId: string): boolean;
  getActiveBranches(): Set<string>;
  getPortActiveStatus(): Map<string, boolean>;

  execute(input, context): Promise<Output>;         // Evaluate conditions
  inputSchema(): DataPortSchema;                    // Accepts any object
  outputSchema(): DataPortSchema;                   // Dynamic per branch config
}
```

### Key Types

```typescript
type CompoundMergeStrategy = "PROPERTY_ARRAY" | "GRAPH_RESULT_ARRAY";

type ExecutionMode = "parallel" | "parallel-limited";

type IterationInputMode = "array" | "scalar" | "flexible";

interface IterationPropertyConfig {
  readonly baseSchema: PropertySchema;
  readonly mode: IterationInputMode;
}

interface IterationAnalysisResult {
  readonly iterationCount: number;
  readonly arrayPorts: string[];
  readonly scalarPorts: string[];
  getIterationInput(index: number): Record<string, unknown>;
}

type ConditionFn<Input> = (input: Input) => boolean;

type WhileConditionFn<Output> = (output: Output, iteration: number) => boolean;

interface BranchConfig<Input> {
  readonly id: string;
  readonly condition: ConditionFn<Input>;
  readonly outputPort: string;
}
```
