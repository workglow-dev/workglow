# Task Graph Execution Model

This document explains the internal execution model of the task graph system. It is intended for developers (human or AI) who need to understand or modify the execution logic.

## Table of Contents

- [Overview](#overview)
- [Task Lifecycle](#task-lifecycle)
- [Normal Execution (run)](#normal-execution-run)
- [Reactive Execution (runReactive)](#reactive-execution-runreactive)
- [Dataflow and Input Propagation](#dataflow-and-input-propagation)
- [GraphAsTask (Subgraphs)](#graphastask-subgraphs)
- [Key Invariants](#key-invariants)
- [Common Pitfalls](#common-pitfalls)

---

## Overview

The task graph system has two execution modes:

1. **`run()`** - Full execution that produces cached, immutable results
2. **`runReactive()`** - Lightweight execution for UI updates and previews

These modes serve different purposes and have different semantics regarding task state and data flow.

---

## Task Lifecycle

### Task Statuses

```
PENDING → PROCESSING → COMPLETED
                    ↘ FAILED
                    ↘ ABORTED
```

| Status       | Description                                                         |
| ------------ | ------------------------------------------------------------------- |
| `PENDING`    | Task has not been executed yet. Inputs can be modified.             |
| `PROCESSING` | Task is currently executing.                                        |
| `COMPLETED`  | Task has finished successfully. **Output is locked and immutable.** |
| `FAILED`     | Task execution threw an error.                                      |
| `ABORTED`    | Task was cancelled via `abort()`.                                   |

### Key Properties

Each task maintains:

- `defaults` - Default input values set at construction time
- `runInputData` - The actual input used for execution (defaults + overrides)
- `runOutputData` - The output produced by execution
- `status` - Current lifecycle status

---

## Normal Execution (run)

### Purpose

Full execution that:

- Runs the task's `execute()` method
- Produces cached, deterministic results
- Transitions task to `COMPLETED` status
- Makes output immutable

### Flow

```
Task.run(overrides)
    ↓
TaskRunner.run(overrides)
    ↓
1. setInput(overrides)           # Merge overrides into runInputData
2. resolveSchemaInputs()         # Resolve model/repository strings to instances
3. validateInput()               # Validate against input schema
4. Check cache                   # If cacheable, check for cached result
5. executeTask()                 # Call task.execute(input, context)
6. Store in cache                # If cacheable, cache the result
7. handleComplete()              # Set status = COMPLETED
    ↓
Return runOutputData (locked)
```

### Graph-Level Execution

```
TaskGraph.run(input)
    ↓
TaskGraphRunner.runGraph(input)
    ↓
For each task (in topological order):
    1. copyInputFromEdgesToNode()  # Pull data from incoming dataflows
    2. runTask(task, input)        # Execute the task
    3. pushOutputFromNodeToEdges() # Push output to outgoing dataflows
    ↓
Return results from ending nodes (no outgoing dataflows)
```

---

## Reactive Execution (runReactive)

### Purpose

Lightweight execution for:

- UI previews and updates
- Fast transformations (e.g., image filters)
- Propagating intermediate results through PENDING tasks

**Important:** Reactive execution only affects `PENDING` tasks. `COMPLETED` tasks return their cached output unchanged.

### Use Case Example

```
User edits an InputNode default → Task is PENDING
    ↓
runReactive() is called
    ↓
InputTask (PENDING) receives new value
    ↓
Downstream tasks (PENDING) get reactive updates
    ↓
Tasks run their executeReactive() for quick previews
    ↓
Eventually run() is called → All tasks become COMPLETED (locked)
```

### Task-Level Flow

```
Task.runReactive(overrides)
    ↓
TaskRunner.runReactive(overrides)
    ↓
1. If status == PROCESSING: return existing output (no re-entry)
2. setInput(overrides)                    # Update runInputData
3. resolveSchemaInputs()                  # Resolve strings to instances
4. handleStartReactive()                  # Status → PROCESSING
5. validateInput()
6. executeTaskReactive(input, output)     # Call task.executeReactive()
7. runOutputData = merge(output, result)  # Merge with previous output
8. handleCompleteReactive()               # Status → back to previous
    ↓
Return runOutputData
```

### Graph-Level Flow

```
TaskGraph.runReactive(input)
    ↓
TaskGraphRunner.runGraphReactive(input)
    ↓
For each task (in topological order):
    ↓
    ┌─ If status == PENDING:
    │      resetInputData()              # Reset to defaults
    │      copyInputFromEdgesToNode()    # Pull from incoming dataflows
    └─ Else (COMPLETED):
           Skip input modification       # Output is locked
    ↓
    If isRootTask (no incoming dataflows):
        taskInput = input                # Pass graph input to root tasks
    Else:
        taskInput = {}
    ↓
    task.runReactive(taskInput)
    ↓
    pushOutputFromNodeToEdges()          # Push output to dataflows
    ↓
Return results from ending nodes
```

### The executeReactive Method

```typescript
// Default implementation - just returns existing output
async executeReactive(input, output, context): Promise<Output | undefined> {
    return output;
}

// Custom implementation for quick transformations
async executeReactive(input, output, context): Promise<Output | undefined> {
    // Lightweight operation (e.g., < 1ms)
    return { ...output, preview: this.quickTransform(input) };
}
```

---

## Dataflow and Input Propagation

### How Data Flows Between Tasks

```
TaskA (source)                    TaskB (target)
    ↓                                 ↓
outputSchema: {                  inputSchema: {
  result: number                   value: number
}                                }
    ↓                                 ↓
Dataflow("taskA", "result", "taskB", "value")
    ↓
TaskA.runOutputData.result → TaskB.runInputData.value
```

### Key Methods

| Method                                    | Purpose                                                          |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `copyInputFromEdgesToNode(task)`          | Pull data from all incoming dataflows into task's `runInputData` |
| `pushOutputFromNodeToEdges(task, output)` | Push task's output to all outgoing dataflows                     |
| `addInputData(task, data)`                | Merge data into task's `runInputData`                            |

### When Input is Copied

| Execution Mode  | Task Status | Input Copied?             |
| --------------- | ----------- | ------------------------- |
| `run()`         | Any         | Yes (always)              |
| `runReactive()` | PENDING     | Yes                       |
| `runReactive()` | COMPLETED   | **No** (output is locked) |

---

## GraphAsTask (Subgraphs)

### What is GraphAsTask?

A `GraphAsTask` is a task that contains an internal `TaskGraph` (subgraph). This enables:

- Hierarchical workflow composition
- Encapsulation of complex logic
- Reusable workflow components

### Execution Flow

```
GraphAsTask.run(input)
    ↓
GraphAsTaskRunner.executeTask(input)
    ↓
executeTaskChildren(input)
    ↓
subGraph.run(input)      # Execute the entire subgraph
    ↓
mergeExecuteOutputsToRunOutput()  # Combine results from ending nodes
```

### Reactive Execution with Subgraphs

```
GraphAsTask.runReactive(input)
    ↓
GraphAsTaskRunner.executeTaskReactive(input, output)
    ↓
executeTaskChildrenReactive()
    ↓
subGraph.runReactive(this.task.runInputData)  # ← IMPORTANT: Pass parent's input
    ↓
mergeExecuteOutputsToRunOutput()
```

**Critical:** The parent's `runInputData` is passed to `subGraph.runReactive()` so that root tasks in the subgraph (like InputTask) receive the input values.

### Root Task Input Propagation

In `runGraphReactive()`:

```typescript
const isRootTask = this.graph.getSourceDataflows(task.config.id).length === 0;

// For root tasks, pass the input parameter (from parent GraphAsTask)
const taskInput = isRootTask ? input : {};

const taskResult = await task.runReactive(taskInput);
```

This ensures:

1. Root tasks (no incoming dataflows) receive input from the parent
2. Non-root tasks receive input from their upstream dataflows

---

## Key Invariants

### 1. COMPLETED Tasks Are Immutable

Once a task's `run()` completes and status becomes `COMPLETED`:

- `runOutputData` is **locked** and **cacheable**
- `runInputData` should not be modified
- `runReactive()` returns the cached output unchanged

### 2. Only PENDING Tasks Receive Dataflow Updates in Reactive Mode

```typescript
if (task.status === TaskStatus.PENDING) {
  task.resetInputData();
  this.copyInputFromEdgesToNode(task);
}
```

### 3. Root Tasks Receive Parent Input

In subgraphs, root tasks (no incoming dataflows) receive the parent's input:

```typescript
const taskInput = isRootTask ? input : {};
task.runReactive(taskInput);
```

### 4. executeReactive is Lightweight

The `executeReactive()` method should:

- Complete quickly (< 1ms ideally)
- Not perform heavy computation
- Return UI preview data

Heavy computation belongs in `execute()`.

### 5. Reactive Execution Respects Task Order

Tasks are executed in topological order (via `reactiveScheduler`), ensuring:

- Upstream tasks run before downstream tasks
- Data is available when needed

---

## Common Pitfalls

### 1. Modifying COMPLETED Task Input

**Wrong:**

```typescript
// Trying to update a COMPLETED task's input
task.setInput({ newValue: 42 }); // ❌ Violates immutability
```

**Correct:**
Only modify input for PENDING tasks, or reset the entire graph first.

### 2. Missing Root Task Input Propagation

**Wrong:**

```typescript
protected async executeTaskChildrenReactive() {
    return this.task.subGraph!.runReactive();  // ❌ No input passed
}
```

**Correct:**

```typescript
protected async executeTaskChildrenReactive() {
    return this.task.subGraph!.runReactive(this.task.runInputData);  // ✓
}
```

### 3. Copying Input to COMPLETED Tasks

**Wrong:**

```typescript
// In runGraphReactive
this.copyInputFromEdgesToNode(task); // ❌ Always copies, even for COMPLETED
```

**Correct:**

```typescript
if (task.status === TaskStatus.PENDING) {
  task.resetInputData();
  this.copyInputFromEdgesToNode(task); // ✓ Only for PENDING
}
```

### 4. Heavy Computation in executeReactive

**Wrong:**

```typescript
async executeReactive(input, output) {
    // ❌ Takes 30 seconds
    const result = await this.trainNeuralNetwork(input);
    return { result };
}
```

**Correct:**

```typescript
async executeReactive(input, output) {
    // ✓ Quick preview (< 1ms)
    return { preview: this.quickPreview(input) };
}

async execute(input) {
    // Heavy work belongs here
    const result = await this.trainNeuralNetwork(input);
    return { result };
}
```

---

## Summary

| Aspect               | `run()`           | `runReactive()`     |
| -------------------- | ----------------- | ------------------- |
| **Purpose**          | Full execution    | UI previews         |
| **Method called**    | `execute()`       | `executeReactive()` |
| **Final status**     | COMPLETED         | Unchanged           |
| **Output**           | Locked/cached     | Temporary           |
| **Dataflow updates** | Always            | Only PENDING tasks  |
| **Performance**      | Can be slow       | Should be < 1ms     |
| **User edits**       | Before run starts | Before run starts   |

### Key Takeaways

1. Users only edit inputs on PENDING tasks
2. Once `run()` completes, the task is COMPLETED and immutable
3. `runReactive()` propagates lightweight updates through PENDING tasks
4. COMPLETED tasks return cached results in reactive mode
5. Root tasks in subgraphs receive input from the parent GraphAsTask
