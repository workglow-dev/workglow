<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Schema System and Input Resolution

## Overview

Workglow uses JSON Schema as the universal language for describing task inputs, outputs, and
configuration. Every task declares its data contract through static `inputSchema()` and
`outputSchema()` methods that return `DataPortSchema` objects. Beyond standard JSON Schema
validation, Workglow extends the schema with custom `x-` properties and `format` annotations that
drive a runtime **input resolution** system. This system converts human-friendly string identifiers
(like a model name `"gpt-4"`) into fully resolved runtime objects (like a complete `ModelConfig`)
before a task executes.

The resolution system has a symmetric counterpart: **input compaction**, which converts resolved
objects back into their compact string identifiers. Together, resolution and compaction enable a
seamless round-trip between user-facing representations and internal runtime objects.

```
User provides:  { model: "gpt-4" }
                       |
              resolveSchemaInputs()
                       |
                       v
Task receives:  { model: { model_id: "gpt-4", provider: "openai", ... } }
                       |
              compactSchemaInputs()
                       |
                       v
Stored as:      { model: "gpt-4" }
```

Source files:

| File                                              | Purpose                                            |
| ------------------------------------------------- | -------------------------------------------------- |
| `packages/util/src/json-schema/DataPortSchema.ts` | `DataPortSchema` and related type aliases          |
| `packages/util/src/json-schema/JsonSchema.ts`     | `JsonSchema` base type and `JsonSchemaCustomProps` |
| `packages/util/src/di/InputResolverRegistry.ts`   | Global input resolver registry                     |
| `packages/util/src/di/InputCompactorRegistry.ts`  | Global input compactor registry                    |
| `packages/task-graph/src/task/InputResolver.ts`   | `resolveSchemaInputs()` and schema helpers         |
| `packages/task-graph/src/task/InputCompactor.ts`  | `compactSchemaInputs()` reverse operation          |
| `packages/ai/src/task/base/AiTaskSchemas.ts`      | AI-specific schema helpers (`TypeModel`, etc.)     |

---

## DataPortSchema

`DataPortSchema` is the foundational type that every task schema must conform to. It is defined in
`packages/util/src/json-schema/DataPortSchema.ts` and is a union of `boolean` and
`DataPortSchemaObject`:

```typescript
export type DataPortSchema<EXTENSION extends JSONSchemaExtension = JsonSchemaCustomProps> =
  | boolean
  | DataPortSchemaObject<EXTENSION>;
```

The `boolean` variant allows a schema of `true` (accept anything) or `false` (accept nothing). The
`DataPortSchemaObject` variant is the workhorse -- it narrows to JSON Schema objects with a required
`type: "object"` and `properties` record:

```typescript
export type DataPortSchemaObject<EXTENSION extends JSONSchemaExtension = JsonSchemaCustomProps> =
  DataPortSchemaNonBoolean<EXTENSION> & {
    readonly type: "object";
    readonly properties: Record<string, DataPortSchemaNonBoolean<EXTENSION>>;
  };
```

Tasks declare schemas with `as const satisfies DataPortSchema` to get full type inference while
ensuring schema validity at compile time:

```typescript
class TextGenerationTask extends AiTask<Input, Output> {
  static readonly type = "TextGenerationTask";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        model: TypeModel("model:TextGenerationTask"),
        prompt: { type: "string", title: "Prompt" },
        temperature: { type: "number", minimum: 0, maximum: 2, default: 0.7 },
      },
      required: ["model", "prompt"],
    } as const satisfies DataPortSchema;
  }
}
```

The `PropertySchema` type alias extracts the type of individual property schemas from a
`DataPortSchemaObject`:

```typescript
export type PropertySchema = NonNullable<DataPortSchemaObject["properties"]>[string];
```

---

## Custom Extension Properties (x-props)

Workglow extends JSON Schema with a set of `x-` prefixed properties defined in
`JsonSchemaCustomProps`. These annotations drive UI rendering, streaming behavior, storage
auto-generation, and more.

### UI Annotations

| Property              | Type                     | Purpose                                                         |
| --------------------- | ------------------------ | --------------------------------------------------------------- |
| `x-ui-hidden`         | `boolean`                | Hides the property from UI editors                              |
| `x-ui-order`          | `number`                 | Controls display ordering within a group                        |
| `x-ui-priority`       | `number`                 | Controls priority for rendering decisions                       |
| `x-ui-viewer`         | `string`                 | Specifies a custom viewer component                             |
| `x-ui-editor`         | `string`                 | Specifies a custom editor (e.g., `"textarea"`, `"multiselect"`) |
| `x-ui-group`          | `string`                 | Groups properties into collapsible sections                     |
| `x-ui-group-order`    | `number`                 | Controls group display ordering                                 |
| `x-ui-group-priority` | `number`                 | Controls group priority                                         |
| `x-ui-group-open`     | `boolean`                | Whether the group starts expanded                               |
| `x-ui-enum-labels`    | `Record<string, string>` | Maps enum values to display labels                              |
| `x-ui-manual`         | `boolean`                | Marks a property as user-added (dynamic ports)                  |
| `x-ui-type-override`  | `boolean`                | Allows UI to override the type of the property                  |
| `x-ui-preview`        | `boolean \| string`      | Hints that this field responds to preview execution             |
| `x-ui-iteration`      | `boolean`                | Marks a property as injected by iteration (hidden from parent)  |

### Behavioral Annotations

| Property              | Type                                | Purpose                                                 |
| --------------------- | ----------------------------------- | ------------------------------------------------------- |
| `x-replicate`         | `boolean`                           | Whether the value should be replicated across instances |
| `x-auto-generated`    | `boolean`                           | Marks a PK column as auto-generated by storage backends |
| `x-stream`            | `"append" \| "replace" \| "object"` | Streaming mode for the port                             |
| `x-structured-output` | `boolean`                           | Requires structured output from the AI provider         |

Example using multiple annotations:

```typescript
static outputSchema(): DataPortSchema {
  return {
    type: "object",
    properties: {
      text: {
        type: "string",
        title: "Generated Text",
        "x-stream": "append",        // Stream as incremental text deltas
        "x-ui-viewer": "markdown",    // Render as markdown in the UI
      },
      confidence: {
        type: "number",
        "x-ui-hidden": true,          // Internal metric, hide from UI
      },
    },
  } as const satisfies DataPortSchema;
}
```

---

## Format Annotations

The `format` field on a JSON Schema property serves double duty in Workglow. Beyond its standard
JSON Schema meaning (e.g., `"email"`, `"uri"`), Workglow uses it to tag properties with semantic
types that the input resolution system understands.

### Format Syntax

Formats follow the pattern `prefix` or `prefix:qualifier`:

| Format                       | Meaning                                |
| ---------------------------- | -------------------------------------- |
| `"model"`                    | Any AI model (generic)                 |
| `"model:TextGenerationTask"` | Model specifically for text generation |
| `"model:EmbeddingTask"`      | Model specifically for embeddings      |
| `"storage:tabular"`          | Tabular storage reference              |
| `"knowledge-base"`           | Knowledge base reference               |
| `"credential"`               | Credential reference                   |
| `"image"`                    | Image data (URI or binary)             |
| `"image:data-uri"`           | Image as data URI                      |
| `"audio:data-uri"`           | Audio as data URI                      |

The resolution system uses the prefix (before the colon) to look up the appropriate resolver. The
full format string (including the qualifier) is passed to the resolver so it can make finer-grained
decisions.

### TypeModel Schema Helpers

The `TypeModel()` function from `AiTaskSchemas.ts` constructs a `oneOf` schema that allows a model
property to be either a string ID or a full `ModelConfig` object:

```typescript
function TypeModel(semantic: TypeModelSemantic = "model", options = {}) {
  return {
    oneOf: [
      TypeModelAsString(semantic, options), // { type: "string", format: "model:..." }
      TypeModelByDetail(semantic, options), // Full ModelConfigSchema with format
    ],
    format: semantic,
  } as const satisfies JsonSchema;
}
```

This pattern enables ergonomic usage where callers can pass either:

```typescript
// Simple: string ID resolved automatically
workflow.addTask(new TextGenerationTask({ model: "gpt-4", prompt: "Hello" }));

// Detailed: full config passed through unchanged
workflow.addTask(new TextGenerationTask({
  model: { model_id: "gpt-4", provider: "openai", provider_config: { ... } },
  prompt: "Hello",
}));
```

The `TypeSingleOrArray()` helper wraps a schema to accept either a single value or an array:

```typescript
function TypeSingleOrArray<T extends DataPortSchemaNonBoolean>(type: T) {
  return {
    anyOf: [type, { type: "array", items: type }],
  } as const satisfies JsonSchema;
}
```

---

## Input Resolver Registry

The resolver registry is a global `Map<string, InputResolverFn>` managed through the DI system.
Each entry maps a format prefix to a resolver function.

### InputResolverFn Type

```typescript
type InputResolverFn = (
  id: string,
  format: string,
  registry: ServiceRegistry
) => unknown | Promise<unknown>;
```

Parameters:

- `id` -- The string value to resolve (e.g., `"gpt-4"`)
- `format` -- The full format string from the schema (e.g., `"model:TextGenerationTask"`)
- `registry` -- The active `ServiceRegistry` for looking up dependencies

### Registration

```typescript
import { registerInputResolver } from "@workglow/util";

// Register a resolver for the "model" prefix
registerInputResolver("model", async (id, format, registry) => {
  const modelRepo = registry.get(MODEL_REPOSITORY);
  const model = await modelRepo.findByName(id);
  if (!model) throw new Error(`Model "${id}" not found in repository`);
  return model;
});

// Register a resolver for "knowledge-base"
registerInputResolver("knowledge-base", (id, format, registry) => {
  const kb = getKnowledgeBase(id);
  if (!kb) throw new Error(`Knowledge base "${id}" not found`);
  return kb;
});
```

The registry is stored as a DI service under the `INPUT_RESOLVERS` token:

```typescript
const INPUT_RESOLVERS = createServiceToken<Map<string, InputResolverFn>>("task.input.resolvers");
```

A default empty `Map` is auto-registered on the `globalServiceRegistry` so resolvers can be added
incrementally as packages are imported.

---

## Input Compactor Registry

The compactor registry is the symmetric counterpart of the resolver registry. It converts resolved
objects back into their string identifiers.

### InputCompactorFn Type

```typescript
type InputCompactorFn = (
  value: unknown,
  format: string,
  registry: ServiceRegistry
) => string | undefined | Promise<string | undefined>;
```

The compactor returns `undefined` if the value cannot be compacted (e.g., the object has no
recognizable ID field, or the ID is not found in the repository).

### Registration

```typescript
import { registerInputCompactor } from "@workglow/util";

// Register model compactor -- extracts model_id from a ModelConfig
registerInputCompactor("model", async (value, format, registry) => {
  if (typeof value === "object" && value !== null && "model_id" in value) {
    const id = (value as Record<string, unknown>).model_id;
    if (typeof id !== "string") return undefined;
    const modelRepo = registry.get(MODEL_REPOSITORY);
    const model = await modelRepo.findByName(id);
    if (!model) return undefined;
    return id;
  }
  return undefined;
});
```

---

## Resolution Flow

The `resolveSchemaInputs()` function is the entry point for input resolution. It is called by the
`TaskRunner` before a task's `execute()` method, transforming string identifiers into their resolved
runtime objects.

### Function Signature

```typescript
async function resolveSchemaInputs<T extends Record<string, unknown>>(
  input: T,
  schema: DataPortSchema,
  config: InputResolverConfig
): Promise<T>;
```

### Algorithm

The resolution proceeds in two phases per property:

**Phase 1: Format-annotated string resolution**

1. Extract the `format` from the property schema (handling `oneOf`/`anyOf` wrappers via
   `getSchemaFormat()`).
2. Look up a resolver: first by the full format string (e.g., `"model:TextGenerationTask"`), then
   by the prefix (e.g., `"model"`).
3. If the value is a `string`, invoke the resolver to convert it to an object.
4. If the value is an `Array`, resolve any string elements while passing non-string elements through
   unchanged.

**Phase 2: Recursive object resolution**

5. If the value is a non-null object and the schema defines nested properties (via
   `getObjectSchema()`), recurse into the nested object to resolve any format-annotated properties
   within it.

### Helper Functions

| Function                             | Purpose                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `getSchemaFormat(schema)`            | Extracts `format` from a schema, checking `oneOf`/`anyOf` variants |
| `getObjectSchema(schema)`            | Extracts the object-typed variant from `oneOf`/`anyOf` wrappers    |
| `getFormatPrefix(format)`            | Returns the prefix before the colon (`"model:Foo"` -> `"model"`)   |
| `schemaHasFormatAnnotations(schema)` | Fast-path check: returns `true` if any property has a format       |

### Example Flow

```typescript
// Task schema declares: model property with format "model:TextGenerationTask"
const schema = {
  type: "object",
  properties: {
    model: { oneOf: [{ type: "string", format: "model:TextGenerationTask" }, ...] },
    prompt: { type: "string" },
  },
};

// User provides a string ID
const input = { model: "gpt-4", prompt: "Hello world" };

// resolveSchemaInputs transforms:
const resolved = await resolveSchemaInputs(input, schema, { registry });
// resolved.model === { model_id: "gpt-4", provider: "openai", tasks: [...], ... }
// resolved.prompt === "Hello world"  (no format annotation, passed through)
```

---

## Compaction Flow

The `compactSchemaInputs()` function reverses resolution, converting resolved objects back to their
string identifiers. This is used when serializing task state or displaying inputs in the UI.

### Function Signature

```typescript
async function compactSchemaInputs<T extends Record<string, unknown>>(
  input: T,
  schema: DataPortSchema,
  config: InputCompactorConfig
): Promise<T>;
```

### Algorithm

For each property in the schema:

1. Extract the `format` and look up a compactor (full format, then prefix).
2. If the value is a non-null, non-array object **and** the schema allows a string variant
   (checked via `schemaAllowsString()`), attempt to compact it to a string ID.
3. If the value is an array, attempt to compact each object element individually.
4. If the value is already a string, pass it through unchanged.
5. For uncompacted objects with nested properties, recurse into the nested schema.

The `schemaAllowsString()` check is critical: it ensures compaction only occurs when the schema
declares that a string is a valid variant (via `oneOf`/`anyOf`). This prevents compacting objects
that should remain as objects.

```typescript
// Before compaction
const input = {
  model: { model_id: "gpt-4", provider: "openai", provider_config: {}, ... },
  prompt: "Hello world",
};

// After compaction
const compacted = await compactSchemaInputs(input, schema, { registry });
// compacted.model === "gpt-4"
// compacted.prompt === "Hello world"
```

---

## Type Helpers

### DataPortSchemaNonBoolean

Excludes the `boolean` variant from `DataPortSchema`, useful when you know you are working with an
actual schema object:

```typescript
type DataPortSchemaNonBoolean<EXTENSION> = Exclude<JsonSchema<EXTENSION>, Boolean>;
```

### PropertySchema

The type of a single property within a `DataPortSchemaObject`:

```typescript
type PropertySchema = NonNullable<DataPortSchemaObject["properties"]>[string];
```

### TypeModelSemantic

A string literal type constraining model format annotations:

```typescript
type TypeModelSemantic = "model" | `model:${string}`;
```

### TTypeModel

A narrowed schema type for model string properties:

```typescript
type TTypeModel = DataPortSchemaNonBoolean & {
  readonly type: "string";
  readonly format: TypeModelSemantic;
};
```

---

## API Reference

### resolveSchemaInputs(input, schema, config)

Resolves format-annotated string values in `input` to their runtime objects using registered
resolvers. Called automatically by the task runner before `execute()`.

| Parameter         | Type                      | Description                      |
| ----------------- | ------------------------- | -------------------------------- |
| `input`           | `Record<string, unknown>` | The raw task input               |
| `schema`          | `DataPortSchema`          | The task's input schema          |
| `config.registry` | `ServiceRegistry`         | DI registry for resolver lookups |
| **Returns**       | `Promise<T>`              | Input with resolved values       |

### compactSchemaInputs(input, schema, config)

Converts resolved objects back to string IDs using registered compactors.

| Parameter         | Type                      | Description                       |
| ----------------- | ------------------------- | --------------------------------- |
| `input`           | `Record<string, unknown>` | The resolved task input           |
| `schema`          | `DataPortSchema`          | The task's input schema           |
| `config.registry` | `ServiceRegistry`         | DI registry for compactor lookups |
| **Returns**       | `Promise<T>`              | Input with compacted values       |

### registerInputResolver(formatPrefix, resolver)

Registers a resolver function for a format prefix.

| Parameter      | Type              | Description                         |
| -------------- | ----------------- | ----------------------------------- |
| `formatPrefix` | `string`          | The format prefix (e.g., `"model"`) |
| `resolver`     | `InputResolverFn` | The resolver function               |

### registerInputCompactor(formatPrefix, compactor)

Registers a compactor function for a format prefix.

| Parameter      | Type               | Description                         |
| -------------- | ------------------ | ----------------------------------- |
| `formatPrefix` | `string`           | The format prefix (e.g., `"model"`) |
| `compactor`    | `InputCompactorFn` | The compactor function              |

### getSchemaFormat(schema)

Extracts the `format` string from a schema, handling `oneOf`/`anyOf` wrappers. Returns `undefined`
if no format is found.

### getObjectSchema(schema)

Extracts the object-typed schema variant from a property schema, handling `oneOf`/`anyOf` wrappers.
Returns `undefined` if no object variant exists.

### getFormatPrefix(format)

Returns the portion of a format string before the first colon. For `"model:TextGenerationTask"`
returns `"model"`. For `"model"` returns `"model"`.

### schemaHasFormatAnnotations(schema)

Fast-path check that returns `true` if any property in the schema has a `format` annotation. Used
to skip resolution entirely when no format-annotated properties exist.

### TypeModel(semantic, options)

Schema helper that creates a `oneOf` schema accepting either a model string ID or a full
`ModelConfig` object. The `semantic` parameter defaults to `"model"` and can be narrowed to a
specific task type (e.g., `"model:TextGenerationTask"`).

### TypeSingleOrArray(type)

Schema helper that wraps a schema to accept either a single value or an array of that value type.

### TypeModelAsString(semantic, options)

Creates the string-only variant of a model schema with the given format annotation.

### TypeModelByDetail(semantic, options)

Creates the full `ModelConfig` object variant of a model schema with the given format annotation.
