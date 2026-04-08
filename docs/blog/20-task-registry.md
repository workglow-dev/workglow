<!--
@license
Copyright 2025 Steven Roussey <sroussey@gmail.com>
SPDX-License-Identifier: Apache-2.0
-->

# The Task Registry: Dynamic Composition From the Ground Up

*How Workglow discovers, catalogs, and instantiates tasks at runtime -- and why that matters for visual editors, serialization, and plugin ecosystems.*

---

## Why a Global Registry?

Consider a visual pipeline editor. A user opens a sidebar, sees a categorized list of available tasks -- "AI Text Model", "Utility", "Math", "String" -- drags one onto the canvas, and wires it to other nodes. Behind the scenes, the editor needs to answer three questions at runtime:

1. **What tasks exist?** It must enumerate every available task type, complete with human-readable titles, descriptions, and categories.
2. **What does each task accept and produce?** It must read input and output schemas to render ports, validate connections, and present configuration forms.
3. **How do I create one?** Given a task type name from a saved file or a drag event, it must instantiate the correct class with the right configuration.

A naive approach -- importing every task class directly and maintaining a hand-coded switch statement -- collapses under its own weight the moment your library has fifty task types. And Workglow has far more than fifty.

The `TaskRegistry` exists to answer all three questions with a single, centralized data structure: a `Map<string, ITaskConstructor>` that maps type names to their constructor functions. Every registered constructor carries its metadata as static properties, so the registry is simultaneously a catalog, a factory, and a schema repository.

```typescript
const taskConstructors = new Map<string, AnyTaskConstructor>();

export const TaskRegistry = {
  all: taskConstructors,
  registerTask,
};
```

That is the entire public surface. A `Map` and a function. The simplicity is deliberate.

---

## The Self-Registration Pattern

Tasks in Workglow do not wait to be discovered. They announce themselves. The pattern is straightforward: each package that defines tasks provides a registration function that pushes its constructors into the global registry at initialization time.

The `@workglow/task-graph` package registers the structural tasks -- the control-flow primitives that make pipeline composition possible:

```typescript
export const registerBaseTasks = () => {
  const tasks = [GraphAsTask, ConditionalTask, FallbackTask, MapTask, WhileTask, ReduceTask];
  tasks.map(TaskRegistry.registerTask);
  return tasks;
};
```

The `@workglow/tasks` package registers the utility tasks -- the everyday building blocks:

```typescript
export const registerCommonTasks = () => {
  const tasks = [
    DebugLogTask, DelayTask, FetchUrlTask, InputTask, JavaScriptTask,
    JsonTask, LambdaTask, MergeTask, OutputTask, SplitTask,
    ScalarAddTask, ScalarMultiplyTask, /* ... 40+ more ... */
    McpToolCallTask, McpResourceReadTask, StringConcatTask, RegexTask,
  ];
  tasks.map(TaskRegistry.registerTask);
  return tasks;
};
```

And the `@workglow/ai` package registers the AI tasks -- text generation, embedding, classification, vision, RAG, and everything in between:

```typescript
export const registerAiTasks = () => {
  const tasks = [
    TextGenerationTask, TextEmbeddingTask, TextSummaryTask,
    ImageClassificationTask, ChunkRetrievalTask, AgentTask,
    ToolCallingTask, /* ... 30+ more ... */
  ];
  tasks.map(TaskRegistry.registerTask);
  return tasks;
};
```

Application code composes these into a single bootstrap call:

```typescript
export const registerTasks = () => {
  registerBaseTasks();
  registerCommonTasks();
  registerAiTasks();
};
```

This layered registration has a practical benefit beyond organization: **tree-shaking works correctly.** If your application only uses utility tasks, you import `registerCommonTasks` and the AI task constructors never enter your bundle. The registry only knows about what you tell it.

---

## ITaskStaticProperties: The Contract Every Task Must Honor

When a task constructor is registered, the registry does not just store a class reference. It stores something that satisfies the `ITaskStaticProperties` interface -- a contract that guarantees every task carries its own metadata as static members:

```typescript
interface ITaskStaticProperties {
  readonly type: string;           // Unique identifier: "TextGenerationTask"
  readonly category?: string;      // Grouping: "AI Text Model", "Utility", "Math"
  readonly title?: string;         // Human-readable: "Text Generation"
  readonly description?: string;   // What it does, in a sentence
  readonly cacheable: boolean;     // Can outputs be cached?
  readonly hasDynamicSchemas: boolean;
  readonly hasDynamicEntitlements: boolean;
  readonly passthroughInputsToOutputs?: boolean;
  readonly isGraphOutput?: boolean;
  readonly customizable?: boolean;
  readonly inputSchema: () => DataPortSchema;
  readonly outputSchema: () => DataPortSchema;
  readonly configSchema: () => DataPortSchema;
  readonly entitlements: () => TaskEntitlements;
}
```

Consider a concrete example. Here is `DelayTask`, stripped to its static skeleton:

```typescript
class DelayTask extends Task<DelayTaskInput, DelayTaskOutput, DelayTaskConfig> {
  static override readonly type = "DelayTask";
  static override readonly category = "Utility";
  public static override title = "Delay";
  public static override description =
    "Delays execution for a specified duration with progress tracking";
  static override readonly cacheable = false;
  public static override passthroughInputsToOutputs = true;
  public static override customizable = true;

  public static override configSchema(): DataPortSchema {
    return delayTaskConfigSchema;
  }
  static override inputSchema() { return inputSchema; }
  static override outputSchema() { return outputSchema; }
}
```

Every field serves a purpose in the larger system:

- **`type`** is the serialization key. When a pipeline is saved to JSON, each task records its type string. When the pipeline is loaded, the registry looks up that string to find the constructor.
- **`category`** drives UI grouping. A visual editor can call `TaskRegistry.all` and partition the results by category to build a structured sidebar.
- **`title`** and **`description`** are what end users see. They appear in tooltips, search results, and documentation panels.
- **`cacheable`** tells the execution engine whether outputs can be memoized. A `DelayTask` has side effects (it waits), so `cacheable` is false. A pure math task like `ScalarAddTask` is cacheable.
- **`inputSchema()`** and **`outputSchema()`** return JSON Schema objects that define ports. These schemas determine what connections are valid in a graph and what form fields to render in a property panel.
- **`entitlements()`** declares what permissions the task requires -- network access, filesystem reads, credential usage, code execution. This is critical for sandboxed environments.

The `ITaskConstructor` type ties it all together: it is the intersection of a constructor function and `ITaskStaticProperties`. When you pull a value from the registry, you get both the ability to create instances and full access to class-level metadata.

```typescript
type ITaskConstructor<Input, Output, Config> =
  ITaskConstructorType<Input, Output, Config> & ITaskStaticProperties;
```

---

## String-Based Instantiation

The payoff of registration is dynamic instantiation. Given a type name -- from a JSON file, a drag-and-drop event, or a user search query -- you can create any task:

```typescript
const constructors = TaskRegistry.all;
const ctor = constructors.get("TextGenerationTask");
if (ctor) {
  const task = new ctor({ id: "my-task" });
}
```

This pattern is the backbone of JSON deserialization. The `createSingleTaskFromJSON` function in `TaskJSON.ts` does exactly this:

```typescript
const createSingleTaskFromJSON = (item, registry, options) => {
  // Validate the type exists
  const constructors = getTaskConstructors(registry);
  const ctor = constructors.get(item.type);
  if (!ctor) throw new TaskJSONError(`Unknown task type: ${item.type}`);
  // Instantiate
  return new ctor(item.config);
};
```

Notice the `options` parameter. It supports an `allowedTypes` set, which lets you restrict which task types can be instantiated from untrusted JSON. If someone tries to sneak a `JavaScriptTask` (which executes arbitrary code) into a pipeline that should only contain math operations, the deserializer rejects it before any constructor runs. Security by construction, not by hope.

---

## DI Integration: TASK_CONSTRUCTORS and Scoped Registries

The global `TaskRegistry` is convenient, but it is a singleton -- and singletons do not compose well when you need isolated environments. A multi-tenant server, a testing harness, or an embedded editor might each need a different set of available tasks.

Workglow solves this with its dependency injection layer. The `TASK_CONSTRUCTORS` service token maps to the same `Map<string, AnyTaskConstructor>` that the registry uses, but it can be overridden per `ServiceRegistry` scope:

```typescript
export const TASK_CONSTRUCTORS =
  createServiceToken<Map<string, AnyTaskConstructor>>("task.constructors");

// Default: backed by the global TaskRegistry
globalServiceRegistry.register(
  TASK_CONSTRUCTORS,
  (): Map<string, AnyTaskConstructor> => TaskRegistry.all,
  true
);
```

The `getTaskConstructors(registry?)` function respects scope: if a local registry has its own `TASK_CONSTRUCTORS` binding, that takes precedence. Otherwise, it falls back to the global map.

```typescript
function getTaskConstructors(registry?: ServiceRegistry): Map<string, AnyTaskConstructor> {
  if (!registry) return TaskRegistry.all;
  return registry.has(TASK_CONSTRUCTORS)
    ? registry.get(TASK_CONSTRUCTORS)
    : TaskRegistry.all;
}
```

This means you can create a restricted environment -- say, one that only exposes math and string tasks to an untrusted user -- by registering a filtered map on a scoped `ServiceRegistry`. The graph runner, the JSON deserializer, and the input resolver all read from `getTaskConstructors`, so the restriction propagates everywhere without any special-case code.

---

## The Input Resolver: format "tasks"

Workglow has a general-purpose input resolver system that converts string identifiers into rich objects at execution time. You have probably seen `format: "model"` annotations in task schemas, which resolve model name strings to full model configuration objects. The same mechanism works for tasks themselves.

When a schema property carries `format: "tasks"`, the resolver converts a task type name into a complete tool definition:

```typescript
function resolveTaskFromRegistry(id, _format, registry) {
  const constructors = getTaskConstructors(registry);
  const ctor = constructors.get(id);
  if (!ctor) return undefined;

  return {
    name: ctor.type,
    description: ctor.description ?? "",
    inputSchema: ctor.inputSchema(),
    outputSchema: ctor.outputSchema(),
    ...(ctor.configSchema ? { configSchema: ctor.configSchema() } : {}),
  };
}

registerInputResolver("tasks", resolveTaskFromRegistry);
```

This is the bridge between lightweight storage (a string like `"TextGenerationTask"`) and the rich data that execution needs (full schema definitions). The companion `registerInputCompactor` does the reverse -- extracting the `name` field from a resolved object back into a string for serialization:

```typescript
registerInputCompactor("tasks", (value, _format, registry) => {
  if (typeof value === "object" && value !== null && "name" in value) {
    const name = value.name;
    const constructors = getTaskConstructors(registry);
    return constructors.has(name) ? name : undefined;
  }
  return undefined;
});
```

This resolver/compactor pair means that tasks which operate on other tasks -- like an `AgentTask` that selects tools dynamically, or a meta-programming task that builds pipelines from descriptions -- can reference tasks by name in their inputs and get full definitions at runtime.

---

## registerCommonTasks(): Batch Registration Done Right

The `registerCommonTasks()` function deserves a closer look, because its design reflects several deliberate choices.

First, it is a **function, not a side effect**. It does not run at import time. You call it explicitly during application startup. This means importing the `@workglow/tasks` package for its type definitions does not silently mutate global state.

Second, it **returns the registered tasks**. This is useful for testing and introspection -- you can check what was registered, or use the return value to set up targeted test fixtures.

Third, the implementation is a one-liner: `tasks.map(TaskRegistry.registerTask)`. No ceremony, no configuration objects, no builder patterns. Each task class is its own configuration, carrying everything the registry needs as static properties. The registration call simply stores the reference.

The three-layer registration hierarchy -- `registerBaseTasks()` for control flow, `registerCommonTasks()` for utilities, `registerAiTasks()` for AI -- mirrors the package dependency graph. Base tasks have zero external dependencies. Common tasks depend on `@workglow/task-graph`. AI tasks depend on the model system. You compose exactly the layers you need.

---

## Dynamic UI Composition: From Registry to Canvas

With the registry populated, building a visual editor becomes a matter of reading data structures rather than hard-coding knowledge about tasks. Here is the conceptual flow:

**1. List all tasks:**

```typescript
const allTasks = Array.from(TaskRegistry.all.values());
```

**2. Group by category:**

```typescript
const categories = new Map<string, AnyTaskConstructor[]>();
for (const ctor of allTasks) {
  const cat = ctor.category ?? "Uncategorized";
  if (!categories.has(cat)) categories.set(cat, []);
  categories.get(cat)!.push(ctor);
}
// Result: "AI Text Model" => [TextGenerationTask, TextSummaryTask, ...]
//         "Utility" => [DelayTask, FetchUrlTask, ...]
//         "Math" => [ScalarAddTask, ScalarMultiplyTask, ...]
```

**3. Render a task palette:** Each entry shows `ctor.title` and `ctor.description`. A search bar filters by both. Clicking or dragging triggers instantiation.

**4. Build a property panel:** When a task is selected on the canvas, read its `inputSchema()` and `configSchema()` to generate form fields. Schema annotations like `x-ui-group` control layout grouping. The `title` and `description` fields on each property drive labels and tooltips.

**5. Validate connections:** When a user drags a wire from one task's output port to another's input port, compare the source property's schema against the target's. Types must be compatible. The `format` annotation on ports like `format: "model:TextGenerationTask"` adds semantic specificity beyond raw JSON Schema types.

**6. Show entitlements:** Before running a pipeline, aggregate `entitlements()` from every task in the graph. Display a permissions dialog: "This pipeline requires: network access (FetchUrlTask), AI model inference (TextGenerationTask), code execution (JavaScriptTask). Allow?"

**7. Serialize and restore:** Save the graph to JSON using type strings. Load it back with `createSingleTaskFromJSON`, which looks up each type in the registry. The `allowedTypes` option lets you restrict what a loaded file can contain.

Every step depends on the same underlying mechanism: a registry of constructors that carry their own metadata. No reflection, no decorators, no external configuration files. The task class is the source of truth, and the registry is the index.

---

## The Bigger Picture

The Task Registry is not just a convenience for visual editors. It is the foundation for several capabilities that emerge from treating task types as first-class, discoverable data:

- **Plugin systems**: Third-party packages register their own tasks with `TaskRegistry.registerTask`. No framework hooks, no manifest files. Just call the function.
- **Serialization**: Pipelines serialize to JSON with type strings and deserialize back to live objects without any custom parsing logic per task type.
- **Scoped environments**: DI-backed registries let you run isolated pipelines with different available task sets on the same server process.
- **Runtime introspection**: AI agents can query the registry to discover what tools are available, read their schemas, and compose pipelines programmatically.
- **Security boundaries**: The `allowedTypes` mechanism and entitlement system let you enforce what tasks can be instantiated and what resources they can access.

The pattern is old -- service locators have existed for decades. What makes Workglow's implementation effective is the decision to put metadata on the constructor itself. There is no separate manifest to keep in sync, no decorator magic to debug, no configuration file to forget to update. You write a class with the right static properties, you register it, and every system in the framework can discover and use it.

That is the kind of simplicity that scales.
