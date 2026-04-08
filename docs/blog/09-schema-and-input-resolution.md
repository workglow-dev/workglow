<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Schema as Source of Truth: How Workglow Turns JSON Schema into a Runtime Superpower

You know that moment in a conference talk when someone shows a diagram and you think, "Wait, that one file really does *all* of that?" That is what we are going to explore today. In Workglow, JSON Schema is not just a validation tool. It is the beating heart of the entire system -- driving types, validation, UI rendering, streaming behavior, and automatic runtime resolution of resources. One schema declaration ripples across the entire stack.

Let's walk through how that works, piece by piece.

---

## The Schema: One Declaration to Rule Them All

Every task in Workglow declares its inputs and outputs as static JSON Schema objects. Here is a simplified version of what a text generation task looks like:

```ts
export const TextGenerationInputSchema = {
  type: "object",
  properties: {
    model: {
      oneOf: [
        { type: "string", format: "model:TextGenerationTask" },
        { type: "object", format: "model:TextGenerationTask", properties: { /* ... */ } },
      ],
      format: "model:TextGenerationTask",
    },
    prompt: {
      type: "string",
      title: "Prompt",
      description: "The prompt to generate text from",
    },
    temperature: {
      type: "number",
      minimum: 0,
      maximum: 2,
      "x-ui-group": "Configuration",
    },
  },
  required: ["model", "prompt"],
} as const satisfies DataPortSchema;
```

That single schema object serves five different purposes simultaneously:

1. **TypeScript types** -- `FromSchema<typeof TextGenerationInputSchema>` extracts a compile-time type.
2. **Runtime validation** -- the task runner validates inputs against the schema before execution.
3. **UI generation** -- `x-ui-group`, `x-ui-hidden`, `x-ui-order`, and friends tell a visual editor how to render property controls.
4. **Streaming behavior** -- output properties annotated with `x-stream` declare how data flows in real time.
5. **Automatic resolution** -- the `format` annotation triggers conversion from string IDs to live runtime objects.

That last one is the most surprising, and it is what we will spend most of our time on.

---

## Format Annotations: The Magic Incantation

Standard JSON Schema uses the `format` keyword for things like `"date-time"` or `"email"`. Workglow repurposes it as a semantic type system. When you write `format: "model:TextGenerationTask"`, you are saying: "This string is not just any string. It is a model identifier, and specifically one suited for text generation."

The format system supports a prefix convention with an optional colon-delimited specialization:

| Format | Meaning |
|---|---|
| `"model"` | Any AI model |
| `"model:TextGenerationTask"` | A model suitable for text generation |
| `"model:EmbeddingTask"` | A model suitable for embeddings |
| `"storage:tabular"` | A tabular data store |
| `"knowledge-base"` | A knowledge base (documents + vector chunks) |
| `"credential"` | A credential key from the credential store |
| `"tasks"` | A registered task definition |

The beauty is that a user can pass a simple string -- `"gpt-4o"` or `"my-knowledge-base"` -- and the system automatically resolves it to the full runtime object before `execute()` is ever called. The task author receives a `ModelConfig` object or a `KnowledgeBase` instance. No manual lookup code required.

---

## Input Resolvers: String In, Object Out

The resolution magic lives in a global registry of resolver functions. Each resolver is registered against a format prefix:

```ts
// In ModelRegistry.ts
registerInputResolver("model", async (id, format, registry) => {
  const modelRepo = registry.get(MODEL_REPOSITORY);
  const model = await modelRepo.findByName(id);
  if (!model) throw new Error(`Model "${id}" not found in repository`);
  return model;
});
```

When the `TaskRunner` is about to execute a task, it walks the input schema, finds properties with `format` annotations, and feeds any string values through the matching resolver:

```ts
// Inside TaskRunner.run()
const schema = (this.task.constructor as typeof Task).inputSchema();
this.task.runInputData = await resolveSchemaInputs(
  this.task.runInputData,
  schema,
  { registry: this.registry }
);
```

The `resolveSchemaInputs` function does the heavy lifting. For each property in the schema, it checks whether a `format` is present, looks up a resolver (trying the full format string first, then falling back to the prefix), and replaces the string value with whatever the resolver returns. It also handles arrays -- if you pass `["model-a", "model-b"]`, each string element gets resolved individually. And non-string values pass through untouched, so you can always provide a pre-resolved object directly.

The resolution is recursive, too. If a resolver returns an object, and that object has nested properties with their own format annotations, those get resolved in turn. This lets you handle patterns like a model config that contains a nested `credential_key`:

```ts
// String "my-model" resolves to:
{
  provider: "openai",
  provider_config: {
    credential_key: "secret-ref"  // <-- this also gets resolved!
  }
}
```

The credential resolver picks up `"secret-ref"` and resolves it from the credential store. Two levels of resolution, zero manual wiring.

---

## Input Compactors: Object Out, String In

Now here is the question that makes engineers lean forward in their seats: if you have resolved a string into an object, how do you get the string back?

You need the reverse direction for two critical reasons:

1. **Cache keys.** Task output caching needs deterministic, serializable keys. You cannot hash an `InMemoryTabularStorage` instance -- but you can hash `"test-dataset"`.
2. **Serialization.** When a task graph is saved to disk or sent to a worker, the inputs need to be portable strings, not live object references.

Enter input compactors -- the mirror image of resolvers:

```ts
// In ModelRegistry.ts
registerInputCompactor("model", async (value, _format, registry) => {
  if (typeof value === "object" && value !== null && "model_id" in value) {
    const id = (value as Record<string, unknown>).model_id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
});
```

The `compactSchemaInputs` function walks the schema just like its resolver counterpart, but in reverse. It finds object values on format-annotated properties and asks the compactor to extract a string ID. If the compactor returns `undefined`, the object is left as-is.

For knowledge bases and tabular storage, the compactor does a reverse map lookup -- it iterates through the global registry to find which ID maps to the given instance by reference equality:

```ts
registerInputCompactor("knowledge-base", (value, _format, registry) => {
  const kbs = registry.get(KNOWLEDGE_BASES);
  for (const [id, kb] of kbs) {
    if (kb === value) return id;
  }
  return undefined;
});
```

This bidirectional mapping -- resolve for execution, compact for persistence -- means the system can freely convert between human-friendly string identifiers and live runtime objects at any boundary.

---

## Custom x-Props: Schema Extensions That Drive Behavior

Beyond `format`, Workglow defines a family of `x-` prefixed extension properties. These are not part of the JSON Schema standard, but they are first-class citizens in Workglow's type system (via `JsonSchemaCustomProps`). Each one controls a different slice of behavior:

### `x-stream`: Streaming Mode

Applied to output properties, `x-stream` declares how a task streams its results:

```ts
const generatedTextSchema = {
  type: "string",
  "x-stream": "append",  // Each chunk is a delta token
};

const translatedTextSchema = {
  type: "string",
  "x-stream": "replace",  // Each chunk replaces the previous snapshot
};

const structuredOutputSchema = {
  type: "object",
  "x-stream": "object",  // Each chunk is a progressively complete partial object
};
```

The task runner reads these annotations to determine the streaming strategy. A task with `"append"` yields `text-delta` events. One with `"object"` yields `object-delta` events. The consumer (UI, downstream task, or graph runner) knows exactly how to accumulate the results based on the schema alone.

### `x-ui-hidden`: Invisible but Present

Some properties are essential for execution but meaningless to a user staring at a visual editor. Marking a property `"x-ui-hidden": true` tells the UI layer to skip rendering a control for it, while still allowing the value to flow through dataflow connections:

```ts
compoundMerge: { type: "string", "x-ui-hidden": true }
```

### `x-ui-group`: Organized Configuration

Properties can be grouped into collapsible sections in a UI using `"x-ui-group"`:

```ts
temperature: {
  type: "number",
  "x-ui-group": "Configuration",
}
```

Combined with `x-ui-group-order` and `x-ui-group-priority`, this gives task authors fine-grained control over how a visual editor presents dozens of knobs.

### `x-auto-generated`: Storage-Managed Keys

For tabular and vector storage schemas, `"x-auto-generated": true` tells the storage backend to manage the value automatically -- integers get auto-incremented, strings get UUIDs:

```ts
const schema = {
  type: "object",
  properties: {
    id: { type: "integer", "x-auto-generated": true },
    name: { type: "string" },
  },
};
```

The storage layer reads this annotation during `put()` operations and fills in missing primary key values. No application code needed.

### `x-structured-output`: AI Provider Hint

When an output port declares `"x-structured-output": true`, the AI execution strategy knows to request structured/JSON output from the provider, enabling features like OpenAI's structured outputs or Anthropic's tool-use-based JSON generation.

### `x-replicate`: Array Broadcasting

The `ArrayTask` uses `"x-replicate": true` to mark inputs that should be broadcast across array elements, enabling batch processing patterns where a single configuration value is paired with each element of an input array.

---

## Type Helpers: Schema Factories for Common Patterns

Writing `oneOf` schemas with format annotations by hand is tedious and error-prone. Workglow provides factory functions that generate the correct schema structure:

```ts
// Model input: accepts string ID or inline config object
TypeModel("model:TextGenerationTask")
// Produces: { oneOf: [{ type: "string", format: "model:TextGenerationTask" }, { type: "object", ... }], format: "model:TextGenerationTask" }

// Tabular storage: accepts string ID or instance
TypeTabularStorage({ title: "Output Storage" })
// Produces: { format: "storage:tabular", oneOf: [{ type: "string" }, { additionalProperties: true }] }

// Knowledge base: accepts string ID or instance
TypeKnowledgeBase({ description: "Search target" })
// Produces: { format: "knowledge-base", anyOf: [{ type: "string" }, { additionalProperties: true }] }

// Wrapping any schema in single-or-array
TypeSingleOrArray(TypeModel("model:EmbeddingTask"))
// Produces: { anyOf: [<model-schema>, { type: "array", items: <model-schema> }] }
```

These helpers encode the `oneOf`/`anyOf` pattern that lets a property accept either a string (for resolution) or a direct object (for pass-through). They also set the `format` annotation at the right level, so the resolver system finds it regardless of which variant the user provides.

The `TypeModel` helper even generates a human-readable description from the semantic suffix -- `"model:TextGenerationTask"` becomes a description of "The model for text generation."

---

## Extensibility: Adding a New Format

Here is what makes this system elegant: adding support for a completely new kind of resolvable resource requires zero changes to the core engine. You just register a resolver and (optionally) a compactor:

```ts
// 1. Define your registry
const FEATURE_FLAGS = createServiceToken<Map<string, FeatureFlagSet>>(
  "feature-flags.registry"
);

// 2. Register a resolver
registerInputResolver("feature-flags", (id, format, registry) => {
  const flags = registry.get(FEATURE_FLAGS);
  const flagSet = flags.get(id);
  if (!flagSet) throw new Error(`Feature flag set "${id}" not found`);
  return flagSet;
});

// 3. Register a compactor
registerInputCompactor("feature-flags", (value, format, registry) => {
  const flags = registry.get(FEATURE_FLAGS);
  for (const [id, flagSet] of flags) {
    if (flagSet === value) return id;
  }
  return undefined;
});

// 4. Create a schema helper
function TypeFeatureFlags(options = {}) {
  return {
    title: "Feature Flags",
    format: "feature-flags" as const,
    oneOf: [
      { type: "string", title: "Flag Set ID" },
      { title: "Flag Set Instance", additionalProperties: true },
    ],
    ...options,
  } as const satisfies JsonSchema;
}

// 5. Use it in any task
class MyTask extends Task {
  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        flags: TypeFeatureFlags(),
        // ...
      },
    };
  }
}
```

That is it. The `TaskRunner` will now automatically resolve `"production-flags"` into a `FeatureFlagSet` instance for any task that uses this schema. The core resolution engine, the caching system, the serialization layer -- none of them need to know about feature flags. They just follow the format annotation.

---

## The Big Picture

Step back, and the design becomes clear. JSON Schema is not metadata bolted onto the side of the system. It is the contract that every subsystem reads from:

- **TypeScript** reads it at compile time for type safety.
- **Validation** reads it at the task boundary to catch bad inputs.
- **The UI** reads `x-ui-*` annotations to render editors and group controls.
- **The streaming engine** reads `x-stream` to choose accumulation strategies.
- **The resolver** reads `format` to hydrate string IDs into live objects.
- **The compactor** reads `format` to dehydrate objects back into portable strings.
- **Storage backends** read `x-auto-generated` to manage primary keys.
- **AI providers** read `x-structured-output` to request JSON mode.

One source of truth, many consumers. When you change a schema, the entire stack adapts. When you add a new format, the entire resolution pipeline supports it. When you annotate a property with `x-stream: "append"`, streaming just works.

That is what it means for schema to be the source of truth -- not a document you write and forget, but a living specification that the runtime reads on every single execution.
