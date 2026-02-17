# workglow

Convenience meta-package that re-exports all Workglow packages for single-import usage.

## Overview

The `workglow` package is a single entry point that re-exports all `@workglow/*` packages (except `@workglow/test`). Instead of installing and importing from multiple packages, you can use `workglow` to get everything in one import.

## Features

- **Single Import**: Access all Workglow APIs from one package
- **Multi-Platform**: Browser, Node.js, and Bun entry points
- **Debug in Browser**: `@workglow/debug` (Chrome DevTools formatters) is included only in the browser build
- **Provider Subpaths**: Opt-in provider subpath exports (`workglow/anthropic`, `workglow/openai`, etc.) preserve lazy SDK loading
- **All Optional Peers Surfaced**: AI SDKs and storage backends are optional peer dependencies -- install only what you need

## Installation

```bash
bun add workglow
```

## Quick Start

```typescript
import { Workflow, TextGenerationTask, HuggingFaceTransformersProvider } from "workglow";
import { HFT_TASKS } from "workglow/hf-transformers";

// Register a provider
await new HuggingFaceTransformersProvider(HFT_TASKS).register({ mode: "inline" });

// Create and run a workflow
const workflow = new Workflow();
workflow.addTask(new TextGenerationTask({ input: { prompt: "Hello, world!" } }));
const result = await workflow.run();
```

## Included Packages

| Package                 | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `@workglow/util`        | Utility functions and shared types                              |
| `@workglow/sqlite`      | Cross-platform SQLite (browser, Node.js, Bun)                   |
| `@workglow/storage`     | Storage abstraction (IndexedDB, PostgreSQL, Supabase)           |
| `@workglow/job-queue`   | Job queue management and task scheduling                        |
| `@workglow/task-graph`  | DAG task graph construction and execution                       |
| `@workglow/dataset`     | Dataset and document management                                 |
| `@workglow/ai`          | Core AI functionality, tasks, and model management              |
| `@workglow/ai-provider` | AI provider integrations (constants, schemas, provider classes) |
| `@workglow/tasks`       | Pre-built utility tasks (arrays, scalars, vectors, etc.)        |
| `@workglow/debug`       | Chrome DevTools custom formatters (browser only)                |

## Provider Subpath Exports

SDK-dependent code is isolated behind subpath exports to keep the main entry point free of heavy dependencies. Each subpath mirrors the corresponding `@workglow/ai-provider` subpath:

```typescript
// Anthropic (requires: @anthropic-ai/sdk)
import { ANTHROPIC_TASKS } from "workglow/anthropic";

// Google Gemini (requires: @google/generative-ai)
import { GEMINI_TASKS } from "workglow/google-gemini";

// HuggingFace Transformers (requires: @sroussey/transformers)
import { HFT_TASKS } from "workglow/hf-transformers";

// Ollama (requires: ollama)
import { OLLAMA_TASKS } from "workglow/ollama";

// OpenAI (requires: openai)
import { OPENAI_TASKS } from "workglow/openai";

// TensorFlow MediaPipe (requires: @mediapipe/tasks-*)
import { TFMP_TASKS } from "workglow/tf-mediapipe";
```

## Optional Peer Dependencies

Install only the providers and backends you need:

```bash
# AI Provider SDKs
bun add @anthropic-ai/sdk        # For Anthropic
bun add @google/generative-ai    # For Google Gemini
bun add @sroussey/transformers   # For HuggingFace Transformers ONNX
bun add ollama                   # For Ollama
bun add openai                   # For OpenAI

# MediaPipe (browser-only ML)
bun add @mediapipe/tasks-text @mediapipe/tasks-vision @mediapipe/tasks-audio @mediapipe/tasks-genai

# Storage backends
bun add @sqlite.org/sqlite-wasm   # Browser SQLite
bun add better-sqlite3            # Node.js/Bun SQLite
bun add pg                        # PostgreSQL
bun add @supabase/supabase-js     # Supabase
```

## License

Apache-2.0
