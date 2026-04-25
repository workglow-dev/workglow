# Design: Split `run()` from `runPreview()` — one method, one purpose

**Date:** 2026-04-25
**Status:** Approved for implementation planning
**Scope:** `task-graph`, `tasks`, `ai`, `ai-provider`, `test`, builder app, technical & narrative docs

## Problem

The current TaskRunner couples normal execution and reactive (preview) execution: every `run()` calls `task.execute()` (or `task.executeStream()`) **and then** overlays `task.executeReactive()` on top of the result. The same overlay runs on cache hits and after stream completion. This means:

- `executeReactive()` is a hidden second stage of normal execution, not just a UI preview.
- Tasks that implement only `executeReactive()` produce results during full runs by accident — the overlay is what makes them work.
- Cached outputs get re-modified by reactive logic on every cache hit, so cached values aren't actually the values that get returned.
- The stream finish event payload gets mutated by reactive logic before being returned, contradicting the streaming contract.
- The naming (`reactive`) describes implementation, not intent.

## Decision

Make `run()` and `runPreview()` strictly orthogonal:

- `run()` calls `execute()` (or `executeStream()`) only. The result is the committed output.
- `runPreview()` calls `executePreview()` only. The result is a low-fidelity preview, used while a task is PENDING in the editor.
- Cache hits return cached output verbatim — no preview overlay.
- The current immutability invariant ("COMPLETED tasks are locked; `runPreview()` returns cached output unchanged at the graph level") is preserved exactly.

Rename throughout: `executeReactive` → `executePreview`, `runReactive` → `runPreview`, and all related types/registry symbols. No backward compatibility shims.

Drop the `output` parameter from `executePreview`. Under the new contract there is no prior `execute()` output to merge into; preview is computed from input alone.

## Method contract

```ts
// ITask, Task
execute(input: Input, ctx: IExecuteContext): Promise<Output | undefined>
executeStream?(input: Input, ctx: IExecuteContext): AsyncIterable<StreamEvent>
executePreview(input: Input, ctx: IExecutePreviewContext): Promise<Output | undefined>
```

| Method | Called by | Produces |
|---|---|---|
| `execute` | `run()` only | Committed, high-fidelity, cacheable result |
| `executeStream` | `run()` only (when streamable) | Same as `execute` but emitted as stream events |
| `executePreview` | `runPreview()` only | Low-fidelity preview, fully computed from input |

Return-value semantics for `executePreview`:
- Non-`undefined` `Output` — replaces `runOutputData` entirely. **No merge.**
- `undefined` — leaves `runOutputData` unchanged.

The `Object.assign({}, output, previewResult)` merge in `executeTaskPreview` is removed. Tasks that need prior output can read `this.runOutputData` directly.

## Renames

| Before | After |
|---|---|
| `executeReactive` | `executePreview` |
| `runReactive` | `runPreview` |
| `executeTaskReactive` (TaskRunner method) | `executeTaskPreview` |
| `runGraphReactive` (TaskGraph method) | `runGraphPreview` |
| `IExecuteReactiveContext` | `IExecutePreviewContext` |
| `reactiveRunning` (TaskRunner state flag) | `previewRunning` |
| `AiProviderReactiveRunFn` | `AiProviderPreviewRunFn` |
| `getReactiveRunFn` (provider registry) | `getPreviewRunFn` |
| `*_REACTIVE_TASKS` provider maps (e.g. `ANTHROPIC_REACTIVE_TASKS`) | `*_PREVIEW_TASKS` |
| `*_Reactive` provider fns (e.g. `Anthropic_CountTokens_Reactive`) | `*_Preview` |

## Runtime guard

`TaskRunner.run()` checks at first call whether the task overrides `executePreview` but not `execute`:

```ts
const proto = Object.getPrototypeOf(this.task);
if (
  proto.execute === Task.prototype.execute &&
  proto.executePreview !== Task.prototype.executePreview
) {
  throw new TaskConfigurationError(
    `Task "${this.task.type}" implements only executePreview() and cannot be run via run(). ` +
    `After the run/runPreview split, run() requires execute() (or executeStream()). ` +
    `See docs/technical/02-dual-mode-execution.md.`
  );
}
```

The check fires on `run()`, not on construction. `runPreview()` does **not** trigger the guard — preview-only tasks are valid for preview-only callers.

## Migration phases

### Phase 0 — Mechanical rename + signature change

Single safe pass with no behavior change:

- Rename all symbols listed in the Renames table across `task-graph`, `tasks`, `ai`, `ai-provider`, `test`, builder app, and docs.
- Drop the `output` parameter from `executePreview` in `ITask`, `Task`, and every override (libs/tasks, libs/ai base classes, builder mirror tasks, AI provider preview fns, test fixtures).
- TaskRunner internally still does `Object.assign({}, this.task.runOutputData, previewResult ?? {})` so merge behavior is preserved across Phase 0. Only the public method signature and names change.
- Update builder: `useTaskGraphExecution.ts`, `execution.ts` store action, all references.
- After Phase 0: codebase compiles and tests pass under new names with old behavior.

### Phase 1 — Pure deterministic utility tasks

Add `execute()` to tasks that previously implemented only `executePreview()`. Extract a pure helper called by both methods.

Tasks:
- `tasks/src/task/string/*` (10 tasks)
- `tasks/src/task/TemplateTask.ts`
- `tasks/src/task/RegexTask.ts`
- `tasks/src/task/JsonPathTask.ts`
- `tasks/src/task/DateFormatTask.ts`

Behavior unchanged in Phase 1: runner still overlays preview after execute, and the merge of identical outputs is idempotent.

### Phase 2 — Heavier deterministic tasks

Same pattern. For each task, decide whether `executePreview` should call the same helper as `execute` (preview parity) or do a lighter approximation (genuine preview).

Tasks:
- `tasks/src/task/image/*` (~17 tasks)
- `tasks/src/task/JavaScriptTask.ts`
- Builder: `builder/packages/app/src/components/workflow/nodes/tasks/ImageEffectTask.ts`

### Phase 3 — Pass-through and flow-shaping tasks

Verify pass-through `execute()` works and `executeStream()` semantics survive.

Tasks:
- `tasks/src/task/SplitTask.ts`
- `tasks/src/task/InputTask.ts`
- `tasks/src/task/OutputTask.ts`
- Builder: `builder/packages/app/src/components/workflow/nodes/tasks/SplitTask.ts`
- Builder: `builder/packages/app/src/components/workflow/nodes/tasks/JoinTask.ts`

### Phase 4 — Explicit dual-path tasks

Make the policy crisp on tasks where both APIs legitimately exist:

- **`tasks/src/task/LambdaTask.ts`**: `run()` uses only `config.execute`. `runPreview()` uses only `config.executePreview`. No cross-call between them.
- **`ai/src/task/CountTokensTask.ts`**: real tokenizer stays registered in `*_TASKS` (used by `run()`); fast estimator stays registered in `*_PREVIEW_TASKS` (used by `runPreview()`). After Phase 5, no overlay between them.
- **`ai/src/task/base/AiTask.ts`**: `executePreview` keeps delegating to `getPreviewRunFn`. After Phase 5 it is no longer invoked as a hidden second stage of `run()`.

### Phase 5 — The cut: runner contract change + guard + tests + docs

#### `TaskRunner` (`task-graph/src/task/TaskRunner.ts`)

| Location | Change |
|---|---|
| Cache-hit branches in `run()` (currently lines 198, 200) | Drop `await this.executeTaskPreview(...)` calls. Set `runOutputData = outputs` directly. Streaming cache hit emits `stream_start`/`stream_chunk(finish)`/`stream_end` with cached data and returns. |
| `executeTask()` (line 328) | Drop the `executeTaskPreview` overlay. Return `result` directly. |
| `executeStreamingTask()` (lines 497–501) | Drop the `executeTaskPreview` call after `stream_end`. Return `runOutputData` directly. |
| `executeTaskPreview()` (lines 334–337) | Drop the `Object.assign` merge. Return `previewResult` directly. |
| `runPreview()` (lines 232–280) | Only assign `runOutputData = resultPreview` if non-undefined. |
| `run()` start | Add the runtime guard (preview-only-without-execute throws `TaskConfigurationError`). |

#### `GraphAsTaskRunner` (`task-graph/src/task/GraphAsTaskRunner.ts`)

- Single-task branch of `executeTask` calls `super.executeTask(input)` — already correct via inheritance after the base change.
- `executeTaskPreview` (lines 90–102): keep the compound `executeTaskChildrenPreview` path (this is how preview propagates through subgraphs via `runPreview`). For the single branch, drop the `Object.assign` merge — return `previewResults` directly.

#### `IteratorTaskRunner` (`task-graph/src/task/IteratorTaskRunner.ts`)

- Empty-iteration branch (line 54): replace `return this.executeTaskPreview(input, emptyResult as Output);` with `return emptyResult as Output;`
- Post-iteration (line 61): replace `return this.executeTaskPreview(input, result as Output);` with `return result as Output;`
- `executeTaskPreview` (lines 67–70): drop the `Object.assign` merge.
- Replace misleading comment at line 38.

#### `FallbackTaskRunner` (`task-graph/src/task/FallbackTaskRunner.ts`)

- `executeTaskFallback` (line 89): replace `return (await this.executeTaskPreview(input, result as Output)) as Output;` with `return result as Output;`
- `executeDataFallback` (line 184): replace `return (await this.executeTaskPreview(input, mergedOutput)) as Output;` with `return mergedOutput as Output;`
- `executeTaskPreview` (lines 41–44): drop the `Object.assign` merge.
- Rewrite "reactive post-processing" comments.

#### `WhileTaskRunner` (`task-graph/src/task/WhileTaskRunner.ts`)

- `executeTask` (lines 30–39) already returns `result` directly without preview overlay — no semantic change needed.
- `executeTaskPreview` (lines 44–47): drop the `Object.assign` merge.

#### Verification before landing Phase 5

Confirm via grep that `IteratorTask`, `FallbackTask`, `WhileTask`, `GraphAsTask`, `MapTask`, `ReduceTask`, and `ConditionalTask` still don't override `executePreview`. (Audited at design time: none do, so the runner-variant overlay calls are always invoking the no-op base method.)

## Tests

### Existing tests to update

| File | What changes |
|---|---|
| `test/src/test/task/SingleTask.test.ts` | Reverse assertions that `run()` invokes preview. Add new assertions that `run()` does not invoke `executePreview`. |
| `test/src/test/task/GraphAsTask.test.ts` | Update subgraph reactive-behavior assertions. Compound `run()` no longer overlays preview on subgraph results. |
| `test/src/test/task/ArrayTask.test.ts` | Verify `run()` is preview-free. |
| `test/src/test/task/LambdaTask.test.ts` | Most affected: verify `run()` uses only `config.execute`, `runPreview()` uses only `config.executePreview`, no cross-call. |
| `test/src/test/task/TestTasks.ts` | Test fixtures: rename methods, drop `output` param. |
| `test/src/test/task-graph/TaskGraphRunner.test.ts` | Graph-level: verify `run()` doesn't trigger preview on any task; `runGraphPreview` is the new name. |
| `test/src/test/task-graph-output-cache/*` | Cache hit returns cached output verbatim, no preview overlay. |
| `test/src/test/ai-provider/*` | Verify `getPreviewRunFn` works and registry maps are renamed correctly. |

### New test files to add

In `test/src/test/task/`:

- **`run-vs-preview-isolation.test.ts`**
  - `run()` does not invoke `executePreview()` (spy on a task with both methods).
  - `runPreview()` does not invoke `execute()` or `executeStream()`.
  - For a streaming task, `run()` does not invoke `executePreview()` after `stream_end`.
  - For a cacheable task, second `run()` (cache hit) returns cached output and invokes neither `execute()` nor `executePreview()`.
  - For a streamable cacheable task, second `run()` cache hit emits the expected stream events with cached data and invokes no `executePreview()`.

- **`preview-only-task-guard.test.ts`**
  - Task that overrides `executePreview` but not `execute` throws `TaskConfigurationError` on first `run()` with task type and doc reference in the message.
  - Task that overrides both runs without error.
  - Task that overrides only `execute` runs without error.
  - Task that overrides neither runs without error (returns `{}` from base default).
  - Guard fires on `run()`, not on construction.
  - `runPreview()` does not trigger the guard.

- **`preview-return-semantics.test.ts`**
  - `executePreview` returning `Output` replaces `runOutputData` entirely (no merge).
  - `executePreview` returning `undefined` leaves `runOutputData` unchanged.
  - Confirms the merge is gone.

In `test/src/test/task-graph/`:

- **`runner-variants-no-preview-overlay.test.ts`**
  - `IteratorTaskRunner`: empty and non-empty iteration return their results without preview overlay.
  - `FallbackTaskRunner` task mode: successful alternative returns its result without preview overlay.
  - `FallbackTaskRunner` data mode: successful alternative returns merged subgraph output without preview overlay.
  - `WhileTaskRunner`: while loop result returned without preview overlay.
  - `GraphAsTaskRunner` compound `run()`: subgraph results merged and returned without preview overlay.
  - `GraphAsTaskRunner` compound `runPreview()`: still propagates through subgraph via `subGraph.runPreview` (preserved).

## Documentation rewrite

Directive: any `.md`/`.mdx` file in the repo that describes the current execution contract gets fixed in place, including older blog posts.

| File | Severity | Notes |
|---|---|---|
| `libs/docs/technical/02-dual-mode-execution.md` | Heavy rewrite | Step 8 of "Full Execution: run()" (`Then: executeTaskReactive(input, output) — merge reactive overlay`) must be removed. Cache snippet (current lines ~317–335) showing reactive on cache hit must be replaced. "Pattern: Progressive Preview" example (current lines ~487–501) must be replaced with the shared-helper pattern below. API Reference table renames + drop `output` from `executePreview` row. "Cache and Reactive Execution" → "Cache and Preview Execution". Add new sections "Why preview is not called by run()" and "Runtime guard for preview-only tasks". Update the summary table. |
| `libs/packages/task-graph/src/EXECUTION_MODEL.md` | Heavy rewrite | Audit + rename + update flow descriptions. |
| `libs/packages/task-graph/src/task/README.md` | Light | Rename references. |
| `builder/packages/app/src/components/workflow/README.md` | Light | Rename references. |
| `builder/packages/app/src/components/brand/workglow.dev/help/library/reference.mdx` | Light–medium | User-facing reference doc — needs accurate API descriptions. |
| `builder/packages/app/src/components/brand/workglow.dev/help/library/advanced_topics.mdx` | Light–medium | Same. |
| `builder/packages/app/src/components/brand/workglow.dev/blog/post/20260112-two-modes-one-pipeline.mdx` | Heavy rewrite | Title and entire premise revolve around the dual-mode interplay. Either fully rewrite to describe the new contract, or pull the post if its narrative no longer makes sense. |
| `builder/packages/app/src/components/brand/workglow.dev/blog/post/20260105-inside-the-engine-room.mdx` | Light–medium | Audit references to `executeReactive`. |
| `builder/packages/app/src/components/brand/workglow.dev/blog/post/20260223-worker-system.mdx` | Light | Rename references. |
| `builder/packages/app/src/components/brand/workglow.dev/blog/post/20260316-ai-provider-system.mdx` | Light–medium | Provider preview registry rename + accurate description of preview vs execute roles. |

### Canonical pattern to document (replaces "Progressive Preview")

For tasks where preview computes the same data as execute, faster. Output fields the preview cannot populate should be declared optional in the task's output schema:

```ts
// shared helper — pure, fast
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Note: `analysis` is optional in the schema — preview can't compute it.
class TextAnalysisTask extends Task<{ text: string }, { wordCount: number; analysis?: string }> {
  async execute(input, ctx) {
    return {
      wordCount: countWords(input.text),
      analysis: await callAIModel(input.text, { signal: ctx.signal }),
    };
  }

  async executePreview(input, ctx) {
    return { wordCount: countWords(input.text) };
  }
}
```

For tasks where preview is a genuinely different (lighter) approximation:

```ts
class ImageBlurTask extends Task<...> {
  async execute(input, ctx) {
    return { image: await fullQualityBlur(input.image, input.radius) };
  }

  async executePreview(input, ctx) {
    return { image: fastApproximateBlur(input.image, input.radius) };
  }
}
```

### Verification

After Phase 5 lands, grep the entire repo for `executeReactive`, `runReactive`, `IExecuteReactiveContext`, `*_REACTIVE_TASKS`, `*_Reactive`. Any remaining hit is an oversight.

## Sequencing rationale

Phase 0 is mechanical and safe to land standalone — the rest of the work happens under the new names from the start.

Phases 1–4 are pure refactor under the old runtime contract: each migrated task gets `execute()`, but the runner still overlays preview, so behavior is identical (the merge of two identical outputs is idempotent). This means each phase is independently verifiable: run the test suite after each phase and behavior should be unchanged.

Phase 5 is the only behavior change. Anything missed in Phases 1–4 throws loudly via the runtime guard the first time it is run via `run()`. There is no silent failure mode.

## Out of scope

- Changes to streaming event semantics (`StreamMode`, `x-stream` annotations, `executeStream` signature).
- Changes to the cache repository contract.
- Changes to the entitlements, validation, or input-resolution paths.
- Changes to graph-level orchestration (`TaskGraphRunner`) beyond the `runGraphReactive` → `runGraphPreview` rename and removal of any post-graph preview overlay if one exists.
- Adding telemetry distinguishing `run` vs `runPreview` calls (could be a future improvement; not required by this change).
