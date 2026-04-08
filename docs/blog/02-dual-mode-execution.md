<!--
@license
Copyright 2025 Steven Roussey <sroussey@gmail.com>
SPDX-License-Identifier: Apache-2.0
-->

# Two Modes, One Pipeline: The Dual Execution Model Behind Workglow's Live Previews

You are building a visual pipeline editor. The user drags an "AI Summarize" node onto the canvas, wires it to a text input, types a few sentences, and -- before they even hit "Run" -- a preview of the summary appears in the output panel. They tweak the input. The preview updates instantly. Then they press Run, the real model fires, and the final result locks into place.

This is not a mockup. This is the actual execution model inside Workglow's `@workglow/task-graph` package, and it rests on a deceptively simple idea: every task has *two* ways to execute, and they serve fundamentally different purposes.

Let's talk about why, and how it works.

---

## The Problem: One Mode Is Not Enough

Most pipeline frameworks give you a single execution primitive. You call `run()`, the pipeline crunches through its nodes in dependency order, and you get your results. Simple. Clean. And completely inadequate for interactive applications.

Here is the tension. When a user is *designing* a pipeline -- connecting nodes, adjusting parameters, experimenting with configurations -- they need feedback. Not in five seconds. Not in one second. They need it *now*, at the speed of thought, at 60 frames per second. That means you have roughly 16 milliseconds per frame, and realistically your per-task budget is under 1 millisecond if you want the UI to stay buttery smooth.

But the actual work these tasks do -- calling an LLM, querying a vector database, training an embedding -- can take seconds or minutes. You cannot run the real `execute()` method every time someone moves a slider.

Some frameworks solve this with debouncing. Others punt and just show a spinner. Workglow does something more interesting: it gives every task two distinct execution methods with different contracts, different performance guarantees, and different effects on task state.

---

## Mode 1: `run()` -- Full Execution

The `run()` path is the heavyweight. This is where real computation happens. When you call `run()` on a task or a graph, here is the lifecycle:

```
PENDING --> PROCESSING --> COMPLETED
                      \-> FAILED
                      \-> ABORTED
```

The `TaskRunner.run()` method orchestrates this:

```typescript
async run(overrides: Partial<Input> = {}, config: IRunConfig = {}): Promise<Output> {
    await this.handleStart(config);

    try {
      this.task.setInput(overrides);

      // Resolve schema-annotated inputs (models, repositories)
      const schema = (this.task.constructor as typeof Task).inputSchema();
      this.task.runInputData = (await resolveSchemaInputs(
        this.task.runInputData as Record<string, unknown>,
        schema,
        { registry: this.registry }
      )) as Input;

      const inputs: Input = this.task.runInputData as Input;
      const isValid = await this.task.validateInput(inputs);
      if (!isValid) {
        throw new TaskInvalidInputError("Invalid input data");
      }

      let outputs: Output | undefined;

      if (this.task.cacheable) {
        outputs = (await this.outputCache?.getOutput(this.task.type, inputs)) as Output;
        // ... cache hit handling
      }
      if (!outputs) {
        outputs = await this.executeTask(inputs);
        if (this.task.cacheable && outputs !== undefined) {
          await this.outputCache?.saveOutput(this.task.type, inputs, outputs);
        }
        this.task.runOutputData = outputs ?? ({} as Output);
      }

      await this.handleComplete();
      return this.task.runOutputData as Output;
    } catch (err: any) {
      await this.handleError(err);
      throw err;
    }
}
```

There is a lot going on here, but the critical points are:

1. **Input resolution and validation.** Schema annotations like `format: "model"` or `format: "storage:tabular"` get resolved to actual runtime instances before execution starts.
2. **Caching.** If the task is marked `cacheable` (and most are by default), the runner checks for a cached result before doing any real work. Deterministic inputs yield deterministic outputs.
3. **State transition to COMPLETED.** Once `handleComplete()` fires, the task's status becomes `COMPLETED`, its output is locked, and its `progress` hits 100. This is a one-way door.

At the graph level, `TaskGraphRunner.runGraph()` uses a `DependencyBasedScheduler` that can run independent tasks in parallel. For each task, it pulls data from incoming dataflows, executes the task, and pushes output to outgoing dataflows:

```
For each task (in dependency order, parallel when possible):
    1. copyInputFromEdgesToNode(task)   // Pull data from upstream
    2. runTask(task, input)             // Execute the task
    3. pushOutputFromNodeToEdges(task)  // Push output downstream
```

This is deterministic, cacheable, and correct. It is also potentially slow -- and that is fine. `run()` is for when you mean it.

---

## Mode 2: `runReactive()` -- Lightweight Previews

Now for the interesting part. The `runReactive()` path exists for a completely different purpose: propagating *lightweight, temporary* updates through the graph while the user is still editing.

Here is the `TaskRunner.runReactive()` method, stripped to its essentials:

```typescript
public async runReactive(overrides: Partial<Input> = {}): Promise<Output> {
    if (this.task.status === TaskStatus.PROCESSING) {
      return this.task.runOutputData as Output;  // No re-entry
    }
    this.task.setInput(overrides);

    // Resolve schema-annotated inputs
    // ...

    await this.handleStartReactive();

    try {
      const inputs: Input = this.task.runInputData as Input;
      const isValid = await this.task.validateInput(inputs);
      if (!isValid) {
        throw new TaskInvalidInputError("Invalid input data");
      }

      const resultReactive = await this.executeTaskReactive(
        inputs,
        this.task.runOutputData as Output
      );

      this.task.runOutputData = resultReactive;

      await this.handleCompleteReactive();
    } catch (err: any) {
      await this.handleErrorReactive();
    } finally {
      return this.task.runOutputData as Output;
    }
}
```

Notice what is *not* happening here:

- **No status transition to COMPLETED.** The task stays at whatever status it was before. A `PENDING` task remains `PENDING`. The output is temporary.
- **No caching.** Reactive results are ephemeral -- they exist to show the user something useful, not to be stored for posterity.
- **No abort controller.** Reactive execution is expected to be so fast that cancellation infrastructure would be overhead.
- **Re-entry protection.** If the task is currently `PROCESSING` (a full `run()` is in flight), `runReactive()` just returns the current output and gets out of the way.

The actual reactive computation is delegated to the task's `executeReactive()` method:

```typescript
// Base implementation in Task -- just returns existing output
public async executeReactive(
    _input: Input,
    output: Output,
    _context: IExecuteReactiveContext
): Promise<Output | undefined> {
    return output;
}
```

That default implementation is the key insight. Most tasks do nothing special in reactive mode -- they just pass through whatever output they already have. But tasks that *can* produce a quick preview override this method.

---

## The Sub-1ms Constraint: What It Enables

The contract for `executeReactive()` is simple and non-negotiable: **it must complete in under 1 millisecond.**

This is not a soft guideline. It is a hard architectural constraint that enables the entire interactive editing experience. Here is why: if you have a graph of 15 tasks and the user types a character, `runGraphReactive()` walks the entire graph in topological order. At 1ms per task, that is 15ms for the full propagation -- just under one frame at 60fps. The UI stays responsive. The preview updates feel instant.

What kind of work fits in under 1ms? More than you might think:

**InputTask** -- the simplest case. It just passes input through as output:

```typescript
public override async executeReactive(input: InputTaskInput) {
    return input as InputTaskOutput;
}
```

**SplitTask** -- destructures an object into individual output ports. Pure data routing, no computation:

```typescript
override async executeReactive(input: Input): Promise<Output> {
    const inputValue = input.input;
    const output = {} as Output;
    if (Array.isArray(inputValue)) {
      inputValue.forEach((item, index) => {
        (output as any)[`output_${index}`] = item;
      });
    }
    // ...
    return output;
}
```

**DateFormatTask** -- formats a date string. A single `new Date()` call and a format operation:

```typescript
override async executeReactive(input: Input, _output: Output): Promise<Output> {
    const dateInput = /^\d+$/.test(input.value) ? Number(input.value) : input.value;
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${input.value}`);
    }
    // ... format and return
}
```

**JavaScriptTask** -- runs user-provided JavaScript in a sandboxed interpreter. Even interpretation of small scripts fits in the budget:

```typescript
override async executeReactive(input: JavaScriptTaskInput, output: JavaScriptTaskOutput) {
    const code = input.javascript_code || this.config.javascript_code;
    if (code) {
      const myInterpreter = new Interpreter(`${inputVariablesString} ${code}`);
      myInterpreter.run();
      output.output = myInterpreter.value;
    }
    return output;
}
```

The pattern is clear: string manipulation, data reshaping, lightweight computation, preview generation. Anything that does not touch the network, does not allocate large buffers, does not iterate over millions of records.

What about AI tasks -- the ones that call out to language models? They simply do not override `executeReactive()`. They inherit the base implementation that returns the existing output unchanged. During reactive propagation, an AI task that has not been `run()` yet will output an empty object. An AI task that *has* been run will output its cached result. Either way: instant.

---

## The Immutability Invariant

This is the rule that holds the whole system together:

> **Once a task reaches `COMPLETED` status, its output is locked and immutable.**

Let's look at how `runGraphReactive()` enforces this:

```typescript
for await (const task of this.reactiveScheduler.tasks()) {
    const isRootTask = this.graph.getSourceDataflows(task.id).length === 0;

    if (task.status === TaskStatus.PENDING) {
      task.resetInputData();
      this.copyInputFromEdgesToNode(task);
    }
    // COMPLETED tasks: skip input modification entirely

    const taskInput = isRootTask ? input : {};
    const taskResult = await task.runReactive(taskInput);

    await this.pushOutputFromNodeToEdges(task, taskResult);
}
```

See the conditional? If a task is `PENDING`, its inputs get refreshed from upstream dataflows. If it is `COMPLETED`, the graph runner does not touch its inputs at all. The task's `runReactive()` will still be called, but it will just return the already-locked output.

Why is this so critical? Consider the alternative. If reactive propagation could modify a `COMPLETED` task's output, you would have two sources of truth: the cached, validated result from `run()`, and whatever `executeReactive()` just produced. Downstream tasks that depend on this output would see inconsistent data depending on whether they read before or after the reactive pass. Cache invalidation would become a nightmare. The deterministic guarantee that makes `run()` reliable would evaporate.

The immutability invariant means you can always trust a `COMPLETED` task's output. It was produced by a full `execute()`, validated, cached, and frozen. Reactive propagation flows *around* it like water around a rock.

---

## How They Compose: The Mixed-State Graph

Here is where the model gets truly elegant. In a real interactive session, a graph will have tasks in *different* states simultaneously:

```
[InputTask: PENDING]  -->  [SplitTask: PENDING]  -->  [SummarizeTask: PENDING]
                                                  -->  [TranslateTask: COMPLETED]
```

Maybe the user ran the pipeline once, the TranslateTask completed, and then they edited the input. The InputTask and SplitTask reset to `PENDING` (they are cheap to re-derive). But the TranslateTask stays `COMPLETED` -- its cached translation is still valid for whatever it previously received.

When `runGraphReactive()` walks this graph:

1. **InputTask** (PENDING): Gets new input from the user's edits. `executeReactive()` passes it through. Output propagates downstream.
2. **SplitTask** (PENDING): Receives the new input via dataflows. `executeReactive()` splits it into ports. Output propagates downstream.
3. **SummarizeTask** (PENDING): Receives new text from SplitTask. `executeReactive()` returns `{}` (no override, base implementation). The UI shows an empty preview -- the user knows this task needs to be run.
4. **TranslateTask** (COMPLETED): Input is *not* modified (immutability invariant). `runReactive()` returns the cached translation. The UI shows the previous result, clearly marked as completed.

The user sees: their edits flowing through the pipeline in real time, with completed tasks holding their ground and pending tasks showing what data they *would* receive. They can tell at a glance which parts of the pipeline are stale and which are fresh. Then they hit Run, the real execution fires for the pending tasks, and everything locks into place.

---

## Putting It Together: A Visual Pipeline Editor

Let's sketch how you would build this in practice. Imagine a React-based node editor where each node corresponds to a Workglow task:

```typescript
// User types in an input field
function onInputChange(nodeId: string, value: string) {
  const task = graph.getTask(nodeId);
  task.defaults.text = value;

  // Trigger reactive propagation across the entire graph
  graph.runReactive({ text: value }).then((results) => {
    // Update every node's display with its reactive output
    for (const task of graph.getTasks()) {
      updateNodeUI(task.id, task.runOutputData, task.status);
    }
  });
}

// User clicks "Run"
async function onRunClicked() {
  const results = await graph.run();
  // All tasks are now COMPLETED with locked outputs
  for (const task of graph.getTasks()) {
    updateNodeUI(task.id, task.runOutputData, task.status);
  }
}
```

Every keystroke triggers `runReactive()`. Because every `executeReactive()` completes in under 1ms, the entire graph propagation finishes before the next frame. The user sees live previews of data flowing through their pipeline -- splits happening, formats applying, text transforming -- all without a single network call.

When they are satisfied with the shape of their data, they hit Run. The `execute()` methods fire for real. AI models are called. Embeddings are computed. Results are cached. Tasks become `COMPLETED` and their outputs are locked.

If the user then edits an upstream input, the completed tasks hold their cached results while the pending tasks show live previews of the new data. The user can see exactly which parts of their pipeline will be affected by the change, and they can run just the stale portion.

This is the power of the dual-mode model: **design-time interactivity and run-time correctness, from the same graph, with the same tasks, using the same dataflows.** No separate "preview pipeline." No mock data. No approximations. Just two execution modes with clearly defined contracts, composing cleanly across arbitrarily complex task graphs.

---

## Key Takeaways

If you are building pipeline systems -- whether for AI orchestration, data processing, or creative tools -- the dual execution model offers a pattern worth studying:

1. **Separate concerns by speed.** Heavy computation and lightweight preview are fundamentally different operations. Give them different methods with different contracts.

2. **Make completion irreversible.** Once a task has produced a validated result, lock it down. The immutability invariant is not just a nice-to-have -- it is what makes mixed-state graphs coherent.

3. **Default to passthrough.** The base `executeReactive()` returns existing output unchanged. This means you only need to write reactive logic for tasks that *can* provide meaningful previews. Everything else just works.

4. **Think in terms of state propagation, not re-execution.** Reactive mode does not re-run your pipeline. It propagates lightweight state updates through the existing graph topology, respecting which tasks are locked and which are open.

5. **Budget your frame.** The sub-1ms constraint is not arbitrary. It comes directly from the 16ms frame budget at 60fps, divided across however many tasks are in your graph. Know your budget. Design your reactive methods to fit within it.

The dual execution model is one of those ideas that seems obvious in retrospect -- of course a pipeline engine needs both a "real run" and a "preview run." But the details matter: the immutability invariant, the mixed-state composition, the topological ordering of reactive propagation, the re-entry protection. Getting these right is what makes the difference between a demo and a production system.

The code is all in `@workglow/task-graph`. Go read `EXECUTION_MODEL.md`, then look at `TaskRunner.ts` and `TaskGraphRunner.ts`. The architecture speaks for itself.
