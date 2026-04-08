<!--
@license
Copyright 2025 Steven Roussey <sroussey@gmail.com>
SPDX-License-Identifier: Apache-2.0
-->

# Model Registry and Repository System

## 1. Overview

The Workglow Model Registry and Repository system provides a centralized mechanism for
discovering, storing, and managing AI model configurations across providers. It decouples
task execution from model discovery: tasks declare which model format they accept via JSON
Schema annotations, and the runtime resolves string model identifiers into fully-hydrated
`ModelConfig` objects before execution begins.

The system is composed of four primary components:

| Component | Responsibility |
|---|---|
| **ModelConfig** | Lightweight configuration carried through task inputs and job payloads |
| **ModelRecord** | Persistent, fully-specified record suitable for storage in a repository |
| **ModelRepository** | Abstract base class providing CRUD operations and event emission over a `TabularStorage` backend |
| **ModelRegistry** (singleton) | Global access layer wiring the repository into the `ServiceRegistry` and the input resolver system |

Together, these components enable a workflow where:

1. Providers register models at application startup.
2. Tasks declare model inputs with `format: "model"` or `format: "model:TaskType"` annotations.
3. The `TaskRunner` automatically resolves string model IDs to `ModelConfig` objects via the input resolver system.
4. `AiTask` validates model-task compatibility before execution.
5. The resolved `ModelConfig` is forwarded to the provider execution strategy.

**Source files:**

- `packages/ai/src/model/ModelSchema.ts` -- schema and type definitions
- `packages/ai/src/model/ModelRepository.ts` -- abstract repository class
- `packages/ai/src/model/InMemoryModelRepository.ts` -- default in-memory implementation
- `packages/ai/src/model/ModelRegistry.ts` -- singleton registration, input resolver/compactor

---

## 2. ModelConfig

`ModelConfig` is a lightweight configuration type designed to travel through task inputs and
serialized job payloads. It is intentionally less strict than `ModelRecord` so that jobs
executing inside workers can carry only the provider configuration required for execution,
without requiring access to a model repository.

### Schema Definition

```typescript
export const ModelConfigSchema = {
  type: "object",
  properties: {
    model_id:        { type: "string" },
    tasks:           { type: "array", items: { type: "string" }, "x-ui-editor": "multiselect" },
    title:           { type: "string" },
    description:     { type: "string", "x-ui-editor": "textarea" },
    provider:        { type: "string" },
    provider_config: {
      type: "object",
      properties: {
        credential_key: { type: "string", format: "credential", "x-ui-hidden": true },
      },
      additionalProperties: true,
      default: {},
    },
    metadata:        { type: "object", default: {}, "x-ui-hidden": true },
  },
  required: ["provider", "provider_config"],
  format: "model",
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;
```

### Properties

| Property | Type | Required | Description |
|---|---|---|---|
| `model_id` | `string` | No | Unique identifier for the model (e.g., `"onnx:Xenova/LaMini-Flan-T5-783M:q8"`) |
| `tasks` | `string[]` | No | Task type names this model is compatible with (e.g., `["TextGenerationTask", "TextRewriterTask"]`) |
| `title` | `string` | No | Human-readable display name |
| `description` | `string` | No | Human-readable description |
| `provider` | `string` | **Yes** | Provider identifier (e.g., `"HF_TRANSFORMERS_ONNX"`, `"openai"`, `"anthropic"`) |
| `provider_config` | `object` | **Yes** | Provider-specific configuration (e.g., `pipeline`, `model_path`, `dtype`, `credential_key`). Allows additional properties beyond `credential_key`. |
| `metadata` | `object` | No | Arbitrary metadata. Hidden from the UI. |

The `ModelConfig` type is derived from this schema via `FromSchema<typeof ModelConfigSchema>`.

**Key design decision:** Only `provider` and `provider_config` are required. This allows
inline model configurations in task inputs that bypass the repository entirely, which is
useful for one-off executions and testing.

---

## 3. ModelRecord

`ModelRecord` is the persistence-oriented counterpart to `ModelConfig`. It requires all fields
that `ModelConfig` leaves optional, ensuring every record in the repository is fully specified.

### Schema Definition

```typescript
export const ModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
  },
  required: [
    "model_id",
    "tasks",
    "provider",
    "title",
    "description",
    "provider_config",
    "metadata",
  ],
  format: "model",
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
```

### Differences from ModelConfig

| Aspect | ModelConfig | ModelRecord |
|---|---|---|
| Required fields | `provider`, `provider_config` | All seven properties |
| `additionalProperties` | `true` | `false` |
| Use case | Task input, job payload | Repository persistence |
| Primary key | N/A | `model_id` |

The primary key is defined as:

```typescript
export const ModelPrimaryKeyNames = ["model_id"] as const;
```

This tells the underlying `TabularStorage` to index and look up records by `model_id`.

---

## 4. ModelRepository Interface

`ModelRepository` is the base class for all model storage backends. It wraps an
`ITabularStorage<typeof ModelRecordSchema, typeof ModelPrimaryKeyNames>` instance and
provides a domain-specific API for model lifecycle management.

### Constructor

```typescript
constructor(
  modelTabularRepository: ITabularStorage<
    typeof ModelRecordSchema,
    typeof ModelPrimaryKeyNames,
    ModelRecord
  >
)
```

The repository delegates all storage operations to the injected `ITabularStorage` backend.
This allows the same `ModelRepository` API to work with in-memory storage, SQLite, PostgreSQL,
IndexedDB, or any other backend that implements the tabular storage interface.

### Methods

| Method | Signature | Description |
|---|---|---|
| `setupDatabase()` | `async (): Promise<void>` | Initializes the underlying storage (creates tables, indices). Must be called before any other method. |
| `addModel(model)` | `async (model: ModelRecord): Promise<ModelRecord>` | Inserts or upserts a model record. Emits `model_added`. |
| `removeModel(model_id)` | `async (model_id: string): Promise<void>` | Deletes a model by ID. Throws if not found. Emits `model_removed`. |
| `findByName(model_id)` | `async (model_id: string): Promise<ModelRecord \| undefined>` | Retrieves a single model by its `model_id`. Returns `undefined` if not found. |
| `findModelsByTask(task)` | `async (task: string): Promise<ModelRecord[] \| undefined>` | Returns all models whose `tasks` array includes the given task type. Returns `undefined` if none match. |
| `findTasksByModel(model_id)` | `async (model_id: string): Promise<string[] \| undefined>` | Returns the `tasks` array for a specific model. Returns `undefined` if the model is not found or has no tasks. |
| `enumerateAllModels()` | `async (): Promise<ModelRecord[] \| undefined>` | Returns all models in the repository. Returns `undefined` if empty. |
| `enumerateAllTasks()` | `async (): Promise<string[] \| undefined>` | Returns a deduplicated array of all task type strings across all models. Returns `undefined` if none exist. |
| `size()` | `async (): Promise<number>` | Returns the total number of stored models. |

### Usage Example

```typescript
import { getGlobalModelRepository } from "@workglow/ai";

const repo = getGlobalModelRepository();

// Register a model
await repo.addModel({
  model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
  title: "LaMini-Flan-T5-783M",
  description: "LaMini-Flan-T5-783M quantized to 8-bit",
  tasks: ["TextGenerationTask", "TextRewriterTask"],
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: {
    pipeline: "text2text-generation",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
  },
  metadata: {},
});

// Look up by name
const model = await repo.findByName("onnx:Xenova/LaMini-Flan-T5-783M:q8");

// Find all models that can do text generation
const genModels = await repo.findModelsByTask("TextGenerationTask");

// Find what tasks a model supports
const tasks = await repo.findTasksByModel("onnx:Xenova/LaMini-Flan-T5-783M:q8");
// => ["TextGenerationTask", "TextRewriterTask"]
```

---

## 5. InMemoryModelRepository

`InMemoryModelRepository` is the default implementation shipped with `@workglow/ai`. It
wraps an `InMemoryTabularStorage` instance, making it suitable for development, testing, and
single-process applications that do not need durable persistence.

### Implementation

```typescript
import { InMemoryTabularStorage } from "@workglow/storage";
import { ModelRepository } from "./ModelRepository";
import { ModelPrimaryKeyNames, ModelRecordSchema } from "./ModelSchema";

export class InMemoryModelRepository extends ModelRepository {
  constructor() {
    super(new InMemoryTabularStorage(ModelRecordSchema, ModelPrimaryKeyNames));
  }
}
```

The entire class is a single constructor call. All behavior is inherited from
`ModelRepository`, which delegates to the `InMemoryTabularStorage` backend.

For production deployments requiring persistence, you can create a custom repository by
passing a different `ITabularStorage` implementation (e.g., SQLite, PostgreSQL) to the
`ModelRepository` constructor:

```typescript
import { SqliteTabularStorage } from "@workglow/storage";
import { ModelRepository, ModelRecordSchema, ModelPrimaryKeyNames } from "@workglow/ai";

const sqliteStorage = new SqliteTabularStorage(db, "models", ModelRecordSchema, ModelPrimaryKeyNames);
const repo = new ModelRepository(sqliteStorage);
await repo.setupDatabase();
```

---

## 6. ModelRegistry Singleton

The `ModelRegistry.ts` module establishes the global model repository as a singleton service
and wires it into the input resolution system. It does not define a `ModelRegistry` class;
instead it provides service tokens, accessor functions, and resolver registrations.

### Service Token

```typescript
export const MODEL_REPOSITORY = createServiceToken<ModelRepository>("model.repository");
```

This token is used to register and retrieve the model repository from any `ServiceRegistry`
instance. On import, the module registers a default factory with the `globalServiceRegistry`:

```typescript
if (!globalServiceRegistry.has(MODEL_REPOSITORY)) {
  globalServiceRegistry.register(
    MODEL_REPOSITORY,
    (): ModelRepository => new InMemoryModelRepository(),
    true  // singleton
  );
}
```

The `true` parameter indicates this is a singleton: the factory executes once and the
resulting instance is cached for the lifetime of the process.

### Accessor Functions

| Function | Signature | Description |
|---|---|---|
| `getGlobalModelRepository()` | `(): ModelRepository` | Returns the model repository from the `globalServiceRegistry`. |
| `setGlobalModelRepository(repo)` | `(repository: ModelRepository): void` | Replaces the global model repository instance. Useful for testing or switching to a persistent backend. |

### Swapping the Repository

```typescript
import { setGlobalModelRepository, ModelRepository } from "@workglow/ai";
import { SqliteTabularStorage } from "@workglow/storage";

const sqliteRepo = new ModelRepository(
  new SqliteTabularStorage(db, "models", ModelRecordSchema, ModelPrimaryKeyNames)
);
await sqliteRepo.setupDatabase();
setGlobalModelRepository(sqliteRepo);
```

After this call, all subsequent calls to `getGlobalModelRepository()` and all input
resolution will use the SQLite-backed repository.

### Per-TaskGraph Registries

The `MODEL_REPOSITORY` token works with scoped `ServiceRegistry` instances as well. When
running a `TaskGraph`, you can provide a local registry with its own model repository, isolating
it from the global state:

```typescript
import { ServiceRegistry } from "@workglow/util";
import { MODEL_REPOSITORY, InMemoryModelRepository } from "@workglow/ai";

const registry = new ServiceRegistry();
const localRepo = new InMemoryModelRepository();
await localRepo.addModel({ /* ... */ });
registry.registerInstance(MODEL_REPOSITORY, localRepo);

// Pass to TaskGraph run
await graph.run({ registry });
```

---

## 7. Model-Task Compatibility

The model-task compatibility system ensures that models are only used with tasks they are
designed to support. This validation operates at two levels: input narrowing (pre-resolution)
and input validation (post-resolution).

### The `tasks` Array

Every `ModelRecord` includes a `tasks` array listing the task type names the model supports.
For example:

```typescript
{
  model_id: "gpt-4",
  tasks: ["TextGenerationTask", "ToolCallingTask"],
  provider: "openai",
  // ...
}
```

This model can be used with `TextGenerationTask` and `ToolCallingTask`, but not with
`TextEmbeddingTask` or `ImageClassificationTask`.

### narrowInput() -- Pre-Execution Filtering

`AiTask.narrowInput()` runs before the task executes. It examines all input properties with
`format: "model:TaskType"` annotations and validates compatibility:

1. For string model IDs: queries the repository for models matching the current task type.
   If the requested model ID is not in the result set, the input is set to `undefined`.
2. For resolved `ModelConfig` objects: checks whether the model's `tasks` array includes
   the current task type. If not, the input is set to `undefined`.

```typescript
// Simplified from AiTask.narrowInput()
const taskModels = await modelRepo.findModelsByTask(this.type);

for (const [key, propSchema] of modelTaskProperties) {
  const requestedModel = input[key];
  if (typeof requestedModel === "string") {
    const found = taskModels?.find((m) => m.model_id === requestedModel);
    if (!found) {
      input[key] = undefined;
    }
  } else if (typeof requestedModel === "object") {
    const tasks = requestedModel.tasks;
    if (Array.isArray(tasks) && tasks.length > 0 && !tasks.includes(this.type)) {
      input[key] = undefined;
    }
  }
}
```

This is intentionally lenient: an empty or missing `tasks` array is treated as "compatible
with everything", allowing inline configurations without explicit task lists.

### validateInput() -- Post-Resolution Validation

After input resolution, `AiTask.validateInput()` performs a stricter check. For properties
annotated with `format: "model:TaskType"`:

- If the resolved model has a non-empty `tasks` array that does **not** include the current
  task type, a `TaskConfigurationError` is thrown.
- If the value is not an object (i.e., resolution failed and left a raw string), a
  `TaskConfigurationError` is thrown indicating the model was not found in the repository.

```typescript
throw new TaskConfigurationError(
  `AiTask: Model "${modelId}" for '${key}' is not compatible with task '${this.type}'. ` +
  `Model supports: [${tasks.join(", ")}]`
);
```

---

## 8. Input Resolver System

The input resolver system is the mechanism by which string model IDs in task inputs are
automatically expanded to full `ModelConfig` objects. This happens transparently in the
`TaskRunner` before task execution.

### Format Annotations

Task input schemas use the `format` property to indicate that a field requires resolution:

| Format | Meaning |
|---|---|
| `format: "model"` | Accepts any model, resolved from the repository by `model_id` |
| `format: "model:TextGenerationTask"` | Accepts models compatible with `TextGenerationTask` |
| `format: "model:TextEmbeddingTask"` | Accepts models compatible with `TextEmbeddingTask` |
| `format: "model:ImageClassificationTask"` | Accepts models compatible with `ImageClassificationTask` |

These annotations are created using the `TypeModel()` helper function:

```typescript
import { TypeModel } from "@workglow/ai";

// In a task's input schema:
const inputSchema = {
  type: "object",
  properties: {
    model: TypeModel("model:TextGenerationTask"),
    prompt: { type: "string" },
  },
  required: ["model", "prompt"],
} as const satisfies DataPortSchema;
```

The `TypeModel()` helper produces a `oneOf` schema allowing either a string ID or an inline
`ModelConfig` object:

```typescript
function TypeModel(semantic) {
  return {
    oneOf: [
      TypeModelAsString(semantic),   // { type: "string", format: "model:..." }
      TypeModelByDetail(semantic),   // { ...ModelConfigSchema, format: "model:..." }
    ],
    format: semantic,
  };
}
```

### Resolution Flow

When the `TaskRunner` processes a task, it calls `resolveSchemaInputs()` before execution:

1. **Schema inspection:** The resolver iterates over all properties in the task's input schema.
2. **Format detection:** For each property, `getSchemaFormat()` extracts the format string,
   handling `oneOf`/`anyOf` wrappers.
3. **Resolver lookup:** The format prefix (everything before the first `:`) is used to look
   up a registered resolver. For `"model:TextGenerationTask"`, the prefix is `"model"`.
4. **String resolution:** If the input value is a string, the resolver is called with the
   string ID, the full format string, and the current `ServiceRegistry`.
5. **Object passthrough:** If the input value is already an object (inline `ModelConfig`),
   it passes through unchanged.

The model resolver registered in `ModelRegistry.ts`:

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

registerInputResolver("model", resolveModelFromRegistry);
```

### Input Compactor

The complementary compactor converts resolved `ModelConfig` objects back to their string
`model_id` for serialization (e.g., when persisting task graphs or transferring between
processes):

```typescript
registerInputCompactor("model", async (value, _format, registry) => {
  if (typeof value === "object" && value !== null && "model_id" in value) {
    const id = (value as Record<string, unknown>).model_id;
    if (typeof id !== "string") return undefined;
    const modelRepo = registry.has(MODEL_REPOSITORY)
      ? registry.get<ModelRepository>(MODEL_REPOSITORY)
      : getGlobalModelRepository();
    const model = await modelRepo.findByName(id);
    if (!model) return undefined;
    return id;
  }
  return undefined;
});
```

The compactor validates that the model still exists in the repository before returning the
ID, preventing stale references.

### Resolution Diagram

```
Task Input                   resolveSchemaInputs()              Task.execute()
+-----------------------+    +---------------------------+      +------------------+
| { model: "gpt-4",    | -> | Look up format: "model:*" | ->   | { model: {       |
|   prompt: "Hello" }   |    | Find resolver for "model" |      |     model_id:    |
+-----------------------+    | Call resolver("gpt-4")    |      |     "gpt-4",     |
                             | Query ModelRepository     |      |     provider:    |
                             | Return ModelRecord        |      |     "openai",    |
                             +---------------------------+      |     ...          |
                                                                |   },            |
                                                                |   prompt: "Hello"|
                                                                | }               |
                                                                +------------------+
```

---

## 9. Events

The `ModelRepository` emits events for all lifecycle mutations, enabling reactive UI updates,
logging, and synchronization with external systems.

### Event Types

```typescript
export type ModelEventListeners = {
  model_added:   (model: ModelRecord) => void;
  model_removed: (model: ModelRecord) => void;
  model_updated: (model: ModelRecord) => void;
};
```

| Event | Emitted When | Payload |
|---|---|---|
| `model_added` | After `addModel()` successfully inserts a record | The inserted `ModelRecord` |
| `model_removed` | After `removeModel()` successfully deletes a record | The deleted `ModelRecord` (fetched before deletion) |
| `model_updated` | After a model record is updated | The updated `ModelRecord` |

### Subscribing to Events

```typescript
const repo = getGlobalModelRepository();

// Listen for new models
repo.on("model_added", (model) => {
  console.log(`New model registered: ${model.model_id} (${model.provider})`);
});

// One-time listener
repo.once("model_removed", (model) => {
  console.log(`Model removed: ${model.model_id}`);
});

// Promise-based waiting
const [addedModel] = await repo.waitOn("model_added");
console.log(`Waited for model: ${addedModel.model_id}`);

// Unsubscribe
const handler = (model: ModelRecord) => { /* ... */ };
repo.on("model_added", handler);
repo.off("model_added", handler);
```

### Event Methods

| Method | Signature | Description |
|---|---|---|
| `on(name, fn)` | `<E extends ModelEvents>(name: E, fn: ModelEventListener<E>): void` | Registers a persistent listener |
| `off(name, fn)` | `<E extends ModelEvents>(name: E, fn: ModelEventListener<E>): void` | Removes a listener |
| `once(name, fn)` | `<E extends ModelEvents>(name: E, fn: ModelEventListener<E>): void` | Registers a listener that fires once and auto-removes |
| `waitOn(name)` | `<E extends ModelEvents>(name: E): Promise<ModelEventParameters<E>>` | Returns a promise that resolves with the event arguments the next time the event fires |

---

## 10. API Reference

### Types

```typescript
// Lightweight config for task inputs and job payloads
type ModelConfig = FromSchema<typeof ModelConfigSchema>;

// Fully-specified record for repository persistence
type ModelRecord = FromSchema<typeof ModelRecordSchema>;

// Primary key definition
const ModelPrimaryKeyNames = ["model_id"] as const;

// Event system types
type ModelEventListeners = {
  model_added:   (model: ModelRecord) => void;
  model_removed: (model: ModelRecord) => void;
  model_updated: (model: ModelRecord) => void;
};
type ModelEvents = keyof ModelEventListeners;
type ModelEventListener<E extends ModelEvents> = ModelEventListeners[E];
type ModelEventParameters<E extends ModelEvents> = EventParameters<ModelEventListeners, E>;

// Format annotation types
type TypeModelSemantic = "model" | `model:${string}`;
```

### Schema Constants

| Constant | Description |
|---|---|
| `ModelConfigSchema` | JSON Schema for `ModelConfig`. `required: ["provider", "provider_config"]`. |
| `ModelRecordSchema` | JSON Schema for `ModelRecord`. All fields required, no additional properties. |
| `ModelPrimaryKeyNames` | `["model_id"]` -- used by `TabularStorage` for indexing. |

### Classes

#### `ModelRepository`

```typescript
class ModelRepository {
  constructor(modelTabularRepository: ITabularStorage<...>);

  async setupDatabase(): Promise<void>;

  async addModel(model: ModelRecord): Promise<ModelRecord>;
  async removeModel(model_id: string): Promise<void>;
  async findByName(model_id: string): Promise<ModelRecord | undefined>;
  async findModelsByTask(task: string): Promise<ModelRecord[] | undefined>;
  async findTasksByModel(model_id: string): Promise<string[] | undefined>;
  async enumerateAllModels(): Promise<ModelRecord[] | undefined>;
  async enumerateAllTasks(): Promise<string[] | undefined>;
  async size(): Promise<number>;

  on<E extends ModelEvents>(name: E, fn: ModelEventListener<E>): void;
  off<E extends ModelEvents>(name: E, fn: ModelEventListener<E>): void;
  once<E extends ModelEvents>(name: E, fn: ModelEventListener<E>): void;
  waitOn<E extends ModelEvents>(name: E): Promise<ModelEventParameters<E>>;
}
```

#### `InMemoryModelRepository`

```typescript
class InMemoryModelRepository extends ModelRepository {
  constructor();  // Creates an InMemoryTabularStorage internally
}
```

### Functions

| Function | Module | Description |
|---|---|---|
| `getGlobalModelRepository()` | `ModelRegistry` | Returns the singleton `ModelRepository` from the global `ServiceRegistry` |
| `setGlobalModelRepository(repo)` | `ModelRegistry` | Replaces the global repository instance |
| `TypeModel(semantic?, options?)` | `AiTaskSchemas` | Creates a `oneOf` schema accepting either a string model ID or an inline `ModelConfig` |
| `TypeModelAsString(semantic?, options?)` | `AiTaskSchemas` | Creates a string-only schema with the given format annotation |
| `TypeModelByDetail(semantic?, options?)` | `AiTaskSchemas` | Creates an object schema based on `ModelConfigSchema` with the given format annotation |

### Service Tokens

| Token | Type | Key | Description |
|---|---|---|---|
| `MODEL_REPOSITORY` | `ModelRepository` | `"model.repository"` | The global model repository instance |

### Related Tasks

| Task | Description |
|---|---|
| `ModelSearchTask` | Searches for models using provider-specific search functions. Input: `provider`, `query`. Output: array of `ModelSearchResultItem`. |
| `ModelInfoTask` | Retrieves runtime metadata about a model (locality, cache status, file sizes). Input: `model`. Output: `is_local`, `is_remote`, `is_cached`, `is_loaded`, `file_sizes`, etc. |
| `DownloadModelTask` | Downloads model files to local cache. |
| `UnloadModelTask` | Unloads a model from memory. |

### Import Paths

All public exports are available from the `@workglow/ai` package:

```typescript
import {
  // Types and schemas
  ModelConfig,
  ModelRecord,
  ModelConfigSchema,
  ModelRecordSchema,
  ModelPrimaryKeyNames,

  // Repository
  ModelRepository,
  InMemoryModelRepository,

  // Singleton access
  MODEL_REPOSITORY,
  getGlobalModelRepository,
  setGlobalModelRepository,

  // Schema helpers
  TypeModel,
  TypeModelAsString,
  TypeModelByDetail,

  // Event types
  ModelEventListeners,
  ModelEvents,
  ModelEventListener,
  ModelEventParameters,
} from "@workglow/ai";
```
