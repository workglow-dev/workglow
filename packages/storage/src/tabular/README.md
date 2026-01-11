# Tabular Repository Implementations

A collection of storage implementations for tabular data with multiple backend support. Provides consistent CRUD operations, search capabilities, and event monitoring across different storage technologies.

- [Features](#features)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Schema Definitions](#schema-definitions)
  - [Using TypeBox](#using-typebox)
  - [Using Zod 4](#using-zod-4)
- [Implementations](#implementations)
  - [InMemoryTabularRepository](#inmemorytabularrepository)
  - [SqliteTabularRepository](#sqlitetabularrepository)
  - [PostgresTabularRepository](#postgrestabularrepository)
  - [IndexedDbTabularRepository](#indexeddbtabularrepository)
  - [FsFolderTabularRepository](#fsfoldertabularrepository)
- [Events](#events)
- [Testing](#testing)
- [License](#license)

## Features

- Multiple storage backends:
  - In-memory (for testing/caching)
  - SQLite (embedded database)
  - PostgreSQL (relational database)
  - IndexedDB (browser storage)
  - Filesystem (JSON file per record)
- Type-safe schema definitions
- Compound primary keys support
- Indexing for efficient search
- Event-driven architecture
- Cross-implementation test suite

## Installation

```bash
bun add @workglow/storage
# or
npm install @workglow/storage
```

## Basic Usage

```typescript
import { InMemoryTabularRepository } from "@workglow/storage/tabular";

// Define schema and primary keys
const schema = {
  id: "string",
  name: "string",
  age: "number",
  active: "boolean",
} as const;

const primaryKeys = ["id"] as const;
// Create repository instance (when using const schemas, the next three generics
// on InMemoryTabularRepository are automatically created for you)
const repo = new InMemoryTabularRepository<typeof schema, typeof primaryKeys>(schema, primaryKeys);

// Basic operations
await repo.put({ id: "1", name: "Alice", age: 30, active: true });
const result = await repo.get({ id: "1" });
await repo.delete({ id: "1" });
```

## Schema Definitions

You can define schemas using plain JSON Schema objects, or use schema libraries like TypeBox or Zod 4 to create them. All schemas must be compatible with `DataPortSchemaObject` from `@workglow/util`.

**Note:** When using TypeBox or Zod schemas, you **must** explicitly provide the generic type parameters to the repository constructor, as TypeScript cannot infer them from non-const schema definitions.

### Using TypeBox

TypeBox schemas are JSON Schema compatible and can be used directly:

```typescript
import { InMemoryTabularRepository } from "@workglow/storage/tabular";
import { Type, Static } from "@sinclair/typebox";
import { DataPortSchemaObject, FromSchema } from "@workglow/util";

// Define schema using TypeBox
const userSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  email: Type.String({ format: "email" }),
  age: Type.Optional(Type.Number({ minimum: 0, maximum: 150 })),
  active: Type.Boolean({ default: true }),
}) satisfies DataPortSchemaObject;

// Infer TypeScript types from schema
type User = FromSchema<typeof userSchema>;
// => { id: string; name: string; email: string; age?: number; active: boolean }

const primaryKeys = ["id"] as const;

type UserEntity = FromSchema<typeof userSchema>;

// IMPORTANT: You must explicitly provide generic type parameters for t
// TypeScript cannot infer them from TypeBox schemas
const repo = new InMemoryTabularRepository<typeof userSchema, typeof primaryKeys, UserEntity>(
  userSchema,
  primaryKeys,
  ["email", "active"] as const // Indexes
);

// Use with type safety
await repo.put({
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Alice",
  email: "alice@example.com",
  age: 30,
  active: true,
});
```

### Using Zod 4

Zod 4 has built-in JSON Schema support using the `.toJSONSchema()` method:

```typescript
import { InMemoryTabularRepository } from "@workglow/storage/tabular";
import { z } from "zod";
import { DataPortSchemaObject } from "@workglow/util";

// Define schema using Zod
const userSchemaZod = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().min(0).max(150).optional(),
  active: z.boolean().default(true),
});

// Convert Zod schema to JSON Schema using built-in method
const userSchema = userSchemaZod.toJSONSchema() as DataPortSchemaObject;
const primaryKeys = ["id"] as const;

// Define computed types for the repository generics
type UserEntity = z.infer<typeof userSchemaZod>;

// IMPORTANT: You must explicitly provide generic type parameters
// TypeScript cannot infer them from Zod schemas (even after conversion)
const repo = new InMemoryTabularRepository<typeof userSchema, typeof primaryKeys, UserEntity>(
  userSchema,
  primaryKeys,
  ["email", "active"] as const // Indexes
);

// Use with type safety
await repo.put({
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Alice",
  email: "alice@example.com",
  age: 30,
  active: true,
});
```

## Implementations

### InMemoryTabularRepository

- Ideal for testing/development
- No persistence
- Fast search capabilities

```typescript
const repo = new InMemoryTabularRepository<
  typeof schema,
  typeof primaryKeys,
  Entity, // required if using TypeBox, Zod, etc, otherwise automatically created
  PrimaryKeyEntity, // should be automatically created
  ValueEntity // should be automatically created
>(schema, primaryKeys, ["name", "active"]);
```

### SqliteTabularRepository

- Embedded SQLite database
- File-based or in-memory

```typescript
const repo = new SqliteTabularRepository<
  typeof schema,
  typeof primaryKeys,
  Entity, // required if using TypeBox, Zod, etc, otherwise automatically created
  PrimaryKeyEntity, // should be automatically created
  ValueEntity // should be automatically created
>(
  ":memory:", // Database path
  "users", // Table name
  schema,
  primaryKeys,
  [["name", "active"], "age"] as const // Indexes
);
```

### PostgresTabularRepository

- PostgreSQL backend
- Connection pooling support

```typescript
import { Pool } from "pg";

const pool = new Pool({
  /* config */
});
const repo = new PostgresTabularRepository<
  typeof schema,
  typeof primaryKeys,
  Entity, // required if using TypeBox, Zod, etc, otherwise automatically created
  PrimaryKeyEntity, // should be automatically created
  ValueEntity // should be automatically created
>(
  pool, // postgres connection pool
  "users",
  schema,
  primaryKeys,
  [["name", "active"], "age"] as const
);
```

### IndexedDbTabularRepository

- Browser-based storage
- Automatic schema migration

```typescript
const repo = new IndexedDbTabularRepository<
  typeof schema,
  typeof primaryKeys,
  Entity, // required if using TypeBox, Zod, etc, otherwise automatically created
  PrimaryKeyEntity, // should be automatically created
  ValueEntity // should be automatically created
>(
  "user_db", // Database name
  schema,
  primaryKeys,
  [["name", "active"], "age"] as const
);
```

### FsFolderTabularRepository

- Filesystem storage (one JSON file per record)
- Simple persistence format

```typescript
const repo = new FsFolderTabularRepository<
  typeof schema,
  typeof primaryKeys,
  Entity, // required if using TypeBox, Zod, etc, otherwise automatically created
  PrimaryKeyEntity, // should be automatically created
  ValueEntity // should be automatically created
>("./data/users", schema, primaryKeys);
```

## Events

All implementations emit events:

- `put`: When a record is created/updated
- `get`: When a record is retrieved
- `delete`: When a record is deleted
- `clearall`: When all records are deleted
- `search`: When a search is performed

```typescript
repo.on("put", (entity) => {
  console.log("Record stored:", entity);
});

repo.on("delete", (key) => {
  console.log("Record deleted:", key);
});
```

## Testing

The implementations share a common test suite. To run tests:

```bash
bun test
```

Test includes:

- Basic CRUD operations
- Compound key handling
- Index-based search
- Event emission
- Concurrency tests

## License

Apache 2.0
