# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
bun run build              # Full build (all packages + examples, via Turbo)
bun run build:packages     # Build packages only
bun run build:types        # Build type declarations only
bun run watch              # Watch mode (Turbo, concurrency 15)
bun run dev                # Turbo dev mode

bun run test               # All tests (bun test + vitest)
bun run test:bun           # Bun native tests only
bun run test:vitest        # Vitest tests only
bun test <testfilename>    # Run a specific test file

bun run format             # ESLint fix + Prettier write
bun run clean              # Remove dist, node_modules, .turbo, tsbuildinfo
```

## Monorepo structure

Bun workspaces + Turborepo. All packages live in `packages/`. Build order is managed by Turbo's dependency graph (`turbo.json`).

### Dependency graph

```
util, sqlite                          (foundation, no workglow deps)
    ↓
storage                               (KV, Tabular, Queue, Vector abstractions)
    ↓
job-queue                             (scheduling, rate-limiting)
    ↓
task-graph                            (core DAG pipeline engine)
    ↓
dataset, tasks                        (KnowledgeBase, documents, chunks; utility tasks)
    ↓
ai                                    (AI task base classes, model registry)
    ↓
ai-provider                           (concrete provider implementations)
    ↓
test                                  (integration tests across all packages)
workglow                              (meta-package re-exporting everything)
debug                                 (Chrome DevTools formatters)
```

### Per-package build

Each package builds three runtime targets via `bun build --splitting --target=X`:

- `src/browser.ts` → `dist/browser.js`
- `src/node.ts` → `dist/node.js`
- `src/bun.ts` → `dist/bun.js`
- `src/common.ts` — shared exports re-exported by all three

Types built with `tsc` (composite + incremental). Conditional exports in `package.json` resolve automatically per runtime.

Exception: `ai-provider` builds per-provider sub-paths (`./anthropic`, `./openai`, `./google-gemini`, etc.) instead of browser/node/bun.

## Code style

### TypeScript rules (from `.cursor/rules/`)

- **No default exports** — always named exports (except framework-required)
- **No enums** — use `as const` objects, derive types with `keyof typeof`
- **`interface extends`** over `&` intersection (performance)
- **`readonly`** properties by default; omit only when genuinely mutable
- **`T | undefined`** over `T?` optional — force callers to be explicit
- **Discriminated unions** over bags of optionals
- **Declare return types** on top-level module functions (exception: JSX components)
- **`import type`** for type-only imports; prefer top-level `import type { T }` over inline `import { type T }`
- **Never import from** files named `index`, `node`, `bun`, `browser`, `common` — import from the specific module
- **`any` in generics is OK** when TS can't match runtime logic to types; outside generics, use `any` sparingly — default to `unknown`
- **Interface prefix**: `I` for public interfaces (`ITask`, `IKvStorage`, `IWorkflow`)
- **Concise JSDoc** only when behavior isn't self-evident; use `@link`; no comments for obvious code

### Formatting (`.prettierrc`)

Spaces (not tabs), double quotes, semicolons, trailing commas (es5), 100 char print width.

### License header

All source files: `@license Copyright 2025 Steven Roussey ... SPDX-License-Identifier: Apache-2.0`

## Key packages

### `@workglow/task-graph` — core engine

The heart of the library. See `packages/task-graph/README.md` and `src/EXECUTION_MODEL.md`.

**Task** — base class for all pipeline nodes. Subclass and implement `execute()` and optionally `executeReactive()`:

```ts
class MyTask extends Task<MyInput, MyOutput> {
  static readonly type = "MyTask";
  static readonly category = "Custom";
  static inputSchema(): DataPortSchema { return { type: "object", properties: { ... } } as const satisfies DataPortSchema; }
  static outputSchema(): DataPortSchema { ... }
  async execute(input: MyInput): Promise<MyOutput> { ... }
}
```

Required static properties: `type`, `category`, `title`, `description`, `cacheable`, `inputSchema()`, `outputSchema()`.

**TaskGraph** — low-level DAG: `addTask`, `addDataflow`, `run`, `runReactive`.

**Workflow** — high-level builder: `addTask`, `pipe(...tasks)`, `parallel(tasks)`, `run`.

**Control flow tasks**: `GraphAsTask` (subgraph), `IteratorTask`, `MapTask`, `ReduceTask`, `WhileTask`, `ConditionalTask`.

**Execution model**:

- `run()` → `execute()` — full run, cached, sets task to COMPLETED
- `runReactive()` → `executeReactive()` — lightweight, UI previews only, keeps PENDING, must be <1ms
- Lifecycle: `PENDING → PROCESSING → COMPLETED | FAILED | ABORTED`

**Schema conventions**: JSON Schema objects. Properties can have `format` annotations for runtime type resolution: `format: "model"`, `format: "model:EmbeddingTask"`, `format: "storage:tabular"`, `format: "knowledge-base"`. Properties with `x-ui-manual: true` are user-added ports.

**TaskRegistry** — global class registry: `TaskRegistry.registerTask(MyTask)`.

### `@workglow/storage` — storage abstraction

Unified interfaces across backends: `IKvStorage`, `ITabularStorage`, `IQueueStorage`, `IVectorStorage`.

Backends: InMemory, SQLite, PostgreSQL, Supabase, IndexedDB (browser), FsFolder.

Event-driven: storages emit `put`, `get`, `delete`, `deleteAll`.

Auto-generated PKs: `x-auto-generated: true` in schema — integers auto-increment, strings get UUID.

### `@workglow/knowledge-base` — knowledge base & documents

`KnowledgeBase` — unified class owning both document storage (tabular) and chunk storage (vector).

- `createKnowledgeBase({ name, vectorDimensions })` — factory (in-memory, auto-registers)
- `registerKnowledgeBase(id, kb)` / `getKnowledgeBase(id)` / `getGlobalKnowledgeBases()` — global registry
- `TypeKnowledgeBase()` — JSON Schema helper for task inputs (format `"knowledge-base"`)
- `Document` — wraps a `DocumentRootNode` tree + metadata
- `ChunkRecord` — flat chunk with tree linkage (`nodePath`, `depth`)
- `ChunkVectorStorageSchema` / `ChunkVectorPrimaryKey` — vector storage schema for chunks

Key methods: `kb.upsertDocument()`, `kb.upsertChunk()`, `kb.similaritySearch()`, `kb.clearChunks()`, `kb.getAllChunks()`, `kb.putBulk()`, `kb.deleteDocument()` (cascades to chunks).

RAG tasks reference knowledge bases by string ID (resolved from registry at runtime): `ChunkVectorUpsertTask({ knowledgeBase: "my-kb" })`, `ChunkRetrievalTask({ knowledgeBase: "my-kb" })`.

### `@workglow/ai` — AI task framework

Abstract AI task classes (`AiTask`, `StreamingAiTask`, `AiVisionTask`) extending `JobQueueTask` for rate-limiting.

Model system: `ModelRepository`, `ModelRegistry`, `AiProviderRegistry`.

Task categories: text generation/embedding/summary/translation/rewriting/classification, image classification/embedding/segmentation, RAG (chunking, vector search, retrieval, reranking), vision/pose detection.

RAG tasks: `ChunkToVectorTask` (input: `vector` + `chunks` → output: `vectors`), `ChunkVectorUpsertTask` (input: `knowledgeBase` + `vectors`), `ChunkRetrievalTask` (input: `knowledgeBase` + `query` + `model`), `ChunkVectorSearchTask`, `ChunkVectorHybridSearchTask`, `HierarchyJoinTask`.

### `@workglow/ai-provider` — provider implementations

Each provider is a separate sub-export with optional peer dependencies:

- `@workglow/ai-provider/anthropic` — Claude
- `@workglow/ai-provider/openai` — OpenAI
- `@workglow/ai-provider/google-gemini` — Gemini
- `@workglow/ai-provider/ollama` — Ollama (browser + node)
- `@workglow/ai-provider/hf-transformers` — HuggingFace Transformers.js
- `@workglow/ai-provider/hf-inference` — HuggingFace Inference API
- `@workglow/ai-provider/llamacpp` — node-llama-cpp
- `@workglow/ai-provider/tf-mediapipe` — TensorFlow MediaPipe (browser)

**Important: `*_JobRunFns.ts` files execute inside workers.** Workers have an isolated runtime with a separate `globalServiceRegistry`. Do not access main-thread-only state (e.g., credential stores, service registries) from run functions. Instead, resolve such state in the task class on the main thread (e.g., `AiTask.getJobInput()`) and pass the resolved values through the serialized job input.

### `@workglow/util` — shared utilities

`EventEmitter`, `ServiceRegistry` (DI), `DirectedAcyclicGraph`, `DataPortSchema`/`JsonSchema` types, `SchemaUtils`/`SchemaValidation`, `uuid4`, `sleep`, `WorkerManager`/`WorkerServer`, vector math, tensor types.

### `@workglow/tasks` — utility tasks

Pre-built tasks: `InputTask`, `OutputTask`, `LambdaTask`, `DelayTask`, `FetchUrlTask`, `JavaScriptTask`, `JsonTask`, `MergeTask`, `SplitTask`, `ArrayTask`, MCP tasks, scalar/vector math tasks. Register all via `registerCommonTasks()`.

## Testing patterns

Tests live primarily in `packages/test/src/test/`. Both `bun test` and `vitest` are used.

```ts
import { describe, expect, it, beforeEach } from "vitest";
```

Generic test suites are extracted to shared helpers (e.g., `runGenericJobQueueTests`) and called with different storage backends. Conditional execution via `describe.skipIf(!RUN_QUEUE_TESTS)`.

Test task pattern — define inline with `as const satisfies DataPortSchema`:

```ts
class TestTask extends Task<TestInput, TestOutput> {
  static readonly type = "TestTask";
  static inputSchema(): DataPortSchema { return { ... } as const satisfies DataPortSchema; }
  static outputSchema(): DataPortSchema { return { ... } as const satisfies DataPortSchema; }
  async execute(input: TestInput) { return { result: input.value }; }
}
```
