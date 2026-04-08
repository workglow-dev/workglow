<!--
@license
Copyright 2025 Steven Roussey <sroussey@gmail.com>
SPDX-License-Identifier: Apache-2.0
-->

# The Storage Abstraction Layer: One Interface, Every Platform

*How Workglow runs the same pipeline on IndexedDB, SQLite, and Postgres without changing a line of application code.*

---

## The Problem Nobody Talks About

You have built an AI pipeline. It chunks documents, generates embeddings, stores them in a vector database, and retrieves them with semantic search. It works beautifully on your laptop with SQLite.

Then someone asks: "Can we run this in the browser?"

And someone else asks: "What about production on Postgres?"

And suddenly you are not writing AI logic anymore. You are writing three different storage backends, juggling three sets of query syntax, and wrapping everything in platform-detection conditionals. Your clean pipeline code becomes a branching mess of `if (typeof window !== 'undefined')` checks.

This is the problem Workglow's storage abstraction layer was designed to eliminate. Not by picking one database and forcing everyone onto it, but by recognizing that **the operations you need are the same everywhere** -- it is the engines underneath that differ.

## Four Abstractions, Four Problems

Workglow does not have one storage interface. It has four, because different data access patterns demand different contracts.

### IKvStorage -- The Simple Key-Value Store

The most basic abstraction. You have a key. You have a value. You put, you get, you delete.

```typescript
interface IKvStorage<Key, Value, Combined> {
  put(key: Key, value: Value): Promise<void>;
  get(key: Key): Promise<Value | undefined>;
  delete(key: Key): Promise<void>;
  getAll(): Promise<Combined[] | undefined>;
  deleteAll(): Promise<void>;
  size(): Promise<number>;
}
```

This covers caches, configuration stores, credential vaults, and any case where you need fast lookup by a single key. The `InMemoryKvStorage` implementation is literally a wrapper around a `Map` -- because sometimes that is all you need.

### ITabularStorage -- The Schema-Driven Table

When your data has structure -- columns, types, primary keys, indexes -- you reach for tabular storage. This is the workhorse of the system:

```typescript
interface ITabularStorage<Schema, PrimaryKeyNames> {
  put(value: InsertType): Promise<Entity>;
  get(key: PrimaryKey): Promise<Entity | undefined>;
  query(criteria: SearchCriteria<Entity>, options?: QueryOptions<Entity>): Promise<Entity[] | undefined>;
  deleteSearch(criteria: DeleteSearchCriteria<Entity>): Promise<void>;
  subscribeToChanges(callback: (change: TabularChangePayload<Entity>) => void): () => void;
  setupDatabase(): Promise<void>;
}
```

Notice what is happening with those type parameters. `Schema` is a JSON Schema object. `PrimaryKeyNames` is a tuple of property names. The TypeScript compiler derives `Entity`, `PrimaryKey`, and `InsertType` automatically. You define your schema once, and the type system threads it through every method signature.

### IQueueStorage -- The Job Queue

Not a general-purpose message queue. This is purpose-built for job scheduling:

```typescript
interface IQueueStorage<Input, Output> {
  add(job: JobStorageFormat<Input, Output>): Promise<unknown>;
  next(workerId: string): Promise<JobStorageFormat<Input, Output> | undefined>;
  complete(job: JobStorageFormat<Input, Output>): Promise<void>;
  abort(id: unknown): Promise<void>;
  outputForInput(input: Input): Promise<Output | null>;
  subscribeToChanges(callback: (change: QueueChangePayload<Input, Output>) => void): () => void;
}
```

Jobs have statuses (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `ABORTING`), fingerprinted inputs for deduplication, progress tracking, and deadline scheduling. The `outputForInput` method is quietly brilliant -- it lets you check if a completed job already has the answer you need before submitting a duplicate.

### IVectorStorage -- Similarity Search

Vector storage extends tabular storage with the operations that make RAG pipelines work:

```typescript
interface IVectorStorage<Metadata, Schema> extends ITabularStorage<Schema, PrimaryKeyNames> {
  similaritySearch(query: TypedArray, options?: VectorSearchOptions<Metadata>): Promise<(Entity & { score: number })[]>;
  hybridSearch?(query: TypedArray, options: HybridSearchOptions<Metadata>): Promise<(Entity & { score: number })[]>;
  getVectorDimensions(): number;
}
```

By extending `ITabularStorage`, vector storage inherits all the CRUD operations, events, and subscription capabilities for free. The vector-specific additions are `similaritySearch` (cosine similarity by default) and optional `hybridSearch` (combining vector similarity with full-text scoring). The `InMemoryVectorStorage` computes cosine similarity in a brute-force loop. The `SqliteVectorStorage` uses sqlite-vec. The `PostgresVectorStorage` uses pgvector. Same interface, radically different performance characteristics -- but your application code does not care.

## Backend Multiplexing

Here is where the architecture pays for itself. Each interface has multiple implementations:

| Interface | InMemory | SQLite | Postgres | IndexedDB | Other |
|-----------|----------|--------|----------|-----------|-------|
| KvStorage | Yes | Yes | Yes | Yes | FsFolder, Supabase |
| TabularStorage | Yes | Yes | Yes | Yes | FsFolder, HuggingFace, Supabase, SharedInMemory |
| QueueStorage | Yes | Yes | Yes | Yes | Supabase |
| VectorStorage | Yes | Yes | Yes | Yes | -- |

**InMemory** for tests. No setup, no teardown, blazing fast. Your test suite runs in milliseconds because it never touches the filesystem.

**SQLite** for desktop apps, CLI tools, and single-user scenarios. One file, zero configuration, embedded in the process.

**Postgres** for production, multi-user, multi-process deployments. Connection pooling, real transactions, LISTEN/NOTIFY for change subscriptions.

**IndexedDB** for the browser. Async, quota-managed, works offline.

The constructor signature tells the story. Here is a SQLite tabular storage:

```typescript
const storage = new SqliteTabularStorage(
  db,            // SQLite database instance
  "documents",   // table name
  DocumentSchema,
  ["id"] as const,
  [["category"], ["created_at"]]  // indexes
);
await storage.setupDatabase();
```

Swap it for Postgres:

```typescript
const storage = new PostgresTabularStorage(
  pool,          // Postgres connection pool
  "documents",
  DocumentSchema,
  ["id"] as const,
  [["category"], ["created_at"]]
);
await storage.setupDatabase();
```

The schema, primary keys, and indexes are identical. The only difference is the first argument -- the database connection. Everything downstream that accepts an `ITabularStorage` works with either one.

## Schema-Driven Tables

Traditional ORMs make you define a schema in their DSL, then generate migrations, then hope the runtime types match. Workglow flips this: **the JSON Schema IS the table definition**.

```typescript
const DocumentSchema = {
  type: "object",
  properties: {
    id: { type: "integer", "x-auto-generated": true },
    title: { type: "string" },
    content: { type: "string" },
    category: { type: "string" },
    created_at: { type: "string" },
  },
  required: ["title", "content"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

const DocumentPrimaryKey = ["id"] as const;
```

When you call `setupDatabase()`, the implementation reads this schema and generates the appropriate DDL. SQLite gets `CREATE TABLE IF NOT EXISTS documents (id INTEGER NOT NULL, title TEXT NOT NULL, ...)`. Postgres gets `CREATE TABLE IF NOT EXISTS documents (id SERIAL NOT NULL, title TEXT NOT NULL, ...)`. InMemory just says "no-op."

The `x-auto-generated: true` annotation is where it gets interesting. Mark a primary key column with this, and the storage layer handles ID generation automatically. Integer types get autoincrement. String types get UUIDs. And the `InsertType` computed type makes the auto-generated column optional on inserts, so TypeScript enforces that you do not need to provide it:

```typescript
// The 'id' field is optional on insert because it's auto-generated
await storage.put({ title: "My Document", content: "Hello world" });
// Returns the full entity with the generated id
// => { id: 1, title: "My Document", content: "Hello world", ... }
```

Indexes are declared as arrays of column names. Single-column indexes for simple lookups, compound indexes for multi-column queries. The base class validates that index columns exist in the schema and deduplicates prefixes automatically.

## Event-Driven Storage

Every storage interface includes a full event system. When you put a value, a `put` event fires. When you delete, a `delete` event fires. This is not optional -- it is built into the base classes.

```typescript
const storage = new InMemoryTabularStorage(DocumentSchema, DocumentPrimaryKey);

storage.on("put", (entity) => {
  console.log("Document saved:", entity.title);
});

storage.on("delete", (key) => {
  console.log("Document removed:", key);
});
```

But local events are only half the story. The `subscribeToChanges` method enables **cross-process and cross-tab change detection**:

```typescript
const unsubscribe = storage.subscribeToChanges((change) => {
  switch (change.type) {
    case "INSERT":
      renderNewRow(change.new);
      break;
    case "UPDATE":
      updateRow(change.new);
      break;
    case "DELETE":
      removeRow(change.old);
      break;
  }
});

// Later: clean up
unsubscribe();
```

The mechanism varies by backend. Postgres uses `LISTEN/NOTIFY` for near-instant cross-process notifications. IndexedDB uses a `HybridSubscriptionManager` that combines `BroadcastChannel` for cross-tab messaging with backup polling for reliability. SQLite and in-memory implementations use local event forwarding.

The `HybridSubscriptionManager` deserves a closer look. It layers three notification mechanisms:

1. **Local events** for same-tab changes (instant)
2. **BroadcastChannel** for cross-tab notifications (near-instant)
3. **Backup polling** for reliability (every 5 seconds, configurable)

When a tab writes to IndexedDB, it calls `notifyLocalChange()`, which immediately polls local subscribers and broadcasts a `CHANGE` message to other tabs. Those tabs receive the broadcast and poll the database for the actual diff. The backup polling catches anything that slipped through -- a crashed tab, a missed broadcast, a race condition.

## Storage as Communication Backbone

This is where the design philosophy becomes clear. The job queue does not use IPC, WebSockets, or message passing to coordinate between workers and the main thread. It uses **storage subscriptions**.

On the server side, when a `JobQueueServer` starts up, it subscribes to changes on its queue storage:

```typescript
this.storageUnsubscribe = this.storage.subscribeToChanges(
  (change: QueueChangePayload<Input, Output>) => {
    if (
      change.type === "INSERT" ||
      (change.type === "UPDATE" && change.new?.status === JobStatus.PENDING)
    ) {
      this.notifyWorkers();
    }
  }
);
```

When a new job is inserted (or a failed job is retried and set back to `PENDING`), the storage emits a change, and the server wakes its idle workers. No polling loops burning CPU. No WebSocket connections to maintain. The database IS the message bus.

On the client side, the `JobQueueClient` subscribes to the same storage to track job progress in real time:

```typescript
this.storageUnsubscribe = this.storage.subscribeToChanges(
  (change: QueueChangePayload<Input, Output>) => {
    this.handleStorageChange(change);
  }
);
```

This pattern means the entire job queue system works identically whether the client and server are in the same process (InMemory), different processes on the same machine (SQLite with polling), different tabs in the same browser (IndexedDB with BroadcastChannel), or different servers entirely (Postgres with LISTEN/NOTIFY).

The storage backend determines the communication topology. The application logic stays the same.

## The Registry Pattern

Workglow uses a registry pattern to wire storage instances to task inputs at runtime. The `TabularStorageRegistry` maintains a global map of named storage instances:

```typescript
// Register a storage instance
registerTabularRepository("user-documents", storage);

// Retrieve it anywhere
const storage = getTabularRepository("user-documents");
```

The clever part is the **input resolver** integration. Task schemas can declare a property with `format: "storage:tabular"`, and the runtime will automatically resolve a string ID to the actual storage instance:

```typescript
registerInputResolver("storage:tabular", (id, format, registry) => {
  const repos = registry.get(TABULAR_REPOSITORIES);
  const repo = repos.get(id);
  if (!repo) throw new Error(`Tabular storage "${id}" not found in registry`);
  return repo;
});
```

There is also a **compactor** -- the reverse operation that maps a storage instance back to its string ID for serialization:

```typescript
registerInputCompactor("storage:tabular", (value, _format, registry) => {
  const repos = registry.get(TABULAR_REPOSITORIES);
  for (const [id, repo] of repos) {
    if (repo === value) return id;
  }
  return undefined;
});
```

This means tasks can reference storage by name in their configuration, the runtime resolves names to instances, and when jobs need to be serialized (for example, to send to a worker process), the compactor converts instances back to portable string IDs. The worker on the other side resolves the name again in its own service registry.

## Swap Backends Without Changing Code

Here is a concrete scenario. You are building a RAG application. During development, you want fast iteration:

```typescript
import { InMemoryVectorStorage } from "@workglow/storage";

const vectorStore = new InMemoryVectorStorage(ChunkSchema, ChunkPrimaryKey, 384);
```

For your Electron desktop app:

```typescript
import { SqliteVectorStorage } from "@workglow/storage";

const vectorStore = new SqliteVectorStorage(db, "chunks", ChunkSchema, ChunkPrimaryKey, 384);
```

For production:

```typescript
import { PostgresVectorStorage } from "@workglow/storage";

const vectorStore = new PostgresVectorStorage(pool, "chunks", ChunkSchema, ChunkPrimaryKey, 384);
```

The code that uses `vectorStore` -- the similarity searches, the upserts, the change subscriptions, the event handlers -- is identical in all three cases. Not similar. Identical.

And because each implementation is in a separate sub-export with optional peer dependencies, your browser bundle never includes SQLite bindings, and your Node server never ships IndexedDB polyfills. The conditional exports in `package.json` handle platform resolution automatically.

## The Telemetry Layer

One more pattern worth noting: every storage type has a corresponding `Telemetry*Storage` wrapper. `TelemetryTabularStorage`, `TelemetryKvStorage`, `TelemetryQueueStorage`, `TelemetryVectorStorage`. These are decorator-pattern wrappers that add OpenTelemetry tracing to every operation without modifying the underlying implementation.

Wrap any storage:

```typescript
const traced = new TelemetryTabularStorage(innerStorage);
```

Every `put`, `get`, `query`, and `delete` now emits a span. The inner storage does not know or care.

## Why This Matters

The storage abstraction layer is not the flashiest part of an AI framework. Nobody puts "unified storage interfaces" on a conference slide. But it is the foundation that makes everything else possible.

It means the task graph engine does not know or care where data lives. It means the job queue works in a browser tab and a Kubernetes pod with the same code. It means you can write your AI pipeline once and deploy it to platforms that did not exist when you started.

The four interfaces -- KV, Tabular, Queue, Vector -- map to the four fundamental data access patterns in AI applications. The multiple backends map to the real-world platforms where those applications run. And the event system turns passive data stores into active participants in the application architecture.

Write once. Store anywhere. Subscribe everywhere.
