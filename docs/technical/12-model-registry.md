<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Model Registry

## Overview

The model registry is the central catalog of AI models available to Workglow. It provides a
persistent, queryable store of model configurations and their associations with tasks. When a
task input contains a model string like `"gpt-4"`, the input resolution system looks up the
corresponding `ModelConfig` from the model registry. When a UI needs to populate a model dropdown
for a specific task type, it queries the registry for compatible models.

The system is composed of four collaborating pieces:

1. **`ModelConfig` / `ModelRecord`** -- data types representing model configurations at different
   levels of specificity.
2. **`ModelRepository`** -- the base class providing CRUD operations and event emission for model
   records, backed by `ITabularStorage`.
3. **`InMemoryModelRepository`** -- a default in-memory implementation.
4. **`ModelRegistry` module** -- the DI wiring that provides a global `MODEL_REPOSITORY` service
   token, convenience accessors, and the input resolver/compactor registrations that connect models
   to the schema system.

```
┌─────────────────────────────────────────────────────────────┐
│                    ModelRegistry Module                      │
│                                                             │
│  MODEL_REPOSITORY token ──> globalServiceRegistry           │
│  registerInputResolver("model", ...)                        │
│  registerInputCompactor("model", ...)                       │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  ModelRepository                      │  │
│  │                                                       │  │
│  │  addModel()    findByName()    findModelsByTask()     │  │
│  │  removeModel() findTasksByModel() enumerateAllModels()│  │
│  │                                                       │  │
│  │  events: model_added, model_removed, model_updated    │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │        ITabularStorage<ModelRecordSchema>       │  │  │
│  │  │  (InMemory, SQLite, PostgreSQL, ...)            │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

Source files:

| File                                               | Purpose                                         |
| -------------------------------------------------- | ----------------------------------------------- |
| `packages/ai/src/model/ModelSchema.ts`             | `ModelConfig`, `ModelRecord` types and schemas  |
| `packages/ai/src/model/ModelRepository.ts`         | `ModelRepository` base class                    |
| `packages/ai/src/model/InMemoryModelRepository.ts` | In-memory implementation                        |
| `packages/ai/src/model/ModelRegistry.ts`           | DI wiring, global accessors, resolver/compactor |

---

## ModelConfig vs ModelRecord

The model system uses two related but distinct types to represent model configurations at different
levels of specificity.

### ModelConfig

`ModelConfig` is the lightweight configuration that tasks and jobs carry. It requires only the
provider and provider configuration, with all other fields optional:

```typescript
const ModelConfigSchema = {
  type: "object",
  properties: {
    model_id: { type: "string" },
    tasks: { type: "array", items: { type: "string" }, "x-ui-editor": "multiselect" },
    title: { type: "string" },
    description: { type: "string", "x-ui-editor": "textarea" },
    provider: { type: "string" },
    provider_config: {
      type: "object",
      properties: {
        credential_key: { type: "string", format: "credential", "x-ui-hidden": true },
      },
      additionalProperties: true,
      default: {},
    },
    metadata: { type: "object", default: {}, "x-ui-hidden": true },
  },
  required: ["provider", "provider_config"],
  format: "model",
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

type ModelConfig = FromSchema<typeof ModelConfigSchema>;
```

Key fields:

| Field             | Type       | Required | Description                      |
| ----------------- | ---------- | -------- | -------------------------------- |
| `model_id`        | `string`   | No       | Unique identifier for the model  |
| `tasks`           | `string[]` | No       | Task types this model supports   |
| `title`           | `string`   | No       | Human-readable name              |
| `description`     | `string`   | No       | Description of the model         |
| `provider`        | `string`   | Yes      | Provider name (e.g., `"OPENAI"`) |
| `provider_config` | `object`   | Yes      | Provider-specific settings       |
| `metadata`        | `object`   | No       | Arbitrary metadata               |

The `provider_config` object supports `additionalProperties: true`, so providers can include
their own fields (e.g., `model_name`, `device`, `dtype`). The `credential_key` sub-field uses
`format: "credential"` to trigger credential resolution through the input resolver system.

### ModelRecord

`ModelRecord` is the fully-specified variant used for persistence in the `ModelRepository`. All
fields are required:

```typescript
const ModelRecordSchema = {
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

type ModelRecord = FromSchema<typeof ModelRecordSchema>;
```

The `additionalProperties: false` constraint ensures that only the declared fields are persisted.
The primary key is defined by:

```typescript
const ModelPrimaryKeyNames = ["model_id"] as const;
```

### Relationship

`ModelConfig` is a superset of `ModelRecord` in terms of flexibility (allows additional properties,
fewer required fields). A `ModelRecord` retrieved from the repository is always a valid
`ModelConfig`, but not vice versa. This design allows jobs to carry only the provider configuration
needed for execution without requiring a round-trip to the model repository.

---

## ModelRepository Interface

`ModelRepository` is the base class for all model storage backends. It wraps an `ITabularStorage`
instance and provides domain-specific query methods plus event emission.

### Constructor

```typescript
class ModelRepository {
  constructor(
    modelTabularRepository: ITabularStorage<
      typeof ModelRecordSchema,
      typeof ModelPrimaryKeyNames,
      ModelRecord
    >
  );
}
```

The constructor accepts any `ITabularStorage` implementation, making the repository backend-
agnostic. The same `ModelRepository` API works with in-memory storage, SQLite, PostgreSQL, or any
other storage backend.

### CRUD Operations

#### addModel(model: ModelRecord): Promise<ModelRecord>

Adds a new model to the repository and emits a `model_added` event:

```typescript
const repo = getGlobalModelRepository();
await repo.addModel({
  model_id: "gpt-4-turbo",
  title: "GPT-4 Turbo",
  description: "OpenAI's GPT-4 Turbo model",
  provider: "OPENAI",
  tasks: ["TextGenerationTask", "TextSummaryTask", "ToolCallingTask"],
  provider_config: {
    model_name: "gpt-4-turbo-preview",
    credential_key: "openai-api-key",
  },
  metadata: { context_window: 128000 },
});
```

#### removeModel(model_id: string): Promise<void>

Removes a model by ID and emits a `model_removed` event. Throws if the model is not found:

```typescript
await repo.removeModel("gpt-4-turbo");
```

#### findByName(model_id: string): Promise<ModelRecord | undefined>

Retrieves a single model by its `model_id`. Returns `undefined` if not found:

```typescript
const model = await repo.findByName("gpt-4-turbo");
if (model) {
  console.log(model.provider); // "OPENAI"
}
```

### Query Operations

#### findModelsByTask(task: string): Promise<ModelRecord[] | undefined>

Returns all models whose `tasks` array includes the given task type. Returns `undefined` if no
models match:

```typescript
const embeddingModels = await repo.findModelsByTask("TextEmbeddingTask");
// [{ model_id: "text-embedding-3-small", ... }, { model_id: "all-MiniLM-L6-v2", ... }]
```

#### findTasksByModel(model_id: string): Promise<string[] | undefined>

Returns the task types supported by a specific model:

```typescript
const tasks = await repo.findTasksByModel("gpt-4-turbo");
// ["TextGenerationTask", "TextSummaryTask", "ToolCallingTask"]
```

#### enumerateAllTasks(): Promise<string[] | undefined>

Returns a deduplicated list of all task types across all registered models:

```typescript
const allTasks = await repo.enumerateAllTasks();
// ["TextGenerationTask", "TextEmbeddingTask", "TextSummaryTask", ...]
```

#### enumerateAllModels(): Promise<ModelRecord[] | undefined>

Returns all models in the repository:

```typescript
const allModels = await repo.enumerateAllModels();
```

#### size(): Promise<number>

Returns the total number of models stored:

```typescript
const count = await repo.size();
```

### Database Setup

#### setupDatabase(): Promise<void>

Initializes the underlying storage. Must be called before using any other methods when using
persistent backends (SQLite, PostgreSQL). In-memory storage does not require this call but
supports it as a no-op:

```typescript
const repo = new SqliteModelRepository(dbPath);
await repo.setupDatabase();
```

---

## InMemoryModelRepository

The default implementation that stores models in memory. It is registered automatically as the
global model repository if no other implementation is provided:

```typescript
class InMemoryModelRepository extends ModelRepository {
  constructor() {
    super(new InMemoryTabularStorage(ModelRecordSchema, ModelPrimaryKeyNames));
  }
}
```

This implementation is suitable for applications that register models programmatically at startup
and do not need persistence across restarts. For persistent storage, replace the global repository
with a SQLite or PostgreSQL-backed implementation.

---

## ModelRegistry Singleton

The `ModelRegistry.ts` module provides the DI wiring that connects the `ModelRepository` to the
rest of the framework.

### SERVICE_TOKEN

```typescript
const MODEL_REPOSITORY = createServiceToken<ModelRepository>("model.repository");
```

This token is used with the `ServiceRegistry` to register and retrieve the global model repository
instance. A default `InMemoryModelRepository` is auto-registered if no other implementation is
provided:

```typescript
if (!globalServiceRegistry.has(MODEL_REPOSITORY)) {
  globalServiceRegistry.register(
    MODEL_REPOSITORY,
    (): ModelRepository => new InMemoryModelRepository(),
    true // singleton
  );
}
```

### Global Accessors

```typescript
// Get the current global model repository
function getGlobalModelRepository(): ModelRepository;

// Replace the global model repository
function setGlobalModelRepository(repository: ModelRepository): void;
```

`setGlobalModelRepository()` calls `globalServiceRegistry.registerInstance()` to replace the
singleton, ensuring all subsequent calls to `getGlobalModelRepository()` and DI-based lookups
return the new instance.

---

## Model-Task Compatibility

The model registry enforces compatibility between models and tasks through the `tasks` array on
each `ModelRecord`. This array lists the task type names that the model can handle.

### At Registration Time

When a provider registers its models, the `tasks` array declares which task types each model
supports:

```typescript
await repo.addModel({
  model_id: "all-MiniLM-L6-v2",
  title: "All MiniLM L6 v2",
  description: "Sentence transformer for embeddings",
  provider: "HF_TRANSFORMERS_ONNX",
  tasks: ["TextEmbeddingTask"], // Only supports embeddings
  provider_config: { model_name: "Xenova/all-MiniLM-L6-v2" },
  metadata: {},
});
```

### At Validation Time

`AiTask.validateInput()` checks that the resolved `ModelConfig.tasks` array includes the current
task type. If not, it throws a `TaskConfigurationError`:

```typescript
const tasks = (model as ModelConfig).tasks;
if (Array.isArray(tasks) && tasks.length > 0 && !tasks.includes(this.type)) {
  throw new TaskConfigurationError(`Model "${modelId}" is not compatible with task '${this.type}'`);
}
```

### At Narrowing Time

`AiTask.narrowInput()` is called by the UI to filter out incompatible models. It queries the
repository for models that support the current task type and sets incompatible model inputs to
`undefined`:

```typescript
const taskModels = await modelRepo.findModelsByTask(this.type);
for (const [key] of modelTaskProperties) {
  const requestedModel = input[key];
  if (typeof requestedModel === "string") {
    const found = taskModels?.find((m) => m.model_id === requestedModel);
    if (!found) {
      (input as any)[key] = undefined;
    }
  }
}
```

This enables UI model dropdowns to show only models that are compatible with the selected task.

---

## Input Resolver Integration

The model registry integrates with the input resolution system (see
[Schema System and Input Resolution](./09-schema-and-input-resolution.md)) through two
registrations that happen at module load time.

### Model Resolver

Converts a model ID string to a `ModelConfig` object:

```typescript
registerInputResolver("model", async (id, format, registry) => {
  const modelRepo = registry.has(MODEL_REPOSITORY)
    ? registry.get<ModelRepository>(MODEL_REPOSITORY)
    : getGlobalModelRepository();

  const model = await modelRepo.findByName(id);
  if (!model) throw new Error(`Model "${id}" not found in repository`);
  return model;
});
```

The resolver first checks the provided `ServiceRegistry` for a `MODEL_REPOSITORY` token (allowing
per-run overrides), then falls back to the global repository. This is important for testing and
for multi-tenant scenarios where different runs may use different model repositories.

### Model Compactor

Converts a `ModelConfig` object back to its string `model_id`:

```typescript
registerInputCompactor("model", async (value, format, registry) => {
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

The compactor validates that the model ID actually exists in the repository before returning it.
If the model has been removed, compaction returns `undefined` and the value remains as an object.

### Resolution Flow Example

```typescript
// 1. User creates a task with a string model ID
const task = new TextGenerationTask({ model: "gpt-4", prompt: "Hello" });

// 2. TaskRunner calls resolveSchemaInputs() before execute()
//    - Schema has: model: { format: "model:TextGenerationTask", oneOf: [...] }
//    - Resolver finds "model" prefix, calls registered resolver
//    - Resolver calls modelRepo.findByName("gpt-4")
//    - Returns full ModelConfig

// 3. AiTask.execute() receives resolved input
//    input.model === {
//      model_id: "gpt-4",
//      provider: "OPENAI",
//      tasks: ["TextGenerationTask", ...],
//      provider_config: { model_name: "gpt-4", credential_key: "openai-key" },
//      ...
//    }

// 4. AiTask delegates to strategy based on model.provider
```

---

## Events

The `ModelRepository` emits events through an `EventEmitter<ModelEventListeners>` instance.
These events enable reactive and preview UI updates, telemetry, and cross-component communication.

### Event Types

```typescript
type ModelEventListeners = {
  model_added: (model: ModelRecord) => void;
  model_removed: (model: ModelRecord) => void;
  model_updated: (model: ModelRecord) => void;
};
```

### Subscribing to Events

```typescript
const repo = getGlobalModelRepository();

// Listen for new models
repo.on("model_added", (model) => {
  console.log(`New model registered: ${model.model_id} (${model.provider})`);
});

// Listen for removals
repo.on("model_removed", (model) => {
  console.log(`Model removed: ${model.model_id}`);
});

// One-time listener
repo.once("model_added", (model) => {
  console.log(`First model added: ${model.model_id}`);
});

// Promise-based waiting
const [newModel] = await repo.waitOn("model_added");
console.log(`Waited for model: ${newModel.model_id}`);
```

### Unsubscribing

```typescript
const handler = (model: ModelRecord) => {
  /* ... */
};
repo.on("model_added", handler);
// Later:
repo.off("model_added", handler);
```

---

## API Reference

### ModelConfig (type)

Lightweight model configuration for task inputs and job payloads. Required fields: `provider`,
`provider_config`.

### ModelRecord (type)

Fully-specified model record for repository persistence. Required fields: `model_id`, `tasks`,
`provider`, `title`, `description`, `provider_config`, `metadata`.

### ModelPrimaryKeyNames

```typescript
const ModelPrimaryKeyNames = ["model_id"] as const;
```

### MODEL_REPOSITORY

```typescript
const MODEL_REPOSITORY: ServiceToken<ModelRepository>;
```

DI service token for the global model repository.

### getGlobalModelRepository()

Returns the global `ModelRepository` instance from the `globalServiceRegistry`.

### setGlobalModelRepository(repository)

Replaces the global `ModelRepository` instance.

### ModelRepository

| Method                       | Returns                               | Description                          |
| ---------------------------- | ------------------------------------- | ------------------------------------ |
| `setupDatabase()`            | `Promise<void>`                       | Initialize storage backend           |
| `addModel(model)`            | `Promise<ModelRecord>`                | Add a model, emit `model_added`      |
| `removeModel(model_id)`      | `Promise<void>`                       | Remove a model, emit `model_removed` |
| `findByName(model_id)`       | `Promise<ModelRecord \| undefined>`   | Look up by ID                        |
| `findModelsByTask(task)`     | `Promise<ModelRecord[] \| undefined>` | Models supporting a task             |
| `findTasksByModel(model_id)` | `Promise<string[] \| undefined>`      | Tasks supported by a model           |
| `enumerateAllTasks()`        | `Promise<string[] \| undefined>`      | All unique task types                |
| `enumerateAllModels()`       | `Promise<ModelRecord[] \| undefined>` | All models                           |
| `size()`                     | `Promise<number>`                     | Total model count                    |
| `on(event, fn)`              | `void`                                | Subscribe to events                  |
| `off(event, fn)`             | `void`                                | Unsubscribe from events              |
| `once(event, fn)`            | `void`                                | One-time event listener              |
| `waitOn(event)`              | `Promise<[ModelRecord]>`              | Wait for an event (promise)          |

### InMemoryModelRepository

```typescript
class InMemoryModelRepository extends ModelRepository
```

Default in-memory implementation. No constructor arguments required. Auto-registered as the global
model repository via the DI system.

### Model Events

| Event           | Payload       | Emitted When                   |
| --------------- | ------------- | ------------------------------ |
| `model_added`   | `ModelRecord` | After `addModel()` succeeds    |
| `model_removed` | `ModelRecord` | After `removeModel()` succeeds |
| `model_updated` | `ModelRecord` | After a model is updated       |
