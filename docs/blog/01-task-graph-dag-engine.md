<!--
  @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Inside the Engine Room: How Workglow's Task Graph Turns DAGs into Data Pipelines

You have a dozen AI tasks. Some depend on each other. Some can run in parallel. Data flows from one to the next, gets transformed, branched, merged, cached. You need it all to be type-safe, observable, abortable, and fast.

How do you model that?

If you said "a directed acyclic graph," congratulations -- you have independently reinvented the same abstraction that powers everything from `make` to Apache Airflow to modern GPU shader compilers. But knowing the right data structure is only the first step. The devil is in the execution model, the lifecycle semantics, and the way data actually moves between nodes.

This post is a deep dive into `@workglow/task-graph`, the core engine of the Workglow framework. We will walk through why DAGs are the right abstraction, how tasks are defined, how the engine schedules and executes them, how data flows through typed ports, and why immutability after completion is not just a nice idea but a load-bearing invariant.

---

## Why DAGs? The Case for Directed Acyclic Graphs

A data pipeline is fundamentally a dependency problem. Task B needs the output of Task A. Task C needs the output of both A and B. Task D only needs C. You cannot run B before A finishes, but you absolutely can run A and some unrelated Task E at the same time.

This is a partial order, and the natural way to represent a partial order is a directed acyclic graph. Each node is a task. Each edge says "this task's output feeds into that task's input." The "acyclic" constraint is not arbitrary -- it means the pipeline is guaranteed to terminate. There is no way to get stuck in an infinite loop of mutual dependencies.

Workglow's `TaskGraph` class wraps a `DirectedAcyclicGraph` from `@workglow/util/graph`:

```typescript
class TaskGraphDAG extends DirectedAcyclicGraph<
  ITask<any, any, any>,
  Dataflow,
  TaskIdType,
  DataflowIdType
> {
  constructor() {
    super(
      (task: ITask<any, any, any>) => task.id,
      (dataflow: Dataflow) => dataflow.id
    );
  }
}
```

The DAG is parameterized over nodes (tasks) and edges (dataflows). Node identity comes from `task.id`; edge identity comes from a composite string like `"task1[output] ==> task2[input]"`. The underlying graph structure enforces acyclicity at insertion time -- try to add an edge that creates a cycle and you get an error, not a deadlock at runtime.

This is not just theory. The DAG structure gives us two things for free: **topological sorting** (a linear ordering of nodes that respects all edges) and **dependency analysis** (which nodes are ready to execute right now). Both are essential to the execution model.

---

## The Task Abstraction: Anatomy of a Pipeline Node

Every node in the graph is a `Task`. Here is the contract: you subclass `Task`, declare some static metadata, define your input and output schemas, and implement `execute()`. The framework handles everything else -- lifecycle management, input validation, caching, progress reporting, abort signals, telemetry.

Here is a real task from the codebase, slightly simplified for clarity:

```typescript
class DelayTask extends Task<DelayTaskInput, DelayTaskOutput, DelayTaskConfig> {
  static override readonly type = "DelayTask";
  static override readonly category = "Utility";
  static override readonly cacheable = false;

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const satisfies DataPortSchema;
  }

  override async execute(
    input: DelayTaskInput,
    context: IExecuteContext
  ): Promise<DelayTaskOutput> {
    const delay = this.config.delay ?? 1;
    await sleep(delay);
    return input as unknown as DelayTaskOutput;
  }
}
```

Notice several things. The `type` and `category` are static -- they describe the class, not the instance. The schemas are also static methods returning JSON Schema objects. And the `execute()` method receives a context object that includes an `AbortSignal`, a progress callback, a service registry, and an `own()` function for spawning child tasks.

The static properties matter because they enable the `TaskRegistry` -- a global class registry that lets the framework reconstruct tasks from serialized JSON without knowing the concrete class at import time. When a graph is loaded from storage, the registry maps `"DelayTask"` back to the `DelayTask` constructor.

---

## Topological Execution: Walking the Graph in Dependency Order

When you call `graph.run()`, the engine does not just iterate over tasks in the order you added them. It performs a topological sort and executes tasks in dependency order, using one of two schedulers.

The **TopologicalScheduler** is the simple one. It computes a full topological ordering up front and yields tasks one at a time, sequentially:

```typescript
class TopologicalScheduler implements ITaskGraphScheduler {
  async *tasks(): AsyncIterableIterator<ITask> {
    while (this.currentIndex < this.sortedNodes.length) {
      yield this.sortedNodes[this.currentIndex++];
    }
  }
}
```

This is useful for debugging and for reactive mode (more on that later), where you want deterministic, sequential propagation.

The **DependencyBasedScheduler** is the production workhorse. Instead of pre-computing a fixed order, it maintains a set of pending tasks and yields each one the moment all its dependencies are satisfied:

```typescript
class DependencyBasedScheduler implements ITaskGraphScheduler {
  private isTaskReady(task: ITask): boolean {
    const sourceDataflows = this.dag.getSourceDataflows(task.id);
    const activeDataflows = sourceDataflows.filter(
      (df) => df.status !== TaskStatus.DISABLED
    );
    return activeDataflows.every((df) => {
      return this.completedTasks.has(df.sourceTaskId);
    });
  }
}
```

This is event-driven. When a task completes, the scheduler checks whether any pending tasks just became ready. If so, it yields them immediately. The graph runner does not `await` each task before starting the next -- it fires off ready tasks in parallel and tracks their promises:

```typescript
for await (const task of this.processScheduler.tasks()) {
  const runAsync = async () => {
    const taskPromise = this.runTask(task, taskInput);
    this.inProgressTasks.set(task.id, taskPromise);
    await taskPromise;
    // ... push output, notify scheduler
    this.processScheduler.onTaskCompleted(task.id);
  };
  this.inProgressFunctions.set(Symbol(task.id as string), runAsync());
}
```

The result is maximum parallelism. If your graph has three independent branches, all three run concurrently. If two tasks share a dependency, they both start the instant that dependency completes. The scheduler adapts to the shape of your graph automatically.

---

## Task Lifecycle: Why Immutability After Completion Matters

Every task moves through a well-defined state machine:

```
PENDING --> PROCESSING --> COMPLETED
                      \-> FAILED
                      \-> ABORTING
```

(There is also a `STREAMING` state for tasks that produce incremental output, and a `DISABLED` state for tasks on inactive conditional branches, but the core flow is the one above.)

The critical invariant is this: **once a task reaches `COMPLETED`, its output is locked and immutable.** This is not just a convention. The entire execution model depends on it.

Here is why. Consider reactive mode. Workglow supports a lightweight `runReactive()` pass that propagates changes through the graph without doing heavy computation -- think of it as a preview pass for UI updates. During reactive execution, the engine skips completed tasks entirely:

```typescript
if (task.status === TaskStatus.PENDING) {
  task.resetInputData();
  this.copyInputFromEdgesToNode(task);
}
// COMPLETED tasks: output is locked, skip input modification
```

If completed tasks were mutable, reactive mode would be a minefield. You would have to reason about whether a downstream task's input is stale, whether re-running a completed task produces the same output, whether the cache is still valid. By making completion irreversible, the engine can treat completed output as a fact -- something that will not change for the lifetime of this graph run.

The `handleComplete()` method in `TaskRunner` marks the transition:

```typescript
protected async handleComplete(): Promise<void> {
  this.task.completedAt = new Date();
  this.task.progress = 100;
  this.task.status = TaskStatus.COMPLETED;
  this.task.emit("complete");
  this.task.emit("status", this.task.status);
}
```

After this point, the task's `runOutputData` is the canonical result. The cache (if enabled) has already stored it. Downstream tasks can rely on it unconditionally.

---

## Dataflows as Edges: The Wiring Between Tasks

In most pipeline frameworks, the edge between two nodes is implicit -- "this task depends on that task." In Workglow, edges are explicit, first-class objects called `Dataflow`s, and they carry port-level routing information:

```typescript
new Dataflow("task1", "result", "task2", "value")
```

This says: take the `result` property from task1's output and deliver it as the `value` property of task2's input. The Dataflow knows its source task, source port, target task, and target port. Its identity is a composite string:

```
"task1[result] ==> task2[value]"
```

When the graph runner executes a task, it performs two data-movement steps:

1. **Before execution:** `copyInputFromEdgesToNode()` pulls data from all incoming dataflows into the task's `runInputData`.
2. **After execution:** `pushOutputFromNodeToEdges()` writes the task's output into all outgoing dataflows.

The `setPortData` and `getPortData` methods on `Dataflow` handle the port-level extraction:

```typescript
setPortData(entireDataBlock: any) {
  if (this.sourceTaskPortId === DATAFLOW_ALL_PORTS) {
    this.value = entireDataBlock;
  } else {
    this.value = entireDataBlock[this.sourceTaskPortId];
  }
}

getPortData(): TaskOutput {
  if (this.targetTaskPortId === DATAFLOW_ALL_PORTS) {
    return this.value;
  }
  return { [this.targetTaskPortId]: this.value };
}
```

There is also a special wildcard port, `"*"` (`DATAFLOW_ALL_PORTS`), that passes the entire output object through without extracting a specific property. This is used by the `Workflow` builder for convenient chaining when port names match between tasks.

Dataflows also carry status, mirroring the lifecycle of their source task. This matters for conditional execution: when a `ConditionalTask` completes, it marks active-branch dataflows as `COMPLETED` and inactive-branch dataflows as `DISABLED`. The `DependencyBasedScheduler` treats disabled dataflows as "satisfied," and `propagateDisabledStatus()` cascades the disabled state through the downstream subgraph.

---

## Schema-Driven I/O: JSON Schema as the Source of Truth

Workglow does not just use JSON Schema for documentation. The schemas defined on task classes are the source of truth for validation, type inference, semantic compatibility checking, and UI rendering.

Every task declares its `inputSchema()` and `outputSchema()` as static methods returning JSON Schema objects:

```typescript
static inputSchema(): DataPortSchema {
  return {
    type: "object",
    properties: {
      query: { type: "string", title: "Search Query" },
      model: { type: "string", format: "model:EmbeddingTask" },
      limit: { type: "number", default: 10 },
    },
    required: ["query"],
    additionalProperties: false,
  } as const satisfies DataPortSchema;
}
```

Several things happen with these schemas at different stages:

**At construction time**, default values from the schema populate the task's `defaults` object. If a property has `"default": 10`, the task starts with that value in its input.

**At validation time**, the `TaskRunner` validates the resolved input against the schema before calling `execute()`. Invalid input throws a `TaskInvalidInputError` rather than letting garbage propagate through the pipeline.

**At wiring time**, the engine checks semantic compatibility between connected ports. When you connect task A's output port to task B's input port, the `semanticallyCompatible()` method on the `Dataflow` compares the source and target schemas. This catches type mismatches early -- before execution, not after.

**At resolution time**, schema `format` annotations trigger automatic lookups. A property with `format: "model:EmbeddingTask"` tells the engine to resolve a string model name into an actual model instance from the `ModelRegistry`. A property with `format: "storage:tabular"` resolves to a storage backend. This happens transparently in `resolveSchemaInputs()`, so the `execute()` method receives fully resolved objects, not raw string identifiers.

The `as const satisfies DataPortSchema` pattern is worth calling out. The `as const` preserves literal types in the schema (so TypeScript knows the property is `"string"`, not just `string`), while `satisfies` ensures the schema object conforms to the `DataPortSchema` type without widening it. This gives you both type-safety at the schema level and precise type inference when deriving input/output types with `FromSchema<typeof schema>`.

---

## Putting It All Together: A Complete Example

Here is how you build and run a simple three-node pipeline:

```typescript
import { TaskGraph, Dataflow, Task, TaskStatus } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";

// Define a task that passes its input through with a transformation
class UpperCaseTask extends Task<
  { text: string },
  { text: string }
> {
  static override readonly type = "UpperCaseTask";
  static override readonly category = "Text";
  static override readonly cacheable = true;

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string" },
      },
    } as const satisfies DataPortSchema;
  }

  override async execute(input: { text: string }): Promise<{ text: string }> {
    return { text: input.text.toUpperCase() };
  }
}

// Build the graph
const graph = new TaskGraph();

const inputTask = new InputTask({ id: "input" });
const upper = new UpperCaseTask({ id: "upper" });
const outputTask = new OutputTask({ id: "output" });

graph.addTasks([inputTask, upper, outputTask]);
graph.addDataflows([
  new Dataflow("input", "text", "upper", "text"),
  new Dataflow("upper", "text", "output", "text"),
]);

// Run it
const results = await graph.run({ text: "hello world" });
// results[0].data => { text: "HELLO WORLD" }
```

Or, if you prefer the high-level `Workflow` builder:

```typescript
const workflow = new Workflow();
workflow.InputTask({ id: "input" });
workflow.UpperCaseTask({ id: "upper" });
workflow.OutputTask({ id: "output" });
const result = await workflow.run({ text: "hello world" });
```

The `Workflow` class automatically creates `*`-port dataflows between consecutively added tasks, so you do not need to wire them manually for simple linear pipelines.

---

## The Two Execution Modes: Run vs. Reactive

One last architectural point worth understanding. Workglow has two fundamentally different execution modes on the same graph:

**`run()`** is the full execution path. It calls `execute()` on each task, produces cached and immutable results, and transitions tasks to `COMPLETED`. This is what you use for production pipeline runs.

**`runReactive()`** is the lightweight preview path. It calls `executeReactive()` instead of `execute()`, does not change task status (a `PENDING` task stays `PENDING`), and only propagates through tasks that have not yet completed. This is designed for UI scenarios where a user edits an input and you want to show a fast preview of the downstream effects without committing to a full run.

| Aspect             | `run()`           | `runReactive()`      |
|--------------------|-------------------|----------------------|
| Method called      | `execute()`       | `executeReactive()`  |
| Final status       | COMPLETED         | Unchanged            |
| Output             | Locked/cached     | Temporary            |
| Dataflow updates   | Always            | Only PENDING tasks   |
| Performance target | Unbounded         | < 1ms per task       |

The reactive path uses the `TopologicalScheduler` (sequential, deterministic), while the full path uses the `DependencyBasedScheduler` (parallel, event-driven). Both walk the same graph; they just have different semantics about what happens at each node.

---

## Conclusion

The `@workglow/task-graph` engine is a study in layered abstractions. At the bottom, a `DirectedAcyclicGraph` enforces structure. On top of that, `Task` defines the execution contract and lifecycle. `Dataflow` handles port-level data routing. `TaskRunner` manages the lifecycle of a single task, while `TaskGraphRunner` orchestrates the entire graph with parallel scheduling, caching, streaming, abort propagation, and telemetry.

The key design decisions -- explicit dataflows instead of implicit dependencies, immutable output after completion, schema-driven validation and resolution, dual execution modes -- are not accidents. They are the result of building a system that needs to be simultaneously flexible enough for arbitrary AI pipelines and rigid enough to reason about correctness.

If you are building data pipelines, whether for AI workloads or anything else, the patterns here are worth studying. DAGs are one of those abstractions that, once you see them clearly, show up everywhere.
