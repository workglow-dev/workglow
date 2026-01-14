# Key-Value Storage Module

A flexible key-value storage solution with multiple backend implementations. Provides a consistent interface for CRUD operations with event monitoring capabilities.

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
  - [File System Storage](#file-system-storage)
  - [Browser IndexedDB Storage](#browser-indexeddb-storage)
  - [PostgreSQL Storage](#postgresql-storage)
  - [SQLite Storage](#sqlite-storage)
  - [In-Memory Storage](#in-memory-storage)
- [API Documentation](#api-documentation)
  - [Core Methods](#core-methods)
  - [Events](#events)
- [Testing](#testing)
- [License](#license)

## Features

- Multiple storage backends:
  - 🗂️ `FsFolderKvRepository` - File system storage
  - 💾 `IndexedDbKvRepository` - Browser IndexedDB storage
  - 🐘 `PostgresKvRepository` - PostgreSQL database storage
  - 📁 `SqliteKvRepository` - SQLite database storage
  - 🧠 `InMemoryKvStorage` - Volatile memory storage
- Type-safe key/value definitions
- JSON value serialization support
- Event emitter for storage operations (put/get/delete)
- Cross-platform compatibility (Node.js and browser)

## Installation

```bash
bun install @workglow/storage
```

## Usage

### File System Storage

```typescript
import { FsFolderKvRepository } from "@workglow/storage/kv";

const fsRepo = new FsFolderKvRepository(
  "./data-storage", // Storage directory
  "string", // Key type (string)
  "json" // Value type (JSON serialized)
);

await fsRepo.put("config", { theme: "dark", notifications: true });
const config = await fsRepo.get("config");
```

### Browser IndexedDB Storage

```typescript
import { IndexedDbKvRepository } from "@workglow/storage/kv";

const idbRepo = new IndexedDbKvRepository(
  "my-app-db", // Database name
  "string", // Key type
  "json" // Value type
);

// Works in browser environments
await idbRepo.put("session", { userId: 123, token: "abc" });
```

### PostgreSQL Storage

```typescript
import { PostgresKvRepository } from "@workglow/storage/kv";
import { PGlite } from "@electric-sql/pglite";

const pg = new PGlite(); // Requires @electric-sql/pglite
const pgRepo = new PostgresKvRepository(
  pg, // PostgreSQL connection
  "user_data", // Table name
  "string", // Key type
  "json" // Value type
);

await pgRepo.put("preferences:456", { lang: "en", fontSize: 16 });
```

### SQLite Storage

```typescript
import { SqliteKvRepository } from "@workglow/storage/kv";
import { Sqlite } from "@workglow/sqlite";

const db = new Sqlite(":memory:"); // In-memory database
const sqliteRepo = new SqliteKvRepository(
  db, // SQLite connection
  "cache_data", // Table name
  "string", // Key type
  "string" // Value type (raw strings)
);

await sqliteRepo.put("temp:789", "cached_value");
```

### In-Memory Storage

```typescript
import { InMemoryKvStorage } from "@workglow/storage/kv";

const memRepo = new InMemoryKvStorage(
  "string", // Key type
  "json" // Value type
);

// Volatile storage - data lost on process exit
await memRepo.put("counter", { value: 42 });
```

## API Documentation

### Core Methods

- `put(key: Key, value: Value): Promise<void>`
- `get(key: Key): Promise<Value | undefined>`
- `delete(key: Key): Promise<void>`
- `getAll(): Promise<Combined[] | undefined>`
- `deleteAll(): Promise<void>`
- `size(): Promise<number>`

### Events

```typescript
repo.on("put", (key, value) => {
  console.log(`Stored ${key}:`, value);
});

repo.on("delete", (key) => {
  console.log(`Deleted ${key}`);
});
```

## Testing

Run all tests:

```bash
bun test
```

Run specific implementation tests:

```bash
bun test FsFolderKvRepository
bun test IndexedDbKvRepository
bun test PostgresKvRepository
```

## License

Apache 2.0 - See LICENSE for details
