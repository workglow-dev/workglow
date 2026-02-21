# @workglow/tasks

A package of task types for common operations, workflow management, and data processing. This package provides building blocks for creating complex task graphs with support for HTTP requests, JavaScript execution, delays, logging, and dynamic task creation.

## Table of Contents

- [Table of Contents](#table-of-contents)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Available Tasks](#available-tasks)
  - [FetchUrlTask](#fetchurltask)
  - [DebugLogTask](#debuglogtask)
  - [DelayTask](#delaytask)
  - [JavaScriptTask](#javascripttask)
  - [LambdaTask](#lambdatask)
  - [JsonTask](#jsontask)
  - [ArrayTask](#arraytask)
  - [Browser Automation Tasks](#browser-automation-tasks)
- [Workflow Integration](#workflow-integration)
- [Error Handling](#error-handling)
- [Configuration](#configuration)
- [Testing](#testing)
- [License](#license)

## Installation

```bash
bun add @workglow/tasks
```

## Quick Start

```typescript
import { Workflow, fetch, debugLog, delay } from "@workglow/tasks";

// Simple workflow example (fluent API)
const workflow = new Workflow()
  .fetch({ url: "https://api.example.com/data", response_type: "json" })
  .debugLog({ log_level: "info" })
  .delay({ delay: 1000 });

const results = await workflow.run();
```

```typescript
import { FetchUrlTask, DebugLogTask, DelayTask } from "@workglow/tasks";

// Simple sequence using Task classes directly
const fetchResult = await new FetchUrlTask({
  url: "https://api.example.com/data",
  response_type: "json",
}).run();

await new DebugLogTask({
  console: fetchResult.json,
  log_level: "info",
}).run();

await new DelayTask({ delay: 1000 }).run();
```

```typescript
import { fetch, debugLog, delay } from "@workglow/tasks";

const data = await fetch({
  url: "https://example.com/readme.txt",
  response_type: "text",
});
await debugLog({
  console: data.text,
  log_level: "info",
});
```

## Available Tasks

### FetchUrlTask

Makes HTTP requests with built-in retry logic, progress tracking, and multiple response types.

**Input Schema:**

- `url` (string, required): The URL to fetch from
- `method` (string, optional): HTTP method ("GET", "POST", "PUT", "DELETE", "PATCH"). Default: "GET"
- `headers` (object, optional): Headers to send with the request
- `body` (string, optional): Request body for POST/PUT requests
- `response_type` (string, optional): Response format ("json", "text", "blob", "arraybuffer"). Default: "json"
- `timeout` (number, optional): Request timeout in milliseconds
- `queue` (boolean|string, optional): Queue handling (`false` runs inline when possible, `true` uses the task's default queue, strings target a specific registered queue). Default: `true`

**Output Schema:**

- `json` (any, optional): JSON response data
- `text` (string, optional): Text response data
- `blob` (Blob, optional): Blob response data
- `arraybuffer` (ArrayBuffer, optional): ArrayBuffer response data

**Examples:**

```typescript
// Simple GET request
const response = await new FetchUrlTask({
  url: "https://api.example.com/users",
  response_type: "json",
}).run();
console.log(response.json);

// POST request with headers
const postResponse = await new FetchUrlTask({
  url: "https://api.example.com/users",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer token",
  },
  body: JSON.stringify({ name: "John", email: "john@example.com" }),
  response_type: "json",
}).run();

// Text response
const textResponse = await new FetchUrlTask({
  url: "https://example.com/readme.txt",
  response_type: "text",
}).run();
console.log(textResponse.text);
```

**Features:**

- Automatic retry on 429/503 status codes with Retry-After header support (requires creation of a `@workglow/job-queue` instance)
- Progress tracking for large downloads
- Request timeout handling
- Queue-based rate limiting (requires creation of a `@workglow/job-queue` instance)
- Comprehensive error handling

### DebugLogTask

Provides console logging functionality with multiple log levels for debugging task graphs.

**Input Schema:**

- `console` (any, optional): The message/data to log
- `log_level` (string, optional): Log level ("dir", "log", "debug", "info", "warn", "error"). Default: "log"

**Output Schema:**

- `console` (any): The logged message (passed through)

**Examples:**

```typescript
// Basic logging
await new DebugLogTask({
  console: "Processing user data",
  log_level: "info",
}).run();

// Object inspection with dir
await new DebugLogTask({
  console: { user: { id: 1, name: "John" }, status: "active" },
  log_level: "dir",
}).run();

// In workflow with data flow
const workflow = new Workflow()
  .fetch({ url: "https://api.example.com/data" })
  .debugLog({ log_level: "dir" }) // Logs the fetched data
  .delay({ delay: 1000 });
```

**Features:**

- Multiple log levels for different debugging needs
- Deep object inspection with `dir` level
- Pass-through functionality preserves data flow
- Non-cacheable for real-time debugging

### DelayTask

Introduces timed delays in workflows with progress tracking and cancellation support.

**Input Schema:**

- `delay` (number, optional): Delay duration in milliseconds. Default: 1
- `pass_through` (any, optional): Data to pass through to the output

**Output Schema:**

- Returns the `pass_through` data unchanged

**Examples:**

```typescript
// Simple delay
await Delay({ delay: 5000 }); // 5 second delay

// Delay with data pass-through
const result = await new DelayTask({
  delay: 3000,
  pass_through: { message: "Data preserved through delay" },
}).run();
console.log(result); // { message: "Data preserved through delay" }

// In workflow
const workflow = new Workflow()
  .fetch({ url: "https://api.example.com/data" })
  .delay({ delay: 2000 }) // 2 second delay
  .debugLog({ log_level: "info" });
```

**Features:**

- Progress tracking for delays over 100ms
- Cancellation support via AbortSignal
- Chunked delay execution for responsiveness
- Data pass-through capability

### JavaScriptTask

Executes JavaScript code strings using a safe interpreter with input/output handling.

**Input Schema:**

- `code` (string, required): JavaScript code to execute
- `input` (any, optional): Input data available to the code

**Output Schema:**

- `output` (any): The result of the JavaScript execution

**Examples:**

```typescript
// Simple calculation
const result = await JavaScript({
  code: "2 + 3 * 4",
});
console.log(result.output); // 14

// Using input data
const processed = await new JavaScriptTask({
  code: `
    const numbers = input.values;
    const sum = numbers.reduce((a, b) => a + b, 0);
    const average = sum / numbers.length;
    return { sum, average, count: numbers.length };
  `,
  input: { values: [1, 2, 3, 4, 5] },
}).run();
console.log(processed.output); // { sum: 15, average: 3, count: 5 }

// In workflow
const workflow = new Workflow()
  .fetch({ url: "https://api.example.com/data" })
  .javaScript({
    code: `
      const data = input.json;
      return data.filter(item => item.active === true);
    `,
  })
  .debugLog({ log_level: "info" });
```

**Features:**

- Safe JavaScript execution using interpreter
- Access to input data within code
- Error handling and logging
- Suitable for data transformation and filtering

### LambdaTask

Executes custom JavaScript functions with full access to task context and configuration.

**Input Schema:**

- Accepts any input data (flexible schema)

**Output Schema:**

- Returns whatever the provided function outputs

**Configuration:**

- `execute`: Function for standard execution
- `executeReactive`: Function for reactive execution with output parameter

**Examples:**

```typescript
// Function with execute pattern
const result = await Lambda(
  { numbers: [1, 2, 3, 4, 5] },
  {
    execute: async (input, context) => {
      const sum = input.numbers.reduce((a, b) => a + b, 0);
      await context.updateProgress(50, "Calculating sum");
      const average = sum / input.numbers.length;
      await context.updateProgress(100, "Complete");
      return { sum, average };
    },
  }
);

// Reactive pattern with output parameter
const reactiveResult = await new LambdaTask(
  { message: "Hello" },
  {
    executeReactive: async (input, output, context) => {
      output.processed = input.message.toUpperCase();
      output.timestamp = new Date().toISOString();
      return output;
    },
  }
).run();

// Data transformation function
const transformer = await new LambdaTask(
  {
    data: [
      { name: "John", age: 30 },
      { name: "Jane", age: 25 },
    ],
  },
  {
    execute: async (input) => {
      return {
        users: input.data.map((user) => ({
          ...user,
          isAdult: user.age >= 18,
          category: user.age < 30 ? "young" : "mature",
        })),
      };
    },
  }
).run();

// Async operation with external API
const apiProcessor = await new LambdaTask(
  { userId: 123 },
  {
    execute: async (input, context) => {
      await context.updateProgress(25, "Fetching user data");
      const userData = await fetch(`/api/users/${input.userId}`).then((r) => r.json());

      await context.updateProgress(75, "Processing data");
      const enrichedData = {
        ...userData,
        processedAt: new Date().toISOString(),
        isActive: userData.lastLogin > Date.now() - 86400000, // 24 hours
      };

      await context.updateProgress(100, "Complete");
      return enrichedData;
    },
  }
).run();
```

**Features:**

- Full access to execution context and progress tracking
- Support for both standard and reactive execution patterns
- Async/await support
- Flexible input/output schemas
- Cacheable by default

### JsonTask

Creates and executes task graphs from JSON configurations, enabling dynamic workflow creation.

**Input Schema:**

- `json` (string, required): JSON string defining tasks and their dependencies

**Output Schema:**

- `output` (any): Output depends on the generated task graph

**JSON Format:**

```typescript
interface JsonTaskItem {
  id: string; // Unique task identifier
  type: string; // Task type (e.g., "FetchUrlTask", "DelayTask")
  input?: any; // Task input data
  config?: any; // Task configuration
  dependencies?: {
    // Input dependencies from other tasks
    [inputField: string]:
      | {
          id: string; // Source task ID
          output: string; // Output field from source task
        }
      | Array<{ id: string; output: string }>;
  };
}
```

**Examples:**

```typescript
// Simple linear workflow
const linearWorkflow = await new JsonTask({
  json: JSON.stringify([
    {
      id: "fetch-data",
      type: "FetchUrlTask",
      input: {
        url: "https://api.example.com/users",
        response_type: "json",
      },
    },
    {
      id: "log-data",
      type: "DebugLogTask",
      input: {
        log_level: "info",
      },
      dependencies: {
        console: { id: "fetch-data", output: "json" },
      },
    },
    {
      id: "delay",
      type: "DelayTask",
      input: { delay: 1000 },
    },
  ]),
}).run();

// Complex workflow with data dependencies
const complexWorkflow = await new JsonTask({
  json: JSON.stringify([
    {
      id: "fetch-users",
      type: "FetchUrlTask",
      input: {
        url: "https://api.example.com/users",
        response_type: "json",
      },
    },
    {
      id: "fetch-posts",
      type: "FetchUrlTask",
      input: {
        url: "https://api.example.com/posts",
        response_type: "json",
      },
    },
    {
      id: "combine-data",
      type: "JavaScriptTask",
      input: {
        code: `
          const users = input.users;
          const posts = input.posts;
          return users.map(user => ({
            ...user,
            posts: posts.filter(post => post.userId === user.id)
          }));
        `,
      },
      dependencies: {
        input: [
          { id: "fetch-users", output: "json" },
          { id: "fetch-posts", output: "json" },
        ],
      },
    },
    {
      id: "log-result",
      type: "DebugLogTask",
      input: { log_level: "dir" },
      dependencies: {
        console: { id: "combine-data", output: "output" },
      },
    },
  ]),
}).run();

// Dynamic task creation from external config
const configResponse = await fetch("/api/workflow-config");
const workflowConfig = await configResponse.json();

const dynamicWorkflow = await new JsonTask({
  json: JSON.stringify(workflowConfig.tasks),
}).run();
```

**Features:**

- Dynamic task graph creation from JSON
- Support for complex dependency relationships
- All registered task types are available
- Automatic data flow between tasks
- Enables configuration-driven workflows

### ArrayTask

A compound task that processes arrays by either executing directly for non-array inputs or creating parallel task instances for array inputs. Supports parallel processing of array elements and combination generation when multiple inputs are arrays.

**Key Features:**

- Automatically handles single values or arrays
- Parallel execution for array inputs
- Generates all combinations when multiple inputs are arrays
- Uses `x-replicate` annotation to mark array-capable inputs

**Examples:**

```typescript
import { ArrayTask, DataPortSchema } from "@workglow/tasks";

class ArrayProcessorTask extends ArrayTask<{ items: string[] }, { results: string[] }> {
  static readonly type = "ArrayProcessorTask";

  static inputSchema() {
    return {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema() {
    return {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      required: ["results"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { items: string[] }) {
    return { results: input.items.map((item) => item.toUpperCase()) };
  }
}

// Process array items in parallel
const task = new ArrayProcessorTask({
  items: ["hello", "world", "foo", "bar"],
});

const result = await task.run();
// { results: ["HELLO", "WORLD", "FOO", "BAR"] }
```

**Features:**

- Parallel processing of array elements
- Automatic task instance creation per array element
- Combination generation for multiple array inputs
- Seamless single-value and array handling

### Browser Automation Tasks

Browser automation tasks are available in Node.js and Bun runtimes (not browser runtime exports). They use Playwright with a serializable context contract:

- Input includes optional `context` and optional `session_id`
- Output always includes `context`
- Session metadata is carried in `context.__browser = { session_id, url?, title? }`
- Raw Playwright objects are never passed through dataflow ports

Install Playwright when using browser tasks:

```bash
bun add playwright
# or
npm i playwright
```

**Available tasks:**

- `BrowserNavigateTask` / `workflow.browserNavigate(...)`
- `BrowserExtractTask` / `workflow.browserExtract(...)`
- `BrowserClickTask` / `workflow.browserClick(...)`
- `BrowserWaitTask` / `workflow.browserWait(...)`
- `BrowserEvaluateTask` / `workflow.browserEvaluate(...)`
- `BrowserTransformTask` / `workflow.browserTransform(...)`
- `BrowserCloseTask` / `workflow.browserClose(...)`

**Example chain using the required browser nodes:**

```typescript
import { Workflow } from "@workglow/task-graph";
import "@workglow/tasks"; // ensures browser workflow helpers are registered in Node/Bun entrypoint

const output = await new Workflow()
  .browserNavigate({ url: "https://example.com" })
  .browserExtract({ selector: "h1", kind: "text" })
  .browserClick({ selector: "a.next" })
  .browserWait({ mode: "load_state", load_state: "networkidle" })
  .browserEvaluate({
    args: { multiplier: 2 },
    evaluate_code: "return document.title.length * args.multiplier;",
  })
  .rename("result", "data")
  .browserTransform({
    transform_code: "return { context, data: { titleScore: data } };",
  })
  .browserClose()
  .run();

console.log(output);
```

`browserClose()` provides explicit teardown, and run-level cleanup automatically closes any leaked sessions on complete, error, abort, or disable.

Security note: `BrowserEvaluateTask` and `BrowserTransformTask` execute trusted JavaScript strings. For safer interpreted transform logic, prefer `JavaScriptTask` where appropriate.

## Workflow Integration

All tasks can be used standalone or integrated into workflows:

```typescript
import { Workflow } from "@workglow/tasks";

// Fluent workflow API
const workflow = new Workflow()
  .fetch({
    url: "https://api.example.com/data",
    response_type: "json",
  })
  .javaScript({
    code: "return input.json.filter(item => item.status === 'active');",
  })
  .debugLog({ log_level: "info" })
  .delay({ delay: 500 })
  .lambda(
    {},
    {
      execute: async (input) => ({
        processed: true,
        count: input.output.length,
        timestamp: new Date().toISOString(),
      }),
    }
  );

const result = await workflow.run();
```

## Error Handling

Tasks include comprehensive error handling:

```typescript
try {
  const result = await new FetchUrlTask({
    url: "https://api.example.com/data",
    response_type: "json",
    timeout: 5000,
  }).run();
} catch (error) {
  if (error instanceof TaskInvalidInputError) {
    console.error("Invalid input:", error.message);
  } else if (error instanceof RetryableJobError) {
    console.error("Retryable error:", error.message);
    // Will be retried automatically
  } else if (error instanceof PermanentJobError) {
    console.error("Permanent error:", error.message);
    // Will not be retried
  }
}
```

## Configuration

Tasks support various configuration options:

```typescript
// Task-specific configuration
const fetchTask = new FetchUrlTask(
  {
    url: "https://api.example.com/data",
  },
  {
    queue: "api-requests",
    timeout: 10000,
    retryAttempts: 3,
  }
);

// Global workflow configuration
const workflow = new Workflow({
  maxConcurrency: 5,
  timeout: 30000,
});
```

## Testing

```bash
bun test
```

## License

Apache 2.0 - See [LICENSE](./LICENSE) for details.
