# @workglow/util

Utility functions and helper classes for Workglow AI task pipelines.

## Overview

The `@workglow/util` package provides a comprehensive set of utility functions, helper classes, and common functionality used throughout the Workglow ecosystem. It includes utilities for cryptography, compression, graph operations, dependency injection, event handling, and more.

## Features

- **Cryptography**: Hashing, encryption, and security utilities
- **Compression**: Data compression and decompression utilities
- **Graph Operations**: Graph traversal and manipulation utilities
- **Dependency Injection**: Simple DI container for managing dependencies
- **Event System**: Event emitter and handling utilities
- **Worker Utilities**: Web worker and background task helpers
- **JSON Schema Utilities**: JSON Schema types and utilities for schema validation and type inference
- **Multi-Platform Support**: Works in browser, Node.js, and Bun environments

## Installation

```bash
npm install @workglow/util
# or
bun add @workglow/util
```

## Usage

### Cryptography Utilities

```typescript
import { hash, encrypt, decrypt, generateKey } from "@workglow/util/crypto";

// Hash data
const hashedData = await hash("my-data", "sha256");

// Generate encryption key
const key = await generateKey();

// Encrypt/decrypt data
const encrypted = await encrypt("sensitive-data", key);
const decrypted = await decrypt(encrypted, key);
```

### Compression Utilities

```typescript
import { compress, decompress } from "@workglow/util/compress";

// Compress data
const compressed = await compress("large text data...");

// Decompress data
const decompressed = await decompress(compressed);
```

### Graph Operations

```typescript
import { topologicalSort, findCycles, shortestPath, GraphNode } from "@workglow/util/graph";

// Create graph nodes
const nodes: GraphNode[] = [
  { id: "A", dependencies: [] },
  { id: "B", dependencies: ["A"] },
  { id: "C", dependencies: ["A", "B"] },
];

// Topological sort
const sorted = topologicalSort(nodes);

// Find cycles
const cycles = findCycles(nodes);

// Find shortest path
const path = shortestPath(nodes, "A", "C");
```

### Dependency Injection

```typescript
import { Container, injectable, inject } from "@workglow/util/di";

@injectable()
class DatabaseService {
  connect() {
    // Database connection logic
  }
}

@injectable()
class UserService {
  constructor(@inject("DatabaseService") private db: DatabaseService) {}

  getUsers() {
    this.db.connect();
    // User retrieval logic
  }
}

// Create container and register services
const container = new Container();
container.register("DatabaseService", DatabaseService);
container.register("UserService", UserService);

// Resolve dependencies
const userService = container.resolve<UserService>("UserService");
```

### Input Resolver Registry

The input resolver registry enables automatic resolution of string identifiers to object instances based on JSON Schema format annotations. This is used by the TaskRunner to resolve inputs like model names or repository IDs before task execution.

```typescript
import {
  registerInputResolver,
  getInputResolvers,
  INPUT_RESOLVERS,
} from "@workglow/util";

// Register a custom resolver for a format prefix
registerInputResolver("myformat", async (id, format, registry) => {
  // id: the string value to resolve (e.g., "my-item-id")
  // format: the full format string (e.g., "myformat:subtype")
  // registry: ServiceRegistry for accessing other services

  const myRepo = registry.get(MY_REPOSITORY_TOKEN);
  const item = await myRepo.findById(id);
  if (!item) {
    throw new Error(`Item "${id}" not found`);
  }
  return item;
});

// Get all registered resolvers
const resolvers = getInputResolvers();
```

When a task input schema includes a property with `format: "myformat:subtype"`, and the input value is a string, the resolver is called automatically to convert it to the resolved instance.

### Event System

```typescript
import { EventEmitter, createEventBus } from "@workglow/util/events";

// Basic event emitter
const emitter = new EventEmitter();

emitter.on("data", (data) => {
  console.log("Received:", data);
});

emitter.emit("data", { message: "Hello World" });

// Event bus for cross-component communication
const eventBus = createEventBus();

eventBus.subscribe("task:completed", (task) => {
  console.log("Task completed:", task.id);
});

eventBus.publish("task:completed", { id: "task-123" });
```

### Worker Utilities

```typescript
import { createWorkerPool, WorkerTask, WorkerPool } from "@workglow/util/worker";

// Create worker pool
const pool: WorkerPool = createWorkerPool({
  workerScript: "./worker.js",
  poolSize: 4,
  maxQueueSize: 100,
});

// Execute task in worker
const result = await pool.execute({
  type: "process-data",
  data: { input: "some data" },
});

// Clean up
await pool.terminate();
```

### JSON Schema Utilities

You can define JSON schemas using plain JSON Schema objects, or use schema libraries like TypeBox or Zod to create them.

#### Using Plain JSON Schema

```typescript
import { JsonSchema, FromSchema, DataPortSchema, compileSchema } from "@workglow/util";

// Define a JSON Schema
const userSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    age: { type: "number", minimum: 0, maximum: 150 },
  },
  required: ["id", "email"],
  additionalProperties: false,
} as const satisfies JsonSchema;

// Infer TypeScript types from schema
type User = FromSchema<typeof userSchema>;
// => { id: string; email: string; age?: number }

// Compile schema for runtime validation
const validator = compileSchema(userSchema);
const isValid = validator.validate({
  id: "123e4567-e89b-12d3-a456-426614174000",
  email: "user@example.com",
  age: 25,
});
```

#### Using TypeBox

TypeBox schemas are JSON Schema compatible and can be used directly:

```typescript
import { Type, Static } from "@sinclair/typebox";

// Define a schema using TypeBox
const userSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  email: Type.String({ format: "email" }),
  age: Type.Optional(Type.Number({ minimum: 0, maximum: 150 })),
}) satisfies DataPortSchema;

// Infer TypeScript types from schema
type User = Static<typeof userSchema>;
// => { id: string; email: string; age?: number }
```

#### Using Zod

Zod 4 has built-in JSON Schema support using the `.toJSONSchema()` method:

```typescript
import { z } from "zod";

// Define a schema using Zod
const userSchemaZod = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  age: z.number().min(0).max(150).optional(),
});

// Convert Zod schema to JSON Schema using built-in method
const userSchema = userSchemaZod.toJSONSchema() as DataPortSchema;

// Infer TypeScript types from schema using Zod's built-in type inference
type User = z.infer<typeof userSchemaZod>;
// => { id: string; email: string; age?: number }
```

## Utility Categories

### Cryptography (`/crypto`)

- Hashing functions (SHA-256, SHA-512, etc.)
- Symmetric and asymmetric encryption
- Key generation and management
- Digital signatures
- Secure random number generation

### Compression (`/compress`)

- GZIP compression/decompression
- Brotli compression/decompression
- Custom compression algorithms
- Stream-based compression

### Graph Operations (`/graph`)

- Topological sorting
- Cycle detection
- Shortest path algorithms
- Graph traversal (DFS, BFS)
- Strongly connected components

### Dependency Injection (`/di`)

- Lightweight DI container
- Decorator-based injection
- Singleton and transient lifetimes
- Circular dependency detection
- Input resolver registry for schema-based resolution

### Event System (`/events`)

- Type-safe event emitter
- Event bus for decoupled communication
- Event filtering and transformation
- Async event handling

### Worker Utilities (`/worker`)

- Worker pool management
- Task queuing and distribution
- Worker lifecycle management
- Error handling and recovery

### JSON Schema Utilities (`/json-schema`)

- `JsonSchema` - Extended JSON Schema type with custom extensions
- `FromSchema` - Infer TypeScript types from JSON schemas
- `DataPortSchema` - Schema type for task input/output ports
- `compileSchema` - Runtime schema validation using json-schema-library
- Schema compatibility utilities for task graph dataflows

### General Utilities (`/utilities`)

- Debounce and throttle functions
- Deep object merging
- Array and object utilities
- String manipulation helpers
- Date and time utilities

## Environment-Specific Features

### Browser

- Web Worker support
- IndexedDB utilities
- Blob and File handling
- WebCrypto API integration

### Node.js

- File system utilities
- Process management
- Native crypto support
- Stream processing

### Bun

- Optimized for Bun runtime
- Fast startup and execution
- Built-in APIs integration

## License

Apache 2.0 - See [LICENSE](./LICENSE) for details.
