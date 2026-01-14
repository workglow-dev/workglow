# Task System Documentation

This module provides a flexible task processing system with support for various task types, dependency management, and error handling.

- [Key Components](#key-components)
  - [Core Classes](#core-classes)
- [Task Types](#task-types)
  - [A Simple Task](#a-simple-task)
  - [GraphAsTask](#graphastask)
  - [Job Queue Tasks](#job-queue-tasks)
- [Task Lifecycle](#task-lifecycle)
- [Event Handling](#event-handling)
- [Input/Output Schemas](#inputoutput-schemas)
- [Registry \& Queues](#registry--queues)
- [Input Resolution](#input-resolution)
- [Error Handling](#error-handling)
- [Testing](#testing)
- [Installation](#installation)

## Key Components

### Core Classes

- `Task`: Base class implementing core task functionality
- `JobQueueTask`: Integrates with job queue system for distributed processing

## Task Types

### A Simple Task

```typescript
import { Task, type DataPortSchema } from "@workglow/task-graph";
import { Type } from "@sinclair/typebox";

interface MyTaskInput {
  input: number;
}
interface MyTaskOutput {
  result: number;
}
class MyTask extends Task {
  static readonly type = "MyTask"; // Required, unique identifier for the task
  static readonly category = "Utility"; // Optional, used for grouping tasks in UI
  static readonly title = "My Task"; // Optional, used for a UI
  static readonly description = "My Task Description"; // Optional, used for a UI
  declare runInputData: MyTaskInput;
  declare runOutputData: MyTaskOutput;
  static inputSchema = Type.Object({
    input: Type.Number(),
  });
  static outputSchema = Type.Object({
    result: Type.Number(),
  });

  // typically you either override execute or executeReactive, but not both
  async execute(input: MyTaskInput, { signal, updateProgress }: IExecuteContext) {
    await sleep(1000);
    if (signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await updateProgress(0.5, "Processing...");
    // Do something with the input that takes a long time
    await sleep(1000);
    return { result: input.input * 2 };
  }
  async executeReactive(input: MyTaskInput, output: MyTaskOutput) {
    return { result: input.input * 2 };
  }
}
```

### GraphAsTask

- GraphAsTask tasks are tasks that contain other tasks. They are represented as an internal TaskGraph.

### Job Queue Tasks

JobQueueTask is a task that can be used to run a task in a job queue. This is useful for when there might be rate limits or other constraints on the task that make it better to run in a job queue than in the main thread.

```typescript
class MyJobTask extends JobQueueTask {
  async createJob() {
    return new Job({
      input: this.runInputData,
      execute: (input) => ({ result: input.value * 3 }),
    });
  }
}
```

## Task Lifecycle

- **Statuses**: `Pending` → `Processing` → (`Completed`|`Failed`|`Aborted`)
- **Methods**:
  - `run()`: Full execution with caching, calls the subclass `execute` method
  - `runReactive()`: Lightweight execution for UI updates, calls the subclass `executeReactive` method
  - `abort()`: Cancel running task

## Event Handling

```typescript
task.on("start", () => console.log("Task started"));
task.on("progress", (p) => console.log(`Progress: ${p}%`));
task.on("complete", () => console.log("Task completed"));
task.on("error", (err) => console.error("Task failed", err));
task.on("abort", () => console.log("Task aborted"));
task.on("regenerate", () => console.log("Task regenerated"));
```

## Input/Output Schemas

The input and output schemas are JSON schemas that are used to validate the input and output of the task. These can be defined using plain JSON Schema objects, TypeBox, or Zod. All schemas must be compatible with `DataPortSchema` from `@workglow/util`.

### Using Plain JSON Schema

```typescript
import { DataPortSchema } from "@workglow/util";

static inputSchema = () => {
  return {
    type: "object",
    properties: {
      username: {
        type: "string",
        title: "User Name",
        description: "The name of the user",
        default: "guest",
      },
    },
    additionalProperties: false,
  } as const satisfies DataPortSchema;
};

static outputSchema = () => {
  return {
    type: "object",
    properties: {
      result: {
        type: "number",
        title: "Processing Result",
        description: "The result of the processing",
      },
    },
    required: ["result"],
    additionalProperties: false,
  } as const satisfies DataPortSchema;
};
```

### Using TypeBox

TypeBox schemas are JSON Schema compatible and can be used directly:

```typescript
import { Type } from "@sinclair/typebox";
import { DataPortSchema } from "@workglow/util";

static inputSchema = () => {
  return Type.Object({
    username: Type.String({
      title: "User Name",
      description: "The name of the user",
      default: "guest",
    }),
  }) satisfies DataPortSchema;
};

static outputSchema = () => {
  return Type.Object({
    result: Type.Number({
      title: "Processing Result",
      description: "The result of the processing",
    }),
  }) satisfies DataPortSchema;
};

type MyInput = FromSchema<typeof MyInputSchema>;
type MyOutput = FromSchema<typeof MyOutputSchema>;

class MyTask extends Task<MyInput, MyOutput> {
  static readonly type = "MyTask";
  static inputSchema = () => MyInputSchema;
  static outputSchema = () => MyOutputSchema;
}
```

### Using Zod

Zod 4 has built-in JSON Schema support using the `.toJSONSchema()` method:

```typescript
import { z } from "zod";
import { DataPortSchema } from "@workglow/util";

// Define Zod schemas
const inputSchemaZod = z.object({
  username: z.string().default("guest").describe("The name of the user"),
});

const outputSchemaZod = z.object({
  result: z.number().describe("The result of the processing"),
});

// Infer TypeScript types using Zod's built-in type inference
type MyInput = z.infer<typeof inputSchemaZod>;
type MyOutput = z.infer<typeof outputSchemaZod>;

class MyTask extends Task<MyInput, MyOutput> {
  static readonly type = "MyTask";
  static inputSchema = () => {
    return inputSchemaZod.toJSONSchema() as DataPortSchema;
  };

  static outputSchema = () => {
    return outputSchemaZod.toJSONSchema() as DataPortSchema;
  };
}
```

## Registry & Queues

The TaskRegistry is used to register tasks to there is a global registry. This is useful for a node based UI to allow tasks to be dragged and dropped onto the canvas.

```typescript
TaskRegistry.registerTask(MyTask);
```

The TaskQueueRegistry is used to get a queue for a given name. This is useful for when you want to run a task in a job queue. A queue can be created for a given task type, and all the tasks of that type will be added to the queue.

```typescript
// Queue management
const queue = getTaskQueueRegistry().getQueue("processing");
queue.add(new MyJobTask());
```

## Input Resolution

The TaskRunner automatically resolves schema-annotated string inputs to their corresponding instances before task execution. This allows tasks to accept either string identifiers (like `"my-model"` or `"my-repository"`) or direct object instances, providing flexibility in how tasks are configured.

### How It Works

When a task's input schema includes properties with `format` annotations (such as `"model"`, `"model:TaskName"`, or `"repository:tabular"`), the TaskRunner inspects each input property:

- **String values** are looked up in the appropriate registry and resolved to instances
- **Object values** (already instances) pass through unchanged

This resolution happens automatically before `validateInput()` is called, so by the time `execute()` runs, all annotated inputs are guaranteed to be resolved objects.

### Example: Task with Repository Input

```typescript
import { Task } from "@workglow/task-graph";
import { TypeTabularRepository } from "@workglow/storage";

class DataProcessingTask extends Task<{ repository: ITabularStorage; query: string }> {
  static readonly type = "DataProcessingTask";

  static inputSchema() {
    return {
      type: "object",
      properties: {
        repository: TypeTabularRepository({
          title: "Data Source",
          description: "Repository to query",
        }),
        query: { type: "string", title: "Query" },
      },
      required: ["repository", "query"],
    };
  }

  async execute(input: DataProcessingTaskInput, context: IExecuteContext) {
    // repository is guaranteed to be an ITabularStorage instance
    const data = await input.repository.getAll();
    return { results: data };
  }
}

// Usage with string ID (resolved automatically)
const task = new DataProcessingTask();
await task.run({ repository: "my-registered-repo", query: "test" });

// Usage with direct instance (passed through)
await task.run({ repository: myRepositoryInstance, query: "test" });
```

### Registering Custom Resolvers

Extend the input resolution system by registering custom resolvers for new format prefixes:

```typescript
import { registerInputResolver } from "@workglow/util";

// Register a resolver for "config:*" formats
registerInputResolver("config", async (id, format, registry) => {
  const configRepo = registry.get(CONFIG_REPOSITORY);
  const config = await configRepo.findById(id);
  if (!config) {
    throw new Error(`Configuration "${id}" not found`);
  }
  return config;
});
```

## Error Handling

```typescript
try {
  await task.run();
} catch (err) {
  if (err instanceof TaskAbortedError) {
    console.log("Task was aborted");
  }
}
```

## Testing

```bash
bun test
```

## Installation

```bash
bun add @workglow/task-system
```
