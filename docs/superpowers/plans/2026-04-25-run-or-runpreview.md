# run/runPreview Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `run()` from `runPreview()` (renamed from `runReactive`) so that `run()` only invokes `execute()`/`executeStream()` and `runPreview()` only invokes `executePreview()`. No more reactive overlay after committed execution.

**Architecture:** Six phases. Phase 0 is a mechanical rename + signature pass with no behavior change. Phases 1–4 migrate task families to the new contract under the old runtime (still safe, since identical-output merges are idempotent). Phase 5 lands the runner contract change, the runtime guard, the new tests, and the doc rewrite. The cut goes last so anything missed throws loudly via the guard.

**Tech Stack:** TypeScript (strict), Bun workspaces (libs is a Turborepo), Vitest for tests, JSON Schema for I/O contracts. Two repos: `/workspaces/workglow/libs` (most of the work) and `/workspaces/workglow/builder` (mirror tasks + docs). Test command in libs: `bun run test`. Type check: `bun run build:types` or `npx tsc --noEmit -p packages/<pkg>`.

**Spec:** `/workspaces/workglow/libs/docs/superpowers/specs/2026-04-25-run-or-runpreview-design.md`

---

## Conventions for this plan

- **Repo prefixes**: paths starting with `libs/` are in `/workspaces/workglow/libs`. Paths starting with `builder/` are in `/workspaces/workglow/builder`. They're separate git repos — commit in the right one.
- **Test command**: from libs root, `bun run test`. From builder root, `bun run test`. Always run from the repo root, not from a package.
- **Commit message style**: short imperative summary, body explains *why*. Keep commits per-task to make bisecting trivial.
- **No `--no-verify`**, no skipping hooks. If a hook fails, fix the cause.
- **Don't run npx**: use `bun` and `bunx`. Type check via `npx tsc --noEmit` is the one explicit exception (per project CLAUDE.md).

---

## Task 1: Phase 0a — Rename in `task-graph` and drop `output` param

**Files (all in `libs/`):**
- Modify: `libs/packages/task-graph/src/task/ITask.ts`
- Modify: `libs/packages/task-graph/src/task/Task.ts`
- Modify: `libs/packages/task-graph/src/task/TaskRunner.ts`
- Modify: `libs/packages/task-graph/src/task/GraphAsTaskRunner.ts`
- Modify: `libs/packages/task-graph/src/task/IteratorTaskRunner.ts`
- Modify: `libs/packages/task-graph/src/task/FallbackTaskRunner.ts`
- Modify: `libs/packages/task-graph/src/task/WhileTaskRunner.ts`
- Modify: `libs/packages/task-graph/src/task-graph/TaskGraph.ts` (renames `runReactive` → `runPreview`)
- Modify: `libs/packages/task-graph/src/task-graph/TaskGraphRunner.ts` (renames `runGraphReactive` → `runGraphPreview`)
- Modify: `libs/packages/task-graph/src/index.ts` (re-exports)

- [ ] **Step 1: Confirm baseline tests pass before any change**

Run from libs root: `bun run test:bun:unit`
Expected: all pass. Capture the green line count for comparison.

- [ ] **Step 2: Rename in `ITask.ts`**

In `libs/packages/task-graph/src/task/ITask.ts`:
- Rename type `IExecuteReactiveContext` → `IExecutePreviewContext`.
- Change `executeReactive` method on `ITask` to:

```ts
executePreview?(input: Input, ctx: IExecutePreviewContext): Promise<Output | undefined>;
```

Note: dropped the `output: Output` parameter.

- Rename `runReactive(...)` method on `ITask` to `runPreview(...)`.

- [ ] **Step 3: Rename in `Task.ts` base class**

In `libs/packages/task-graph/src/task/Task.ts`:
- Update import: `IExecuteReactiveContext` → `IExecutePreviewContext`.
- Rename `executeReactive` method to `executePreview`. New signature (no `output` param):

```ts
public async executePreview(
  _input: Input,
  _context: IExecutePreviewContext
): Promise<Output | undefined> {
  return undefined;
}
```

Note: default returns `undefined` (was `output`). Under the new merge-free semantics, `undefined` means "no preview update".

- Rename `runReactive(...)` to `runPreview(...)` (lines ~231–233):

```ts
public async runPreview(overrides: Partial<Input> = {}): Promise<Output> {
  return this.runner.runPreview(overrides);
}
```

- [ ] **Step 4: Rename in `TaskRunner.ts` (Phase 0 — preserve behavior)**

In `libs/packages/task-graph/src/task/TaskRunner.ts`:
- Rename state flag `reactiveRunning` → `previewRunning`.
- Rename method `runReactive` → `runPreview`.
- Rename method `executeTaskReactive` → `executeTaskPreview`.
- Rename handler methods: `handleStartReactive` → `handleStartPreview`, `handleCompleteReactive` → `handleCompletePreview`, `handleAbortReactive` → `handleAbortPreview`, `handleErrorReactive` → `handleErrorPreview`.
- Update the `executeTaskPreview` call sites to drop the `output` argument from the call to `task.executePreview`. The runner-internal `output` parameter and the `Object.assign` merge **stay for now** to preserve Phase 0 behavior:

```ts
// Phase 0 form — drop output arg from executePreview call, KEEP runner-side merge
protected async executeTaskPreview(input: Input, output: Output): Promise<Output> {
  const previewResult = await this.task.executePreview(input, { own: this.own });
  return Object.assign({}, output, previewResult ?? {}) as Output;
}
```

- All other call sites (cache hit branches at lines ~198–200, `executeTask` at ~328, `executeStreamingTask` at ~497–501) keep calling `executeTaskPreview` with both `input` and the existing `output`. **No semantic change.**

- [ ] **Step 5: Rename in runner variants (Phase 0 — preserve behavior)**

For each of the four runner variant files, do the same shape of edits as Step 4 — rename method names but keep the runner-internal `output` param and `Object.assign` merge:

- `libs/packages/task-graph/src/task/GraphAsTaskRunner.ts`: rename `executeTaskReactive` → `executeTaskPreview`, `executeTaskChildrenReactive` → `executeTaskChildrenPreview`. The override at lines 90–102: keep both branches; in the single-branch, drop the `output` arg from `task.executePreview(...)` call but keep the `Object.assign` line.
- `libs/packages/task-graph/src/task/IteratorTaskRunner.ts`: rename methods. In the override at lines 67–70, drop `output` arg from `task.executePreview(...)` but keep `Object.assign`. The two `this.executeTaskReactive(input, ...)` calls inside `executeTask` (lines 54, 61) become `this.executeTaskPreview(input, ...)`.
- `libs/packages/task-graph/src/task/FallbackTaskRunner.ts`: same shape — rename methods; drop `output` from `task.executePreview(...)` call; keep `Object.assign`.
- `libs/packages/task-graph/src/task/WhileTaskRunner.ts`: same shape.

- [ ] **Step 6: Rename in `TaskGraph.ts` and `TaskGraphRunner.ts`**

- In `libs/packages/task-graph/src/task-graph/TaskGraph.ts`: rename `runReactive` method to `runPreview`. Rename any internal helpers like `runReactiveAt`, `runReactiveFromTask`, etc. (grep `Reactive` in the file).
- In `libs/packages/task-graph/src/task-graph/TaskGraphRunner.ts`: rename `runGraphReactive` → `runGraphPreview` and any helper methods.

- [ ] **Step 7: Update re-exports in `index.ts`**

In `libs/packages/task-graph/src/index.ts`: rename `IExecuteReactiveContext` → `IExecutePreviewContext` in any exports. Grep for stale exports of removed names.

- [ ] **Step 8: Run type check on task-graph package**

Run from libs root: `npx tsc --noEmit -p packages/task-graph`
Expected: no errors. If errors mention missing `executeReactive` or `IExecuteReactiveContext`, you missed a rename — fix and re-run.

- [ ] **Step 9: Run task-graph tests**

Run from libs root: `bun run test:bun:integration graph task`
Expected: all pass (behavior is unchanged). If a test fails, it's likely a fixture in `test/src/test/task/TestTasks.ts` that hasn't been renamed yet — Task 4 covers this. Note any failures and proceed; they'll be fixed in Task 4.

- [ ] **Step 10: Commit**

```bash
cd /workspaces/workglow/libs
git add packages/task-graph/
git commit -m "$(cat <<'EOF'
refactor(task-graph): rename executeReactive -> executePreview, drop output param

Phase 0a of the run/runPreview split. Renames executeReactive ->
executePreview throughout task-graph (ITask, Task, TaskRunner, runner
variants, TaskGraph, TaskGraphRunner, IExecuteReactiveContext) and drops
the output parameter from executePreview's signature. Runner internals
preserve the Object.assign merge for Phase 0 so behavior is unchanged.
EOF
)"
```

---

## Task 2: Phase 0b — Rename in `tasks` package

**Files (all in `libs/`):**
- Modify: every file under `libs/packages/tasks/src/task/` that contains `executeReactive`, `runReactive`, or `IExecuteReactiveContext`.

- [ ] **Step 1: Inventory the files**

Run from libs root: `grep -rln "executeReactive\|runReactive\|IExecuteReactiveContext" packages/tasks/src/`
Capture the list. Expect ~30+ files.

- [ ] **Step 2: Mechanical rename in tasks**

For each file in the inventory, apply this canonical edit:

- Imports: `IExecuteReactiveContext` → `IExecutePreviewContext`.
- Method override: rename `executeReactive` to `executePreview` and drop the `output: Output` (or `_output: Output`) parameter:

```ts
// Before
override async executeReactive(
  input: Input,
  _output: Output,
  _context: IExecuteReactiveContext
): Promise<Output> { ... }

// After
override async executePreview(
  input: Input,
  _context: IExecutePreviewContext
): Promise<Output | undefined> { ... }
```

Inside the body: any reference to the (usually unused) `output` parameter must be removed. If a body actually used `output`, replace with `this.runOutputData` and add a comment noting the change. (Audit hint: most use `_output`, so the body change is rare.)

- Any `runReactive` method calls or references in builder helpers etc.: rename to `runPreview`.

- [ ] **Step 3: Type check tasks package**

Run from libs root: `npx tsc --noEmit -p packages/tasks`
Expected: no errors. Common failures: forgot to drop `output` param in some override (TypeScript will flag the override mismatch); forgot to update an import.

- [ ] **Step 4: Run tasks tests**

Run from libs root: `bun run test:bun:integration task`
Expected: all pass. If a tasks-specific test fails, the test file is renamed in Task 4.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/workglow/libs
git add packages/tasks/
git commit -m "$(cat <<'EOF'
refactor(tasks): rename executeReactive -> executePreview

Phase 0b. Renames executeReactive overrides to executePreview throughout
tasks/, drops the output parameter from each override, and updates type
imports. No behavior change.
EOF
)"
```

---

## Task 3: Phase 0c — Rename in `ai` and `ai-provider` packages

**Files (all in `libs/`):**
- Modify: `libs/packages/ai/src/task/base/AiTask.ts`
- Modify: `libs/packages/ai/src/task/base/AiVisionTask.ts`
- Modify: `libs/packages/ai/src/task/base/StreamingAiTask.ts`
- Modify: `libs/packages/ai/src/provider/AiProviderRegistry.ts`
- Modify: every provider directory under `libs/packages/ai-provider/src/provider-*/` that contains `REACTIVE_TASKS`, `_Reactive`, or `executeReactive`.

- [ ] **Step 1: Rename type and registry method**

In `libs/packages/ai/src/provider/AiProviderRegistry.ts`:
- Rename `AiProviderReactiveRunFn` → `AiProviderPreviewRunFn`. Drop the `output` parameter from the type signature:

```ts
// Before
export type AiProviderReactiveRunFn<Input, Output> = (
  input: Input,
  output: Output,
  model: ModelConfig
) => Promise<Output | undefined>;

// After
export type AiProviderPreviewRunFn<Input, Output> = (
  input: Input,
  model: ModelConfig
) => Promise<Output | undefined>;
```

- Rename method `getReactiveRunFn` → `getPreviewRunFn`. Update any internal storage maps from `*reactiveRunFns*` to `*previewRunFns*`.

- [ ] **Step 2: Rename in AiTask base**

In `libs/packages/ai/src/task/base/AiTask.ts`:
- Rename method `executeReactive` → `executePreview`, drop the `output: Output` param. New body (around line 221–238):

```ts
override async executePreview(
  input: Input,
  context: IExecutePreviewContext
): Promise<Output | undefined> {
  const model = input.model as ModelConfig | undefined;
  if (model && typeof model === "object" && model.provider) {
    const taskType = (this.constructor as any).runtype ?? (this.constructor as any).type;
    const previewFn = getAiProviderRegistry().getPreviewRunFn<Input, Output>(
      model.provider,
      taskType
    );
    if (previewFn) {
      return previewFn(input, model);
    }
  }
  return super.executePreview(input, context);
}
```

- Update import: `IExecuteReactiveContext` → `IExecutePreviewContext`.

- [ ] **Step 3: Rename in AiVisionTask and StreamingAiTask**

In each of `libs/packages/ai/src/task/base/AiVisionTask.ts` and `libs/packages/ai/src/task/base/StreamingAiTask.ts`: same shape — rename overrides, drop `output` param, update import.

- [ ] **Step 4: Rename provider registry maps and run fns**

For each provider directory under `libs/packages/ai-provider/src/provider-*/`, do the following systematically:

- File-level renames (search/replace within file contents):
  - `ANTHROPIC_REACTIVE_TASKS` → `ANTHROPIC_PREVIEW_TASKS`
  - `OPENAI_REACTIVE_TASKS` → `OPENAI_PREVIEW_TASKS`
  - `GEMINI_REACTIVE_TASKS` → `GEMINI_PREVIEW_TASKS`
  - `HFT_REACTIVE_TASKS` → `HFT_PREVIEW_TASKS`
  - `LLAMACPP_REACTIVE_TASKS` → `LLAMACPP_PREVIEW_TASKS`
  - (extend the pattern for any other `*_REACTIVE_TASKS` constant the inventory turned up)
- Provider fn names: `*_Reactive` → `*_Preview` (e.g. `Anthropic_CountTokens_Reactive` → `Anthropic_CountTokens_Preview`, including the file `libs/packages/ai-provider/src/provider-anthropic/common/Anthropic_CountTokens.ts` — the file does not need to be renamed).
- Each provider preview fn: drop the `output` parameter from its signature. Bodies that ignored `output` (most do) have no body change.

- [ ] **Step 5: Inventory check**

Run from libs root: `grep -rn "Reactive\|REACTIVE\|reactive" packages/ai/ packages/ai-provider/ | grep -v "test\|\.md"`
Expected: zero hits other than possibly internal comments referencing the historical name. Any remaining hit in production code is a missed rename.

- [ ] **Step 6: Type check ai and ai-provider**

Run from libs root:
```bash
npx tsc --noEmit -p packages/ai
npx tsc --noEmit -p packages/ai-provider
```
Expected: no errors.

- [ ] **Step 7: Run AI provider tests**

Run from libs root: `bun run test:bun:ai-provider`
Expected: all pass. (May warn about provider-specific environment for live API tests; ignore those.)

- [ ] **Step 8: Commit**

```bash
cd /workspaces/workglow/libs
git add packages/ai/ packages/ai-provider/
git commit -m "$(cat <<'EOF'
refactor(ai): rename executeReactive -> executePreview, REACTIVE_TASKS -> PREVIEW_TASKS

Phase 0c. Renames AiTask.executeReactive -> executePreview, the provider
registry's getReactiveRunFn -> getPreviewRunFn, AiProviderReactiveRunFn
-> AiProviderPreviewRunFn, all *_REACTIVE_TASKS provider maps to
*_PREVIEW_TASKS, all *_Reactive provider fns to *_Preview, and drops
the output parameter from preview fn signatures. No behavior change.
EOF
)"
```

---

## Task 4: Phase 0d — Rename in `test` package fixtures and assertions

**Files (all in `libs/`):**
- Modify: `libs/packages/test/src/test/task/TestTasks.ts`
- Modify: every test file under `libs/packages/test/src/test/` that contains `executeReactive`, `runReactive`, `IExecuteReactiveContext`, or `getReactiveRunFn`.

- [ ] **Step 1: Inventory**

Run from libs root: `grep -rln "executeReactive\|runReactive\|IExecuteReactiveContext\|getReactiveRunFn" packages/test/src/`
Expected: ~6+ files including `task/SingleTask.test.ts`, `task/TestTasks.ts`, `task/GraphAsTask.test.ts`, `task/ArrayTask.test.ts`, `task/LambdaTask.test.ts`, `task-graph/TaskGraphRunner.test.ts`.

- [ ] **Step 2: Rename in TestTasks fixtures**

In `libs/packages/test/src/test/task/TestTasks.ts`:
- Rename every `executeReactive` method to `executePreview`.
- Drop the `output` parameter from each.
- Update imports: `IExecuteReactiveContext` → `IExecutePreviewContext`.

- [ ] **Step 3: Rename in test files**

For each remaining test file in the inventory: rename method names, drop `output` from any test-defined override, update assertion strings (e.g. `expect(spy).toHaveBeenCalledWith(input, output, ctx)` → `expect(spy).toHaveBeenCalledWith(input, ctx)`).

This step does **not** change the *substance* of any assertion. Tests that assert "run() invokes executeReactive after execute" stay asserting that — they'll be reversed in Task 12 when Phase 5 lands.

- [ ] **Step 4: Run the full libs test suite**

Run from libs root: `bun run test`
Expected: all pass. This is the sign that Phase 0 is complete and behavior is preserved end-to-end across libs.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/workglow/libs
git add packages/test/
git commit -m "$(cat <<'EOF'
refactor(test): rename executeReactive -> executePreview in fixtures and assertions

Phase 0d. Renames test fixtures and assertion call signatures to match
the new contract names. Tests that verify the old runtime behavior
(reactive overlay after execute) still assert that — they get reversed
in Phase 5 when the contract change lands.
EOF
)"
```

---

## Task 5: Phase 0e — Rename in builder app

**Files (all in `builder/`):**
- Modify: `builder/packages/app/src/components/workflow/hooks/useTaskGraphExecution.ts`
- Modify: `builder/packages/app/src/components/workflow/store/execution.ts`
- Modify: `builder/packages/app/src/components/workflow/store/workflowStore.ts`
- Modify: `builder/packages/app/src/components/workflow/WorkflowCanvas.tsx`
- Modify: `builder/packages/app/src/components/workflow/WorkflowCanvasHandlers.ts`
- Modify: `builder/packages/app/src/components/workflow/convert.ts`
- Modify: `builder/packages/app/src/components/workflow/nodes/tasks/SplitTask.ts`
- Modify: `builder/packages/app/src/components/workflow/nodes/tasks/JoinTask.ts`
- Modify: `builder/packages/app/src/components/workflow/nodes/tasks/ImageEffectTask.ts`
- Modify: `builder/packages/app/src/components/agent/AgentAsTaskUtility.ts`
- Modify: any test under `builder/packages/app/src/components/workflow/__tests__/` that references the old names.
- Modify: `builder/packages/app/src/components/task/demoTasks.ts`
- Modify: `builder/packages/app/src/lib/test-utils/demo-tasks.ts`

- [ ] **Step 1: Inventory**

Run from builder root: `grep -rln "executeReactive\|runReactive\|IExecuteReactiveContext" packages/app/src/`
Capture the list.

- [ ] **Step 2: Mechanical rename**

For each file in inventory:
- `executeReactive` → `executePreview` (drop `output` param from any local override).
- `runReactive` → `runPreview` (method calls and store actions).
- `IExecuteReactiveContext` → `IExecutePreviewContext`.

In `builder/packages/app/src/components/workflow/store/execution.ts`: rename the store action `runReactive: () => Promise<void>` → `runPreview: () => Promise<void>` and update implementation.

In `builder/packages/app/src/components/workflow/hooks/useTaskGraphExecution.ts` (around line 352): rename the variable and the calls accordingly.

For builder mirror tasks (`SplitTask.ts`, `JoinTask.ts`, `ImageEffectTask.ts`): same canonical edit as Task 2.

- [ ] **Step 3: Type check builder app**

Run from builder root (or `packages/app`): `npx tsc --noEmit -p packages/app`
Expected: no errors.

- [ ] **Step 4: Run builder tests**

Run from builder root: `bun run test`
Expected: all pass.

- [ ] **Step 5: Smoke-test the builder UI**

Run from builder root: `bun run dev`
- Open `http://localhost:5173`
- Open any project with a workflow
- Edit an input on a task node and verify the live preview still updates (the preview path is what got renamed to `runPreview` — must still propagate as before).
- Stop the dev server.

- [ ] **Step 6: Commit (in builder repo)**

```bash
cd /workspaces/workglow/builder
git add packages/app/
git commit -m "$(cat <<'EOF'
refactor(app): rename runReactive -> runPreview, executeReactive -> executePreview

Phase 0e. Renames builder-side references to the renamed task-graph
contract: store action runReactive -> runPreview, hook variables, mirror
tasks (SplitTask/JoinTask/ImageEffectTask), demo task fixtures. Live
preview behavior verified unchanged in the editor.
EOF
)"
```

---

## Task 6: Phase 1 — Migrate utility tasks (string + template + regex + jsonpath + dateformat)

**Files (all in `libs/`):**
- Modify: `libs/packages/tasks/src/task/string/StringConcatTask.ts`
- Modify: `libs/packages/tasks/src/task/string/StringIncludesTask.ts`
- Modify: `libs/packages/tasks/src/task/string/StringJoinTask.ts`
- Modify: `libs/packages/tasks/src/task/string/StringLengthTask.ts`
- Modify: `libs/packages/tasks/src/task/string/StringLowerCaseTask.ts`
- Modify: `libs/packages/tasks/src/task/string/StringReplaceTask.ts`
- Modify: `libs/packages/tasks/src/task/string/StringSliceTask.ts`
- Modify: `libs/packages/tasks/src/task/string/StringTemplateTask.ts`
- Modify: `libs/packages/tasks/src/task/string/StringTrimTask.ts`
- Modify: `libs/packages/tasks/src/task/string/StringUpperCaseTask.ts`
- Modify: `libs/packages/tasks/src/task/TemplateTask.ts`
- Modify: `libs/packages/tasks/src/task/RegexTask.ts`
- Modify: `libs/packages/tasks/src/task/JsonPathTask.ts`
- Modify: `libs/packages/tasks/src/task/DateFormatTask.ts`

- [ ] **Step 1: Apply the canonical migration pattern**

For each task above, the migration is:

1. Identify the body of the existing `executePreview` (post-rename) — this contains the real transform logic.
2. Extract that body into a pure module-scoped helper function (named `<verb>` — e.g. `concatStrings`, `renderTemplate`, `executeRegex`, `extractJsonPath`, `formatDate`).
3. Add an `execute(input, ctx)` method that calls the helper.
4. Make `executePreview(input, ctx)` also call the helper (preview parity).

Worked example for `TemplateTask.ts`:

```ts
// Module-scoped helper
function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
    const [path, defaultValue] = expr.split("|").map((s: string) => s.trim());
    const segments = path.split(".");
    let current: unknown = values;
    for (const segment of segments) {
      if (current === null || current === undefined || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    if (current !== undefined && current !== null) {
      return String(current);
    }
    return defaultValue !== undefined ? defaultValue : "";
  });
}

export class TemplateTask<...> extends Task<...> {
  // ...static metadata unchanged...

  override async execute(
    input: Input,
    _context: IExecuteContext
  ): Promise<Output | undefined> {
    return { result: renderTemplate(input.template, input.values) } as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return { result: renderTemplate(input.template, input.values) } as Output;
  }
}
```

For `RegexTask.ts`, extract the entire body of the current `executePreview` (including ReDoS guards) into a `runRegex(input)` helper that returns the output. Both methods call it.

For `StringConcatTask.ts`, extract `Object.values(input).join("")` into `concatStrings(input: Input): Output`. Both methods return its result.

Apply analogous extractions for each remaining file. The `IExecuteContext` import comes from `@workglow/task-graph`.

- [ ] **Step 2: Type check**

Run from libs root: `npx tsc --noEmit -p packages/tasks`
Expected: no errors.

- [ ] **Step 3: Run tasks tests**

Run from libs root: `bun run test:bun:integration task`
Expected: all pass. Tasks-specific tests (e.g. `RegexTask.test.ts`, `StringTask.test.ts`, `TemplateTask.test.ts`, `JsonPathTask.test.ts`, `DateFormatTask.test.ts`) should still pass — the extraction is behavior-preserving and the runner still overlays preview after execute.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/workglow/libs
git add packages/tasks/src/task/string/ packages/tasks/src/task/TemplateTask.ts packages/tasks/src/task/RegexTask.ts packages/tasks/src/task/JsonPathTask.ts packages/tasks/src/task/DateFormatTask.ts
git commit -m "$(cat <<'EOF'
refactor(tasks): add execute() to utility tasks via shared helpers

Phase 1. Migrates string/, TemplateTask, RegexTask, JsonPathTask, and
DateFormatTask to the new contract: extracts pure helpers, gives each
task an execute() that calls the helper, and keeps executePreview()
calling the same helper for editor live-preview parity. Behavior is
unchanged because the runner still overlays preview after execute and
identical-output merges are idempotent.
EOF
)"
```

---

## Task 7: Phase 2 — Migrate image tasks, JavaScriptTask, builder ImageEffectTask

**Files:**
- Modify: every file under `libs/packages/tasks/src/task/image/` whose class implements `executePreview`.
- Modify: `libs/packages/tasks/src/task/JavaScriptTask.ts`
- Modify: `builder/packages/app/src/components/workflow/nodes/tasks/ImageEffectTask.ts`

- [ ] **Step 1: Inventory image tasks**

Run from libs root: `grep -ln "executePreview" packages/tasks/src/task/image/`
Expected: ~17 files (`ImageBlurTask`, `ImageBorderTask`, `ImageBrightnessTask`, etc.).

- [ ] **Step 2: Apply the canonical migration pattern (per task)**

Same pattern as Task 6 — extract a helper, give the task an `execute()` that calls it. For each image task, the helper goes alongside the task class (or in a co-located `imageTaskIo.ts` if the helper is shared across tasks).

For each image task, decide:
- **Preview parity**: if the task is fast enough that preview should match execute exactly, both methods call the same helper.
- **Lighter preview**: if the task is heavy and a downsampled or simplified preview would be more responsive in the editor, give `executePreview` a separate lighter implementation. The decision is per-task; default to preview parity unless the existing implementation already had a noticeably cheaper preview path.

Per-task notes:
- `ImageBlurTask`, `ImageBrightnessTask`, `ImageContrastTask`, `ImageGrayscaleTask`, `ImageInvertTask`, `ImageSepiaTask`, `ImageThresholdTask`, `ImageTintTask`, `ImageTransparencyTask`: preview parity (same helper for both).
- `ImageCropTask`, `ImageFlipTask`, `ImageRotateTask`, `ImageResizeTask`: preview parity.
- `ImagePixelateTask`, `ImagePosterizeTask`, `ImageBorderTask`, `ImageWatermarkTask`: preview parity.
- `ImageTextTask`: preview parity (helpers exist in `imageTextRender.ts`).
- If you discover a task has a meaningfully different preview body that's lighter than execute, keep the two implementations distinct rather than collapsing them.

- [ ] **Step 3: Migrate JavaScriptTask**

In `libs/packages/tasks/src/task/JavaScriptTask.ts`: extract the JS execution helper, give `execute()` and `executePreview()` both bodies. If sandbox cost is high, consider giving `executePreview()` a lighter (e.g., AST-only) check — but only if the existing implementation already differs. Default to preview parity.

- [ ] **Step 4: Migrate builder ImageEffectTask**

In `builder/packages/app/src/components/workflow/nodes/tasks/ImageEffectTask.ts`: same pattern. The helper is `runEffect` from the co-located `ImageEffectJob.ts`.

- [ ] **Step 5: Type check both repos**

```bash
cd /workspaces/workglow/libs && npx tsc --noEmit -p packages/tasks
cd /workspaces/workglow/builder && npx tsc --noEmit -p packages/app
```
Expected: no errors.

- [ ] **Step 6: Run image and js tests**

Run from libs root: `bun run test:bun:integration task` (covers `ImageTask.test.ts`, `JavaScriptTask.test.ts`, `ImageColorInput.test.ts`, `ImageCodec.test.ts`).
Expected: all pass.

Run from builder root: `bun run test`
Expected: all pass.

- [ ] **Step 7: Commit (libs)**

```bash
cd /workspaces/workglow/libs
git add packages/tasks/src/task/image/ packages/tasks/src/task/JavaScriptTask.ts
git commit -m "$(cat <<'EOF'
refactor(tasks): add execute() to image and JS tasks

Phase 2. Migrates image/* and JavaScriptTask to the new contract.
Default approach is preview parity (same helper for execute and
executePreview); tasks where preview was meaningfully cheaper kept
distinct implementations.
EOF
)"
```

- [ ] **Step 8: Commit (builder)**

```bash
cd /workspaces/workglow/builder
git add packages/app/src/components/workflow/nodes/tasks/ImageEffectTask.ts
git commit -m "$(cat <<'EOF'
refactor(app): add execute() to builder ImageEffectTask

Phase 2 builder-side. Mirrors libs migration: ImageEffectTask now has
execute() calling the same runEffect helper as executePreview.
EOF
)"
```

---

## Task 8: Phase 3 — Migrate pass-through and flow-shaping tasks

**Files:**
- Modify: `libs/packages/tasks/src/task/SplitTask.ts`
- Modify: `libs/packages/tasks/src/task/InputTask.ts`
- Modify: `libs/packages/tasks/src/task/OutputTask.ts`
- Modify: `builder/packages/app/src/components/workflow/nodes/tasks/SplitTask.ts`
- Modify: `builder/packages/app/src/components/workflow/nodes/tasks/JoinTask.ts`

- [ ] **Step 1: Migrate `InputTask` and `OutputTask`**

In `libs/packages/tasks/src/task/InputTask.ts`: read the existing `executePreview` body. If it materializes input → output, give `execute()` the same body (extract a helper if it's non-trivial). Pass-through tasks should simply forward inputs to outputs. Keep `executePreview()` calling the same helper.

Same for `libs/packages/tasks/src/task/OutputTask.ts`.

If the task implements `executeStream`, leave that path alone — Phase 3 only touches the `execute()` and `executePreview()` paths.

- [ ] **Step 2: Migrate `SplitTask` (libs and builder)**

For each `SplitTask.ts` (libs and builder mirror), extract the array-fanout logic into a helper. Both `execute()` and `executePreview()` call it.

- [ ] **Step 3: Migrate builder `JoinTask`**

In `builder/packages/app/src/components/workflow/nodes/tasks/JoinTask.ts`: extract the merge-and-sort logic into a helper. Both methods call it.

- [ ] **Step 4: Type check**

```bash
cd /workspaces/workglow/libs && npx tsc --noEmit -p packages/tasks
cd /workspaces/workglow/builder && npx tsc --noEmit -p packages/app
```

- [ ] **Step 5: Run tests**

```bash
cd /workspaces/workglow/libs && bun run test:bun:integration task
cd /workspaces/workglow/builder && bun run test
```
Expected: all pass, including `SplitTask.test.ts`, `InputOutputTask.test.ts`, builder `split-join-ordering.test.ts` and `convert.integration.test.ts`.

- [ ] **Step 6: Commit (libs)**

```bash
cd /workspaces/workglow/libs
git add packages/tasks/src/task/SplitTask.ts packages/tasks/src/task/InputTask.ts packages/tasks/src/task/OutputTask.ts
git commit -m "$(cat <<'EOF'
refactor(tasks): add execute() to pass-through and flow-shaping tasks

Phase 3. Migrates SplitTask, InputTask, OutputTask. Pass-through
behavior moves into execute() while executePreview() shares helpers.
executeStream() paths untouched.
EOF
)"
```

- [ ] **Step 7: Commit (builder)**

```bash
cd /workspaces/workglow/builder
git add packages/app/src/components/workflow/nodes/tasks/SplitTask.ts packages/app/src/components/workflow/nodes/tasks/JoinTask.ts
git commit -m "$(cat <<'EOF'
refactor(app): add execute() to builder SplitTask and JoinTask

Phase 3 builder-side. Mirrors libs migration of pass-through/flow-shaping
tasks.
EOF
)"
```

---

## Task 9: Phase 4 — Dual-path tasks (LambdaTask, CountTokensTask, AiTask)

**Files (all in `libs/`):**
- Modify: `libs/packages/tasks/src/task/LambdaTask.ts`
- Modify: `libs/packages/ai/src/task/CountTokensTask.ts` (if it has any direct preview logic — most lives in providers)
- Verify (no change expected): `libs/packages/ai/src/task/base/AiTask.ts`
- Verify (no change expected): provider preview registrations under `libs/packages/ai-provider/src/`

- [ ] **Step 1: Make `LambdaTask` policy crisp**

In `libs/packages/tasks/src/task/LambdaTask.ts`, apply these specific edits:

- In `lambdaTaskConfigSchema` (~line 22), rename the `executeReactive: {}` property key to `executePreview: {}`.
- In the `LambdaTaskConfig` type (~line 32), rename the `executeReactive?:` field to `executePreview?:` and change its signature to drop the `output` parameter and the `IExecuteReactiveContext` import:

```ts
type LambdaTaskConfig<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
> = TaskConfig & {
  execute?: (input: Input, context: IExecuteContext) => Promise<Output>;
  executePreview?: (
    input: Input,
    context: IExecutePreviewContext
  ) => Promise<Output | undefined>;
};
```

- In the constructor (~line 97), update the validation message:

```ts
if (!config.execute && !config.executePreview) {
  throw new TaskConfigurationError(
    "LambdaTask must have either execute or executePreview function in config"
  );
}
```

- In the `executePreview` method body (post-rename from `executeReactive`), replace the merge-style `?? output` fallback with a clean undefined return when the config function is absent:

```ts
override async executePreview(
  input: Input,
  context: IExecutePreviewContext
): Promise<Output | undefined> {
  if (typeof this.config.executePreview === "function") {
    return await this.config.executePreview(input, context);
  }
  return undefined;
}
```

This enforces the policy: `run()` uses only `config.execute`, `runPreview()` uses only `config.executePreview`. No cross-call. Preview without a configured `executePreview` returns `undefined` (no preview update).

- [ ] **Step 2: Audit `CountTokensTask`**

In `libs/packages/ai/src/task/CountTokensTask.ts`: confirm it inherits both `execute` (provider tokenizer) and `executePreview` (provider fast estimator) from `AiTask`. No code change expected at the task level. The provider-level wiring (`*_TASKS` and `*_PREVIEW_TASKS` maps) was renamed in Task 3.

- [ ] **Step 3: Audit AiTask preview delegation**

In `libs/packages/ai/src/task/base/AiTask.ts`: confirm `executePreview` looks up `getPreviewRunFn` and returns its result without calling `execute`. No new code change in this task — Task 3 already did the rename.

- [ ] **Step 4: Type check and test**

```bash
cd /workspaces/workglow/libs && npx tsc --noEmit -p packages/tasks
cd /workspaces/workglow/libs && npx tsc --noEmit -p packages/ai
cd /workspaces/workglow/libs && bun run test:bun:integration task ai provider
```
Expected: all pass. `LambdaTask.test.ts` is the most likely to flag a behavior change if the cross-call fallback was removed; verify the test expectations match the new policy and update them in the same commit if needed.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/workglow/libs
git add packages/tasks/src/task/LambdaTask.ts packages/ai/
git commit -m "$(cat <<'EOF'
refactor(tasks,ai): enforce dual-path crispness for Lambda, CountTokens, AiTask

Phase 4. LambdaTask.run() uses only config.execute and runPreview() uses
only config.executePreview, with no cross-call fallback. CountTokensTask
and AiTask inherit clean separation: execute via *_TASKS provider
registry, preview via *_PREVIEW_TASKS. After Phase 5 the runner stops
overlaying these paths.
EOF
)"
```

---

## Task 10: Phase 5a — Add new test files for the contract (failing first)

**Files (all in `libs/`):**
- Create: `libs/packages/test/src/test/task/run-vs-preview-isolation.test.ts`
- Create: `libs/packages/test/src/test/task/preview-only-task-guard.test.ts`
- Create: `libs/packages/test/src/test/task/preview-return-semantics.test.ts`
- Create: `libs/packages/test/src/test/task-graph/runner-variants-no-preview-overlay.test.ts`

This task writes the new tests **before** the runner contract change. They will fail. Task 11 makes them pass.

- [ ] **Step 1: Write `run-vs-preview-isolation.test.ts`**

Create `libs/packages/test/src/test/task/run-vs-preview-isolation.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import {
  IExecuteContext,
  IExecutePreviewContext,
  Task,
  TaskConfig,
  TaskOutputRepository,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: { out: { type: "string" } },
  required: ["out"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

class IsolationTestTask extends Task<
  { value: string },
  { out: string },
  TaskConfig
> {
  static override readonly type = "IsolationTestTask";
  static override inputSchema() {
    return inputSchema;
  }
  static override outputSchema() {
    return outputSchema;
  }
  executeSpy = vi.fn(async (input: { value: string }, _ctx: IExecuteContext) => ({
    out: `executed:${input.value}`,
  }));
  previewSpy = vi.fn(
    async (input: { value: string }, _ctx: IExecutePreviewContext) => ({
      out: `previewed:${input.value}`,
    })
  );
  override async execute(input: { value: string }, ctx: IExecuteContext) {
    return this.executeSpy(input, ctx);
  }
  override async executePreview(
    input: { value: string },
    ctx: IExecutePreviewContext
  ) {
    return this.previewSpy(input, ctx);
  }
}

describe("run() vs runPreview() isolation", () => {
  it("run() does not invoke executePreview()", async () => {
    const task = new IsolationTestTask();
    await task.run({ value: "hello" });
    expect(task.executeSpy).toHaveBeenCalledOnce();
    expect(task.previewSpy).not.toHaveBeenCalled();
  });

  it("runPreview() does not invoke execute()", async () => {
    const task = new IsolationTestTask();
    await task.runPreview({ value: "hello" });
    expect(task.previewSpy).toHaveBeenCalledOnce();
    expect(task.executeSpy).not.toHaveBeenCalled();
  });

  it("cache hit returns cached output verbatim and invokes neither method", async () => {
    const cache = new TaskOutputRepository();
    const task1 = new IsolationTestTask();
    await task1.run({ value: "x" }, { outputCache: cache });
    expect(task1.executeSpy).toHaveBeenCalledOnce();

    const task2 = new IsolationTestTask();
    const result = await task2.run({ value: "x" }, { outputCache: cache });
    expect(result).toEqual({ out: "executed:x" });
    expect(task2.executeSpy).not.toHaveBeenCalled();
    expect(task2.previewSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write `preview-only-task-guard.test.ts`**

Create `libs/packages/test/src/test/task/preview-only-task-guard.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  IExecutePreviewContext,
  Task,
  TaskConfig,
  TaskConfigurationError,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";

const schema = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

class PreviewOnlyTask extends Task<
  { value: string },
  { value: string },
  TaskConfig
> {
  static override readonly type = "PreviewOnlyTask";
  static override inputSchema() {
    return schema;
  }
  static override outputSchema() {
    return schema;
  }
  override async executePreview(
    input: { value: string },
    _ctx: IExecutePreviewContext
  ) {
    return { value: `preview:${input.value}` };
  }
}

class ExecuteOnlyTask extends Task<
  { value: string },
  { value: string },
  TaskConfig
> {
  static override readonly type = "ExecuteOnlyTask";
  static override inputSchema() {
    return schema;
  }
  static override outputSchema() {
    return schema;
  }
  override async execute(input: { value: string }) {
    return { value: `exec:${input.value}` };
  }
}

class BothTask extends Task<
  { value: string },
  { value: string },
  TaskConfig
> {
  static override readonly type = "BothTask";
  static override inputSchema() {
    return schema;
  }
  static override outputSchema() {
    return schema;
  }
  override async execute(input: { value: string }) {
    return { value: `exec:${input.value}` };
  }
  override async executePreview(input: { value: string }) {
    return { value: `preview:${input.value}` };
  }
}

class NeitherTask extends Task<
  { value: string },
  { value: string },
  TaskConfig
> {
  static override readonly type = "NeitherTask";
  static override inputSchema() {
    return schema;
  }
  static override outputSchema() {
    return schema;
  }
}

describe("preview-only task runtime guard", () => {
  it("preview-only task throws TaskConfigurationError on run()", async () => {
    const task = new PreviewOnlyTask();
    await expect(task.run({ value: "x" })).rejects.toThrow(TaskConfigurationError);
    await expect(task.run({ value: "x" })).rejects.toThrow(/PreviewOnlyTask/);
  });

  it("execute-only task runs without error", async () => {
    const task = new ExecuteOnlyTask();
    const result = await task.run({ value: "x" });
    expect(result).toEqual({ value: "exec:x" });
  });

  it("both-overrides task runs without error", async () => {
    const task = new BothTask();
    const result = await task.run({ value: "x" });
    expect(result).toEqual({ value: "exec:x" });
  });

  it("neither-overrides task runs without error and returns base default", async () => {
    const task = new NeitherTask();
    const result = await task.run({ value: "x" });
    expect(result).toEqual({});
  });

  it("preview-only task runPreview() does not throw the guard", async () => {
    const task = new PreviewOnlyTask();
    const result = await task.runPreview({ value: "x" });
    expect(result).toEqual({ value: "preview:x" });
  });

  it("guard fires on run(), not on construction", () => {
    expect(() => new PreviewOnlyTask()).not.toThrow();
  });
});
```

- [ ] **Step 3: Write `preview-return-semantics.test.ts`**

Create `libs/packages/test/src/test/task/preview-return-semantics.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  IExecutePreviewContext,
  Task,
  TaskConfig,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";

const schema = {
  type: "object",
  properties: {
    a: { type: "string" },
    b: { type: "string" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

class ReplaceTask extends Task<{ a?: string; b?: string }, { a?: string; b?: string }, TaskConfig> {
  static override readonly type = "ReplaceTask";
  static override inputSchema() {
    return schema;
  }
  static override outputSchema() {
    return schema;
  }
  override async executePreview(
    _input: { a?: string; b?: string },
    _ctx: IExecutePreviewContext
  ) {
    return { a: "new" };
  }
}

class NoOpTask extends Task<{ a?: string }, { a?: string }, TaskConfig> {
  static override readonly type = "NoOpTask";
  static override inputSchema() {
    return schema;
  }
  static override outputSchema() {
    return schema;
  }
  override async executePreview() {
    return undefined;
  }
}

describe("executePreview return semantics", () => {
  it("non-undefined return replaces runOutputData entirely (no merge)", async () => {
    const task = new ReplaceTask();
    task.runOutputData = { a: "old", b: "kept-by-old-merge" };
    const result = await task.runPreview({});
    // After the cut, no merge: result has only `a` from preview, `b` is gone.
    expect(result).toEqual({ a: "new" });
    expect(task.runOutputData).toEqual({ a: "new" });
  });

  it("undefined return leaves runOutputData unchanged", async () => {
    const task = new NoOpTask();
    task.runOutputData = { a: "stays" };
    const result = await task.runPreview({});
    expect(result).toEqual({ a: "stays" });
    expect(task.runOutputData).toEqual({ a: "stays" });
  });
});
```

- [ ] **Step 4: Write `runner-variants-no-preview-overlay.test.ts`**

Create `libs/packages/test/src/test/task-graph/runner-variants-no-preview-overlay.test.ts`. The test sets up tasks where `executePreview` is a spy returning a distinguishable value, then asserts that running each runner variant via `run()` does NOT invoke the preview spy.

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import {
  FallbackTask,
  GraphAsTask,
  IExecuteContext,
  IExecutePreviewContext,
  MapTask,
  Task,
  TaskConfig,
  TaskGraph,
  WhileTask,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: { value: { type: "number" } },
  required: ["value"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: { out: { type: "number" } },
  required: ["out"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

class SpyTask extends Task<{ value: number }, { out: number }, TaskConfig> {
  static override readonly type = "SpyTask";
  static override inputSchema() {
    return inputSchema;
  }
  static override outputSchema() {
    return outputSchema;
  }
  executeSpy = vi.fn(async (input: { value: number }, _ctx: IExecuteContext) => ({
    out: input.value * 10,
  }));
  previewSpy = vi.fn(
    async (input: { value: number }, _ctx: IExecutePreviewContext) => ({
      out: input.value * -1, // distinguishable from execute
    })
  );
  override async execute(input: { value: number }, ctx: IExecuteContext) {
    return this.executeSpy(input, ctx);
  }
  override async executePreview(
    input: { value: number },
    ctx: IExecutePreviewContext
  ) {
    return this.previewSpy(input, ctx);
  }
}

describe("runner variants do not overlay executePreview after execute", () => {
  it("IteratorTaskRunner (MapTask): non-empty iteration returns iterated result without preview", async () => {
    const child = new SpyTask();
    const map = new MapTask<{ items: number[] }, { out: number[] }>({
      maxIterations: "unbounded",
    });
    map.subGraph.addTask(child);
    const result = await map.run({ items: [1, 2, 3] });
    expect(child.executeSpy).toHaveBeenCalled();
    expect(child.previewSpy).not.toHaveBeenCalled();
    // Result should reflect execute (positive multiplied by 10), not preview (negative).
    expect(result).toBeDefined();
  });

  it("IteratorTaskRunner (MapTask): empty iteration returns empty result without preview", async () => {
    const child = new SpyTask();
    const map = new MapTask<{ items: number[] }, { out: number[] }>({
      maxIterations: "unbounded",
    });
    map.subGraph.addTask(child);
    await map.run({ items: [] });
    expect(child.previewSpy).not.toHaveBeenCalled();
  });

  it("FallbackTaskRunner task mode: success returns alternative result without preview", async () => {
    const alternative = new SpyTask();
    const fallback = new FallbackTask({});
    fallback.subGraph.addTask(alternative);
    await fallback.run({ value: 5 });
    expect(alternative.executeSpy).toHaveBeenCalled();
    // FallbackTask itself has no executePreview override, so we assert the
    // child alternative's preview spy never fires under run().
    expect(alternative.previewSpy).not.toHaveBeenCalled();
  });

  it("WhileTaskRunner: while loop result returned without preview overlay", async () => {
    const body = new SpyTask();
    let iters = 0;
    const whileTask = new WhileTask({
      condition: () => iters++ < 1,
    } as any);
    whileTask.subGraph.addTask(body);
    await whileTask.run({ value: 7 });
    expect(body.previewSpy).not.toHaveBeenCalled();
  });

  it("GraphAsTaskRunner compound run(): subgraph results returned without preview overlay", async () => {
    const child = new SpyTask();
    const compound = new GraphAsTask({});
    compound.subGraph.addTask(child);
    await compound.run({ value: 3 });
    expect(child.executeSpy).toHaveBeenCalled();
    expect(child.previewSpy).not.toHaveBeenCalled();
  });

  it("GraphAsTaskRunner compound runPreview(): still propagates through subgraph", async () => {
    const child = new SpyTask();
    const compound = new GraphAsTask({});
    compound.subGraph.addTask(child);
    await compound.runPreview({ value: 3 });
    expect(child.previewSpy).toHaveBeenCalled();
    expect(child.executeSpy).not.toHaveBeenCalled();
  });
});
```

Adjust `MapTask`/`FallbackTask`/`WhileTask`/`GraphAsTask` constructor argument shapes to match their actual public signatures (consult the existing `IteratorTask.test.ts`, `FallbackTask.test.ts`, `WhileTaskCondition.test.ts`, `GraphAsTask.test.ts` for the exact pattern — those tests already do this setup and are the canonical reference).

- [ ] **Step 5: Run the new tests and verify they FAIL with the current runner**

Run from libs root: `bun run test:vitest:integration task task-graph` (or run the four new files individually). Expected behavior with the current runner:

- `run-vs-preview-isolation.test.ts`: `run() does not invoke executePreview()` FAILS — current runner overlays preview after execute.
- `preview-only-task-guard.test.ts`: `preview-only task throws TaskConfigurationError on run()` FAILS — no guard yet.
- `preview-return-semantics.test.ts`: `non-undefined return replaces runOutputData entirely (no merge)` FAILS — runner still merges.
- `runner-variants-no-preview-overlay.test.ts`: most or all assertions FAIL — variants still overlay.

This is the expected "red" state. Capture the failure list — Task 11 makes them all green.

- [ ] **Step 6: Commit (red state — failing tests written first)**

```bash
cd /workspaces/workglow/libs
git add packages/test/src/test/task/run-vs-preview-isolation.test.ts \
        packages/test/src/test/task/preview-only-task-guard.test.ts \
        packages/test/src/test/task/preview-return-semantics.test.ts \
        packages/test/src/test/task-graph/runner-variants-no-preview-overlay.test.ts
git commit -m "$(cat <<'EOF'
test(task-graph): add run-vs-preview isolation suite (failing — pre-Phase-5)

Phase 5a. Adds the four test files that encode the new contract:
isolation between run() and runPreview(), runtime guard for preview-only
tasks, no-merge return semantics for executePreview, and absence of
preview overlay in the runner variants. These intentionally fail under
the current overlay-based runner — Task 11 lands the runner change to
make them green.
EOF
)"
```

---

## Task 11: Phase 5b — Land the runner contract change and runtime guard

**Files (all in `libs/`):**
- Modify: `libs/packages/task-graph/src/task/TaskRunner.ts`
- Modify: `libs/packages/task-graph/src/task/GraphAsTaskRunner.ts`
- Modify: `libs/packages/task-graph/src/task/IteratorTaskRunner.ts`
- Modify: `libs/packages/task-graph/src/task/FallbackTaskRunner.ts`
- Modify: `libs/packages/task-graph/src/task/WhileTaskRunner.ts`

This is the cut. After this task lands, the runner stops overlaying preview after execute, cache hits return verbatim, the merge in `executeTaskPreview` is gone, and the runtime guard fires for preview-only tasks.

- [ ] **Step 1: Modify `TaskRunner.run()` cache-hit branches**

In `libs/packages/task-graph/src/task/TaskRunner.ts`, around lines 189–203 (the `if (this.task.cacheable)` block), change:

```ts
if (this.task.cacheable) {
  outputs = (await this.outputCache?.getOutput(this.task.type, inputs)) as Output;
  if (outputs) {
    this.telemetrySpan?.addEvent("workglow.task.cache_hit");
    if (isStreamable) {
      this.task.runOutputData = outputs;
      this.task.emit("stream_start");
      this.task.emit("stream_chunk", { type: "finish", data: outputs } as StreamEvent);
      this.task.emit("stream_end", outputs);
      // REMOVED: this.task.runOutputData = await this.executeTaskPreview(inputs, outputs);
    } else {
      this.task.runOutputData = outputs;
      // REMOVED: this.task.runOutputData = await this.executeTaskPreview(inputs, outputs);
    }
  }
}
```

Both branches now set `runOutputData = outputs` directly. No preview overlay.

- [ ] **Step 2: Modify `TaskRunner.executeTask()` to drop the overlay**

In `libs/packages/task-graph/src/task/TaskRunner.ts`, replace the body of `executeTask` (lines ~320–329):

```ts
protected async executeTask(input: Input): Promise<Output | undefined> {
  const result = await this.task.execute(input, {
    signal: this.abortController!.signal,
    updateProgress: this.handleProgress.bind(this),
    own: this.own,
    registry: this.registry,
    resourceScope: this.resourceScope,
  });
  return result;
}
```

(Removes the trailing `return await this.executeTaskPreview(input, result || ({} as Output));`.)

- [ ] **Step 3: Modify `TaskRunner.executeStreamingTask()` to drop the overlay**

In `libs/packages/task-graph/src/task/TaskRunner.ts`, the end of `executeStreamingTask` (lines ~487–502) becomes:

```ts
  // ...stream loop...
  if (this.abortController?.signal.aborted) {
    throw new TaskAbortedError("Task aborted during streaming");
  }

  if (finalOutput !== undefined) {
    this.task.runOutputData = finalOutput;
  }

  this.task.emit("stream_end", this.task.runOutputData as Output);

  return this.task.runOutputData as Output;
}
```

(Removes the final `const previewResult = await this.executeTaskPreview(...)` block.)

- [ ] **Step 4: Modify `TaskRunner.executeTaskPreview()` to drop the merge**

Change the body to:

```ts
protected async executeTaskPreview(input: Input): Promise<Output | undefined> {
  return this.task.executePreview(input, { own: this.own });
}
```

Note: the runner-internal `output` parameter is gone too, and the return type is `Promise<Output | undefined>` (was `Promise<Output>`). Callers in this file no longer pass `output`.

- [ ] **Step 5: Modify `TaskRunner.runPreview()` to handle undefined preview returns**

In the `runPreview` method (around lines 232–280), change the assignment after `executeTaskPreview`:

```ts
const resultPreview = await this.executeTaskPreview(inputs);
if (resultPreview !== undefined) {
  this.task.runOutputData = resultPreview;
}
```

(Was `this.task.runOutputData = resultReactive;`.)

- [ ] **Step 6: Add the runtime guard**

In `libs/packages/task-graph/src/task/TaskRunner.ts`, near the start of `run()` (just after `await this.handleStart(config);` at line ~136), add the guard:

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

- [ ] **Step 7: Modify `GraphAsTaskRunner.executeTaskPreview()` to drop the merge**

In `libs/packages/task-graph/src/task/GraphAsTaskRunner.ts`, replace the body at lines 90–102:

```ts
public override async executeTaskPreview(input: Input): Promise<Output | undefined> {
  if (this.task.hasChildren()) {
    const previewResults = await this.executeTaskChildrenPreview();
    this.task.runOutputData = this.task.subGraph.mergeExecuteOutputsToRunOutput(
      previewResults,
      this.task.compoundMerge
    );
    return this.task.runOutputData as Output;
  } else {
    const previewResult = await super.executeTaskPreview(input);
    if (previewResult !== undefined) {
      this.task.runOutputData = previewResult;
    }
    return this.task.runOutputData as Output;
  }
}
```

The compound branch is preserved (subgraph preview propagation still works); the single branch now uses the simplified base method and skips the merge.

- [ ] **Step 8: Modify `IteratorTaskRunner` to drop both overlay calls**

In `libs/packages/task-graph/src/task/IteratorTaskRunner.ts`:

- Lines 41–62 (`executeTask`): remove the two `return this.executeTaskPreview(input, ...)` calls. Return `emptyResult as Output` and `result as Output` directly.

```ts
protected override async executeTask(input: Input): Promise<Output | undefined> {
  let analysis = this.task.analyzeIterationInput(input);

  const maxIterations = resolveIterationBound(this.task.config.maxIterations);
  if (analysis.iterationCount > maxIterations) {
    analysis = { ...analysis, iterationCount: maxIterations };
  }

  if (analysis.iterationCount === 0) {
    return this.task.getEmptyResult() as Output;
  }

  const result = this.task.isReduceTask()
    ? await this.executeReduceIterations(analysis)
    : await this.executeCollectIterations(analysis);

  return result as Output;
}
```

- Lines 67–70 (`executeTaskPreview` override): replace with the no-merge form:

```ts
public override async executeTaskPreview(input: Input): Promise<Output | undefined> {
  return this.task.executePreview(input, { own: this.own });
}
```

- Replace the misleading comment at line 38 ("For iterator tasks, reactive runs use full execution for correctness.") with: `For iterator tasks, runPreview() invokes only the task's executePreview hook — it does not iterate the subgraph.`

- [ ] **Step 9: Modify `FallbackTaskRunner` to drop the overlay calls**

In `libs/packages/task-graph/src/task/FallbackTaskRunner.ts`:

- Line 89 (`executeTaskFallback`): replace `return (await this.executeTaskPreview(input, result as Output)) as Output;` with `return result as Output;`. Remove the comment "Apply reactive post-processing".
- Line 184 (`executeDataFallback`): replace `return (await this.executeTaskPreview(input, mergedOutput)) as Output;` with `return mergedOutput as Output;`. Remove the comment.
- Lines 41–44 (`executeTaskPreview` override): replace with the no-merge form like in Step 8.

- [ ] **Step 10: Modify `WhileTaskRunner.executeTaskPreview()` to drop the merge**

In `libs/packages/task-graph/src/task/WhileTaskRunner.ts`, lines 44–47:

```ts
public override async executeTaskPreview(input: Input): Promise<Output | undefined> {
  return this.task.executePreview(input, { own: this.own });
}
```

The `executeTask` override (lines 30–39) is already aligned with the new contract — no change needed.

- [ ] **Step 11: Run the new tests and verify they PASS**

Run from libs root:
```bash
bun run test:vitest:integration task task-graph
```
Expected: the four new test files from Task 10 are all green. If a test still fails, the runner change is incomplete — re-read steps 1–10.

- [ ] **Step 12: Run the full libs test suite**

Run from libs root: `bun run test`
Expected: most tests pass, **but** existing tests that asserted the old contract may fail (e.g., `SingleTask.test.ts` assertions on post-run reactive merge). Capture the failure list — Task 12 reverses those assertions.

- [ ] **Step 13: Commit**

```bash
cd /workspaces/workglow/libs
git add packages/task-graph/
git commit -m "$(cat <<'EOF'
feat(task-graph): split run() from runPreview() — drop reactive overlay

Phase 5b — the cut. TaskRunner.run() no longer invokes executeTaskPreview
after execute() or after stream completion. Cache hits return cached
output verbatim. The Object.assign merge in executeTaskPreview is gone:
preview returns either a full Output (replaces runOutputData) or
undefined (leaves it alone). Adds the runtime guard that throws
TaskConfigurationError when a task overrides executePreview() but not
execute(). Runner variants (Iterator, Fallback, While, GraphAsTask)
updated in lock-step. New tests in run-vs-preview-isolation,
preview-only-task-guard, preview-return-semantics, and
runner-variants-no-preview-overlay all pass.
EOF
)"
```

---

## Task 12: Phase 5c — Update existing tests that asserted the old contract

**Files (all in `libs/`):**
- Modify: `libs/packages/test/src/test/task/SingleTask.test.ts`
- Modify: `libs/packages/test/src/test/task/GraphAsTask.test.ts`
- Modify: `libs/packages/test/src/test/task/ArrayTask.test.ts`
- Modify: `libs/packages/test/src/test/task/LambdaTask.test.ts`
- Modify: `libs/packages/test/src/test/task-graph/TaskGraphRunner.test.ts`
- Modify: tests under `libs/packages/test/src/test/task-graph-output-cache/` that assert post-cache-hit reactive overlay.
- Modify: any other test surfaced by the Task 11 Step 12 failure list.

- [ ] **Step 1: Inventory failing tests from Task 11**

From the failure list captured in Task 11 Step 12, list each failing test's file and assertion. Each failure is one of three patterns:

A. Asserts `executePreview` was called after `run()` → reverse: assert it was NOT called.
B. Asserts merged result on cache hit (preview overlaid on cached output) → reverse: assert verbatim cached output.
C. Asserts merged result on streaming run() → reverse: assert verbatim streamed output.

- [ ] **Step 2: Update assertions per file**

For each failing assertion, edit the test to match the new contract. Examples:

In `SingleTask.test.ts`, an assertion like:
```ts
expect(task.executePreview).toHaveBeenCalledAfter(task.execute);
```
becomes:
```ts
expect(task.executePreview).not.toHaveBeenCalled();
```

In `task-graph-output-cache/*` tests, an assertion that cache-hit output includes preview-merged fields becomes an assertion that cache-hit output equals what `execute()` originally produced.

In `LambdaTask.test.ts`, any test that exercised the cross-call fallback (preview falling back to execute or vice versa) needs its expectation updated to reflect the Phase 4 policy: each path uses its own config function only.

- [ ] **Step 3: Run the libs test suite**

Run from libs root: `bun run test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/workglow/libs
git add packages/test/
git commit -m "$(cat <<'EOF'
test: update existing assertions for the new run/runPreview contract

Phase 5c. Reverses assertions in SingleTask, GraphAsTask, ArrayTask,
LambdaTask, TaskGraphRunner, and task-graph-output-cache tests that
encoded the old reactive-overlay contract. Each updated assertion now
checks that run() does not invoke executePreview, cache hits return
verbatim, and runner variants do not overlay preview after their
execute paths.
EOF
)"
```

---

## Task 13: Phase 5d — Doc rewrite

**Files:**
- Modify: `libs/docs/technical/02-dual-mode-execution.md`
- Modify: `libs/packages/task-graph/src/EXECUTION_MODEL.md`
- Modify: `libs/packages/task-graph/src/task/README.md`
- Modify: `builder/packages/app/src/components/workflow/README.md`
- Modify: `builder/packages/app/src/components/brand/workglow.dev/help/library/reference.mdx`
- Modify: `builder/packages/app/src/components/brand/workglow.dev/help/library/advanced_topics.mdx`
- Modify: `builder/packages/app/src/components/brand/workglow.dev/blog/post/20260112-two-modes-one-pipeline.mdx`
- Modify: `builder/packages/app/src/components/brand/workglow.dev/blog/post/20260105-inside-the-engine-room.mdx`
- Modify: `builder/packages/app/src/components/brand/workglow.dev/blog/post/20260223-worker-system.mdx`
- Modify: `builder/packages/app/src/components/brand/workglow.dev/blog/post/20260316-ai-provider-system.mdx`

- [ ] **Step 1: Rewrite `libs/docs/technical/02-dual-mode-execution.md`**

This is the heaviest rewrite. Required changes:

- Replace step 8 of "Full Execution: run()" — current text says "Then: executeTaskReactive(input, output) — merge reactive overlay". New text: "`execute()` (or `executeStream()`) is the only path called by `run()`. There is no preview overlay."
- Replace the cache-hit pseudo-code in "Caching Integration" (current lines ~317–335). New version:

```typescript
if (task.cacheable) {
  const cached = await outputCache.getOutput(task.type, inputs);
  if (cached) {
    // Cache hit: return cached output verbatim. No preview overlay.
    task.runOutputData = cached;
    return;
  }
}

const result = await task.execute(input, context);
if (task.cacheable && result !== undefined) {
  await outputCache.saveOutput(task.type, inputs, result);
}
```

- Replace the "Pattern: Progressive Preview" example (current lines ~487–501) with the canonical shared-helper pattern from the spec:

```typescript
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

- Update the "API Reference" tables: rename `executeReactive` → `executePreview`, `runReactive` → `runPreview`. Drop `output` from the `executePreview` row. Drop the row that documents the post-run reactive overlay.
- Rename "Cache and Reactive Execution" subsection → "Cache and Preview Execution".
- Add a new section "**Why preview is not called by run()**":

```markdown
## Why preview is not called by run()

Earlier versions of the task graph engine invoked `executeReactive()` after every
full `run()` and on every cache hit, treating it as a hidden second stage of
committed execution. That coupling caused several problems:

- The cached output was not actually the value returned by `run()` — preview
  could modify it after retrieval.
- Streaming tasks emitted a `finish` event whose payload was then mutated before
  the caller saw it.
- Tasks that implemented only `executeReactive()` produced results during full
  runs by accident — preview was load-bearing.

The current contract makes each method mean exactly one thing:

- `execute()` and `executeStream()` produce the committed output. `run()` calls
  one of them and returns the result.
- `executePreview()` produces a low-fidelity preview. `runPreview()` is the only
  path that calls it, used by the editor while a task is PENDING.

Cache hits return the cached value verbatim. Tasks that need preview behavior
must implement both methods (typically via a shared helper).
```

- Add a new section "**Runtime guard for preview-only tasks**":

```markdown
## Runtime guard for preview-only tasks

A task that overrides `executePreview()` but not `execute()` cannot be run via
`run()`. The runner detects this on the first `run()` call and throws
`TaskConfigurationError` with a message identifying the task type.

This is loud-fail by design: under the previous contract, preview-only tasks
silently produced output via the post-execute overlay. Under the new contract,
they must declare themselves as either preview-only (and only ever be called
via `runPreview()`) or implement `execute()` for full runs.
```

- Rewrite the summary table at the bottom to reflect the new contract.

- [ ] **Step 2: Rewrite `libs/packages/task-graph/src/EXECUTION_MODEL.md`**

Audit and rewrite as needed. Apply the same renames and remove any descriptions of post-run reactive overlay. Use the new section content from Step 1 where it fits.

- [ ] **Step 3: Update `libs/packages/task-graph/src/task/README.md`**

Light pass: rename references; check for any flow descriptions that mention preview-after-execute.

- [ ] **Step 4: Update `builder/packages/app/src/components/workflow/README.md`**

Light pass: rename references.

- [ ] **Step 5: Update help mdx files**

For `builder/packages/app/src/components/brand/workglow.dev/help/library/reference.mdx` and `advanced_topics.mdx`:
- Rename `executeReactive` → `executePreview`, `runReactive` → `runPreview`.
- Drop `output` from any documented `executePreview` signature.
- Update any prose describing reactive overlay or post-run preview behavior.

- [ ] **Step 6: Rewrite `20260112-two-modes-one-pipeline.mdx`**

This blog post's premise is the dual-mode interplay. Read the post and decide:
- If the post can be rewritten to describe the **new** two-mode contract (run vs preview as cleanly orthogonal), do that. The post becomes a clearer explanation of why the two modes exist as separate paths.
- If the post's narrative depends on the overlay behavior (e.g., it argues "look how cleverly preview augments full output"), and a rewrite would gut the substance, replace the post with a brief note: "(historical post — superseded by [the new two-mode contract](link))".

- [ ] **Step 7: Update other blog posts**

For `20260105-inside-the-engine-room.mdx`, `20260223-worker-system.mdx`, `20260316-ai-provider-system.mdx`: audit each for references to `executeReactive`, `runReactive`, `*_REACTIVE_TASKS`. Apply renames. Update any prose claiming preview is part of normal execution or that the AI provider preview registry is invoked during full runs.

- [ ] **Step 8: Final grep verification**

```bash
cd /workspaces/workglow/libs && grep -rn "executeReactive\|runReactive\|IExecuteReactiveContext\|REACTIVE_TASKS\|_Reactive" .  --include="*.ts" --include="*.tsx" --include="*.md" --include="*.mdx" 2>&1 | head -40
cd /workspaces/workglow/builder && grep -rn "executeReactive\|runReactive\|IExecuteReactiveContext" packages/ --include="*.ts" --include="*.tsx" --include="*.md" --include="*.mdx" 2>&1 | head -40
```
Expected: no hits in production code or active docs. Acceptable hits: a single migration note in the new `02-dual-mode-execution.md` "Why preview is not called by run()" section if you want one.

- [ ] **Step 9: Commit (libs docs)**

```bash
cd /workspaces/workglow/libs
git add docs/ packages/task-graph/src/EXECUTION_MODEL.md packages/task-graph/src/task/README.md
git commit -m "$(cat <<'EOF'
docs: rewrite dual-mode execution to describe the run/runPreview contract

Phase 5d (libs side). Rewrites 02-dual-mode-execution.md and
EXECUTION_MODEL.md to describe the new contract: run() invokes only
execute()/executeStream(); cache hits return verbatim; executePreview()
is called only by runPreview(); runtime guard throws for preview-only
tasks. Replaces the Progressive Preview pattern with the shared-helper
pattern. Renames methods and types throughout.
EOF
)"
```

- [ ] **Step 10: Commit (builder docs)**

```bash
cd /workspaces/workglow/builder
git add packages/app/src/components/workflow/README.md \
        packages/app/src/components/brand/workglow.dev/help/ \
        packages/app/src/components/brand/workglow.dev/blog/
git commit -m "$(cat <<'EOF'
docs: update help and blog posts for run/runPreview contract

Phase 5d (builder side). Updates reference.mdx, advanced_topics.mdx, and
the four blog posts that described the old reactive-overlay model.
Renames executeReactive -> executePreview throughout, removes claims
that preview is part of normal execution, and rewrites or replaces the
two-modes blog post.
EOF
)"
```

---

## Task 14: Final verification

- [ ] **Step 1: Repo-wide grep for stale symbols**

```bash
cd /workspaces/workglow/libs && grep -rn "executeReactive\|runReactive\|IExecuteReactiveContext\|REACTIVE_TASKS\|AiProviderReactiveRunFn\|getReactiveRunFn" . --include="*.ts" --include="*.tsx" 2>&1
cd /workspaces/workglow/builder && grep -rn "executeReactive\|runReactive\|IExecuteReactiveContext" packages/ --include="*.ts" --include="*.tsx" 2>&1
```
Expected: zero hits in either repo. Any remaining hit is an oversight; fix it before moving on.

- [ ] **Step 2: Audit composite task classes for late additions of `executePreview`**

```bash
cd /workspaces/workglow/libs && grep -n "executePreview" packages/task-graph/src/task/IteratorTask.ts packages/task-graph/src/task/FallbackTask.ts packages/task-graph/src/task/WhileTask.ts packages/task-graph/src/task/GraphAsTask.ts packages/task-graph/src/task/MapTask.ts packages/task-graph/src/task/ReduceTask.ts packages/task-graph/src/task/ConditionalTask.ts 2>&1
```
Expected: zero hits. (If any composite task class added an `executePreview` override during the migration, audit whether it does real work that should have been migrated to `execute()`.)

- [ ] **Step 3: Full type check (both repos)**

```bash
cd /workspaces/workglow/libs && bun run build:types
cd /workspaces/workglow/builder && npx tsc --noEmit -p packages/app
```
Expected: no errors.

- [ ] **Step 4: Full test suite (both repos)**

```bash
cd /workspaces/workglow/libs && bun run test
cd /workspaces/workglow/builder && bun run test
```
Expected: all green.

- [ ] **Step 5: Manual smoke test of the builder editor**

```bash
cd /workspaces/workglow/builder && bun run dev
```
- Open `http://localhost:5173`
- Open a project with a workflow containing string/template/regex/image tasks
- Edit input on each task and confirm live preview updates immediately (preview path).
- Press Run and confirm the workflow executes and produces final output (execute path).
- Run again to confirm cache hits return the same output without re-running.
- Stop the dev server.

- [ ] **Step 6: Final commit if any cleanup needed**

If Steps 1–5 surfaced any oversights, fix them and commit:

```bash
cd /workspaces/workglow/<repo>
git add <files>
git commit -m "fix: <specific oversight>"
```

If everything is clean, this task is just a verification pass — no commit needed.

---

## Self-Review Notes

- **Spec coverage**: every spec section is represented. Phase 0 → Tasks 1–5. Phase 1 → Task 6. Phase 2 → Task 7. Phase 3 → Task 8. Phase 4 → Task 9. Phase 5 → Tasks 10–13. Verification → Task 14.
- **Type consistency**: methods are named `executePreview` and `runPreview` throughout, contexts are `IExecutePreviewContext`, registry types are `AiProviderPreviewRunFn` / `getPreviewRunFn`, provider maps are `*_PREVIEW_TASKS`, provider fns are `*_Preview`.
- **TDD ordering**: Task 10 (failing tests for the new contract) comes before Task 11 (the runner change that makes them pass). Existing tests that encoded the old contract are reversed in Task 12, after the new behavior is in place.
- **Cross-repo**: tasks call out which repo each commit happens in. Builder smoke test in Task 5 confirms the rename pass didn't break the editor's live preview.
- **No backward compatibility shims**: per the spec's explicit "no backward compat" decision, no aliases, no deprecation warnings, no transitional re-exports.
