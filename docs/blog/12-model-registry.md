<!--
 @license
 Copyright 2025 Steven Roussey <sroussey@gmail.com>
 SPDX-License-Identifier: Apache-2.0
-->

# How Workglow Knows Which Model to Call: The Model Registry and Repository System

*"Hey, I need an embedding model."*

It sounds like a simple request. But behind those five words is a surprisingly tricky problem
that every AI pipeline framework eventually has to solve: **discovery**. How does a task running
inside a DAG pipeline know which models are available? Which ones are compatible with the work
it needs to do? And how does it get the provider-specific configuration needed to actually call
the model, without hard-coding any of it?

Workglow's answer is the **Model Registry and Repository** system -- a clean, event-driven
architecture that decouples model catalog management from task execution. Let's walk through
how it works, layer by layer.

---

## The Discovery Problem

Imagine you're building a RAG pipeline. You have a `TextEmbeddingTask` that needs to turn
chunks of text into vectors. Somewhere in your system, you've registered an Anthropic provider,
an OpenAI provider, and a local HuggingFace Transformers ONNX provider. Some of those providers
offer embedding models. Some don't. Anthropic, for example, has no embeddings API at all.

The task shouldn't need to know any of this. It should declare "I need a model" in its input
schema, and the framework should figure out the rest. That's exactly what happens:

```typescript
// Inside TextEmbeddingTask
const modelSchema = TypeModel("model:TextEmbeddingTask");

export const TextEmbeddingInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    text: { type: "string", title: "Text", description: "The text to embed" },
  },
  required: ["model", "text"],
} as const satisfies DataPortSchema;
```

That `format: "model:TextEmbeddingTask"` annotation is the key. It tells the input resolver
system: "this field is a model reference, and it must be compatible with `TextEmbeddingTask`."
The pipeline framework handles the rest -- looking up the model by ID, verifying compatibility,
and injecting the full configuration at runtime.

But who stores those models? Who validates compatibility? That's where the Repository comes in.

---

## ModelConfig vs ModelRecord: Two Sides of the Same Coin

The system draws a careful line between two representations of a model.

**`ModelConfig`** is the lightweight, portable form. It carries just enough information to
execute a task: the provider name and provider-specific configuration. It's what gets serialized
into job inputs and passed across thread boundaries into Web Workers.

```typescript
export const ModelConfigSchema = {
  type: "object",
  properties: {
    model_id: { type: "string" },
    tasks: { type: "array", items: { type: "string" } },
    title: { type: "string" },
    description: { type: "string" },
    provider: { type: "string" },
    provider_config: {
      type: "object",
      properties: {
        credential_key: { type: "string", format: "credential" },
      },
      additionalProperties: true,
      default: {},
    },
    metadata: { type: "object", default: {} },
  },
  required: ["provider", "provider_config"],
  format: "model",
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;
```

Notice that `ModelConfig` only requires `provider` and `provider_config`. The ID, title, and
tasks are optional. This is deliberate: when a job runs inside a Web Worker, it doesn't need
access to the model repository. It just needs the provider name and enough config to make the
API call.

**`ModelRecord`** is the full, persistent form. It requires everything -- `model_id`, `tasks`,
`title`, `description`, `provider`, `provider_config`, and `metadata`. This is what gets stored
in the repository and used for discovery, filtering, and UI display.

```typescript
export const ModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
  },
  required: [
    "model_id", "tasks", "provider",
    "title", "description", "provider_config", "metadata",
  ],
  format: "model",
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
```

The relationship is intentional: `ModelRecord` is a strict superset of `ModelConfig`.
Every `ModelRecord` is a valid `ModelConfig`, but not every `ModelConfig` is a valid record.
This means the resolver can look up a model by ID, return the full record, and the job system
can pass it through to a worker without any transformation.

---

## ModelRepository: The Catalog with a Pulse

The `ModelRepository` class is an abstract base that wraps a `ITabularStorage` backend
and adds event-driven lifecycle management. It's not just a database -- it's a living catalog
that notifies listeners when the model landscape changes.

```typescript
export type ModelEventListeners = {
  model_added: (model: ModelRecord) => void;
  model_removed: (model: ModelRecord) => void;
  model_updated: (model: ModelRecord) => void;
};
```

Every time a model is added or removed, the repository emits an event. UI components can
subscribe to `model_added` to update a dropdown in real time. Testing harnesses can use
`waitOn("model_added")` to synchronize setup. The event system is the same `EventEmitter`
used throughout the Workglow stack, so it's familiar and consistent.

The core API is straightforward:

```typescript
// Add a model to the catalog
await repository.addModel({
  model_id: "anthropic:claude-haiku",
  title: "Claude Haiku",
  description: "Fast, affordable Claude model",
  tasks: ["TextGenerationTask", "TextRewriterTask", "TextSummaryTask"],
  provider: "ANTHROPIC",
  provider_config: { model_name: "claude-haiku-4-5-20251001" },
  metadata: {},
});

// Find a model by ID
const model = await repository.findByName("anthropic:claude-haiku");

// Find all models that support a specific task
const embeddingModels = await repository.findModelsByTask("TextEmbeddingTask");

// Find what tasks a specific model supports
const tasks = await repository.findTasksByModel("anthropic:claude-haiku");

// Get the full catalog
const allModels = await repository.enumerateAllModels();
```

The storage backend is pluggable. The repository constructor accepts any `ITabularStorage`
implementation -- the same abstraction used for document storage, queue persistence, and
everything else in Workglow. This means the model catalog can live in memory, in SQLite,
in PostgreSQL, or in IndexedDB, depending on your deployment.

---

## The ModelRegistry Singleton: Global Access via DI

Workglow uses a `ServiceRegistry` (dependency injection container) for global singletons.
The model repository is no exception:

```typescript
export const MODEL_REPOSITORY =
  createServiceToken<ModelRepository>("model.repository");

// Register default factory if not already registered
if (!globalServiceRegistry.has(MODEL_REPOSITORY)) {
  globalServiceRegistry.register(
    MODEL_REPOSITORY,
    (): ModelRepository => new InMemoryModelRepository(),
    true  // singleton
  );
}
```

By default, you get an `InMemoryModelRepository`. But you can swap it out at any time:

```typescript
import { setGlobalModelRepository } from "@workglow/ai";
import { SqliteModelRepository } from "./my-sqlite-repo";

setGlobalModelRepository(new SqliteModelRepository(db));
```

The `getGlobalModelRepository()` function is the standard access point. Every part of the
system -- tasks, resolvers, UI components -- goes through this function, which delegates to
the service registry. This means swapping the repository implementation is a one-liner that
takes effect globally.

---

## Model-Task Compatibility: The `tasks` Array

Every `ModelRecord` carries a `tasks` array listing which task types it supports:

```typescript
{
  model_id: "onnx:Xenova/all-MiniLM-L6-v2:q8",
  title: "All MiniLM L6 V2 384D",
  tasks: ["TextEmbeddingTask"],
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: {
    pipeline: "feature-extraction",
    model_path: "Xenova/all-MiniLM-L6-v2",
    native_dimensions: 384,
    dtype: "q8",
  },
  // ...
}
```

This array is the single source of truth for compatibility. When the UI needs to populate
a model selector for a `TextGenerationTask`, it calls `findModelsByTask("TextGenerationTask")`
and gets back only the models that have declared support. When a task input has
`format: "model:TextEmbeddingTask"`, the resolver can filter accordingly.

Some models support multiple tasks. The CLIP model, for instance, handles both
`ImageClassificationTask` and `ImageEmbeddingTask`. The BGE Reranker supports both
`TextClassificationTask` and `RerankerTask`. The `tasks` array captures this naturally
without requiring separate model entries.

---

## Input Resolver Integration: From String ID to Full Config

Here's where the magic of `format: "model"` really shines. Workglow has a general-purpose
**input resolver** system that transforms string IDs into resolved objects before a task
executes. The model system hooks into this via `registerInputResolver`:

```typescript
// In ModelRegistry.ts
registerInputResolver("model", resolveModelFromRegistry);
```

When a task declares an input property with `format: "model"` or `format: "model:TextEmbeddingTask"`,
the task graph's input resolution phase intercepts the string value (e.g.,
`"onnx:Xenova/all-MiniLM-L6-v2:q8"`) and calls the resolver. The resolver looks up the model
by name in the repository and returns the full `ModelConfig`.

The resolver function itself is clean:

```typescript
async function resolveModelFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<ModelConfig | undefined> {
  const modelRepo = registry.has(MODEL_REPOSITORY)
    ? registry.get<ModelRepository>(MODEL_REPOSITORY)
    : getGlobalModelRepository();

  const model = await modelRepo.findByName(id);
  if (!model) {
    throw new Error(`Model "${id}" not found in repository`);
  }
  return model;
}
```

There's also a **compactor** -- the inverse operation. When you need to serialize a resolved
`ModelConfig` back to a string ID (for persistence, dataflow serialization, or UI display),
the compactor extracts the `model_id`:

```typescript
registerInputCompactor("model", async (value, _format, registry) => {
  if (typeof value === "object" && value !== null && "model_id" in value) {
    const id = (value as Record<string, unknown>).model_id;
    if (typeof id !== "string") return undefined;
    const modelRepo = /* ... */;
    const model = await modelRepo.findByName(id);
    if (!model) return undefined;
    return id;
  }
  return undefined;
});
```

The resolver-compactor pair means the system is round-trippable. A string ID becomes a full
model config for execution, and a full model config compacts back to a string ID for storage.
Tasks can accept either form thanks to `TypeModel()`, which generates a `oneOf` schema
accepting both a string (the ID) and the full object (the config):

```typescript
export function TypeModel(semantic = "model", options = {}) {
  return {
    oneOf: [
      TypeModelAsString(semantic, options),   // { type: "string", format: "model:..." }
      TypeModelByDetail(semantic, options),    // { ...ModelConfigSchema, format: "model:..." }
    ],
    format: semantic,
  } as const satisfies JsonSchema;
}
```

This dual-input design is what makes the system flexible enough for both programmatic use
(pass a string ID, let the resolver handle it) and advanced scenarios (pass a full config
object with custom provider settings that might not even be in the repository).

---

## InMemoryModelRepository: Simple but Complete

The default implementation is wonderfully concise:

```typescript
export class InMemoryModelRepository extends ModelRepository {
  constructor() {
    super(new InMemoryTabularStorage(ModelRecordSchema, ModelPrimaryKeyNames));
  }
}
```

That's it. Three lines of code (plus the license header). It creates an `InMemoryTabularStorage`
typed to the `ModelRecordSchema` with `model_id` as the primary key, and passes it to the
base class. All the query logic, event emission, and lifecycle management is inherited from
`ModelRepository`.

This is a testament to the power of Workglow's storage abstraction. The `InMemoryTabularStorage`
handles put/get/delete/getAll operations with full schema validation. The `ModelRepository`
adds the domain-specific queries (`findModelsByTask`, `findTasksByModel`, `enumerateAllTasks`)
on top. Swapping to SQLite or PostgreSQL is just a matter of passing a different storage
implementation to the constructor.

---

## How Providers Register Models: The Full Flow

Let's trace the complete registration flow from provider initialization to a queryable model
catalog. Here's what happens when you set up an Anthropic provider in a test:

```typescript
// 1. Create a fresh repository
setGlobalModelRepository(new InMemoryModelRepository());

// 2. Register the provider (inline mode, with task functions)
await registerAnthropicInline();

// 3. Add models to the catalog
await getGlobalModelRepository().addModel({
  model_id: "anthropic:claude-haiku",
  title: "Claude Haiku",
  description: "Anthropic Claude Haiku",
  tasks: [
    "TextGenerationTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "StructuredGenerationTask",
    "ToolCallingTask",
  ],
  provider: ANTHROPIC,
  provider_config: { model_name: "claude-haiku-4-5-20251001" },
  metadata: {},
});
```

Step 2 is where the provider wires itself into the `AiProviderRegistry`. The
`AnthropicQueuedProvider` declares which task types it supports and registers run functions
for each one. Step 3 populates the model catalog independently.

This separation is important. The **provider** knows how to *execute* tasks. The **repository**
knows which *models* are available. They're connected by the `provider` field on each model
record, but they're registered independently. This means you can:

- Register a provider without adding any models (useful for dynamic model search via
  `ModelSearchTask`)
- Add models from multiple sources (a static catalog, a remote API, user configuration)
- Swap the model catalog at runtime without touching provider registration

For local models, registration often happens in bulk. The HuggingFace Transformers provider,
for example, registers dozens of ONNX models at once:

```typescript
export async function registerHuggingfaceLocalModels(): Promise<void> {
  const onnxModels: HfTransformersOnnxModelRecord[] = [
    {
      model_id: "onnx:Xenova/all-MiniLM-L6-v2:q8",
      title: "All MiniLM L6 V2 384D",
      tasks: ["TextEmbeddingTask"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "feature-extraction",
        model_path: "Xenova/all-MiniLM-L6-v2",
        native_dimensions: 384,
        dtype: "q8",
      },
      metadata: {},
    },
    // ... 20+ more models
  ];

  for (const model of onnxModels) {
    await getGlobalModelRepository().addModel(model);
  }
}
```

Each provider can extend the base `ModelRecordSchema` with provider-specific fields. Anthropic
adds `model_name`, `base_url`, and `max_tokens` inside `provider_config`. HuggingFace Transformers
adds `pipeline`, `model_path`, `dtype`, and `native_dimensions`. The `additionalProperties: true`
on `ModelConfigSchema` makes this extensible without breaking the base type.

---

## Putting It All Together

The Model Registry and Repository system is a case study in clean separation of concerns:

1. **`ModelSchema`** defines the data shapes -- lightweight `ModelConfig` for execution,
   strict `ModelRecord` for persistence.

2. **`ModelRepository`** provides the catalog -- an event-driven, storage-agnostic base class
   with queries for model-task relationships.

3. **`InMemoryModelRepository`** (and future backends) plug in concrete storage.

4. **`ModelRegistry`** wires the repository into the DI container and hooks up the input
   resolver system so `format: "model"` just works.

5. **Providers** register execution capabilities independently from the model catalog, connected
   only by the `provider` string field.

6. **Tasks** declare model requirements declaratively via `TypeModel("model:TaskType")` and
   never need to know which providers or models are installed.

The result is a system where adding a new provider, a new model, or a new storage backend
requires zero changes to any existing task code. The model catalog is a runtime concern,
not a compile-time dependency. And the event-driven design means the UI stays in sync without
polling.

That's the kind of architecture that lets you go from "I need an embedding model" to a
running pipeline without ceremony -- and without coupling.
