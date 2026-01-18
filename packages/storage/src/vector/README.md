# Vector Storage Module

General-purpose vector storage with similarity search capabilities. Schema-driven approach that automatically detects vector and metadata columns. Extends the tabular storage pattern to add vector search functionality.

## Features

- **Multiple Storage Backends:**
  - 🧠 `InMemoryVectorStorage` - Fast in-memory storage for testing and small datasets
  - 📁 `SqliteVectorStorage` - Persistent SQLite storage for local applications
  - 🐘 `PostgresVectorStorage` - PostgreSQL with pgvector extension for production

- **Quantized Vector Support:**
  - Float32Array (standard 32-bit floating point)
  - Float16Array (16-bit floating point)
  - Float64Array (64-bit high precision)
  - Int8Array (8-bit signed - binary quantization)
  - Uint8Array (8-bit unsigned - quantization)
  - Int16Array (16-bit signed - quantization)
  - Uint16Array (16-bit unsigned - quantization)

- **Search Capabilities:**
  - Vector similarity search (cosine similarity)
  - Hybrid search (vector + full-text keyword matching)
  - Metadata filtering
  - Top-K retrieval with score thresholds

- **Built on Tabular Repositories:**
  - Extends `ITabularStorage` for standard CRUD operations
  - Inherits event emitter pattern for monitoring
  - Type-safe schema-based storage

## Installation

```bash
bun install @workglow/storage
```

## Usage

### In-Memory Storage (Testing/Development)

```typescript
import { InMemoryVectorStorage } from "@workglow/storage";
import { TypedArraySchema } from "@workglow/util";

// Define your schema with a vector column
const MyVectorSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    embedding: TypedArraySchema(), // Vector column (automatically detected)
    metadata: { type: "object", format: "metadata", additionalProperties: true },
  },
  additionalProperties: false,
} as const;

// Create repository with schema
const repo = new InMemoryVectorStorage(
  MyVectorSchema,
  ["id"], // Primary key
  [], // Indexes (optional)
  384 // Vector dimensions
);
await repo.setupDatabase();

// Store entities with embeddings
await repo.put({
  id: "item-001",
  embedding: new Float32Array([0.1, 0.2, 0.3 /* ... 384 dims */]),
  metadata: { text: "Hello world", source: "example.txt" },
});

// Search for similar vectors
const results = await repo.similaritySearch(new Float32Array([0.15, 0.25, 0.35 /* ... */]), {
  topK: 5,
  scoreThreshold: 0.7,
});
```

### Quantized Vectors (Reduced Storage)

```typescript
import { InMemoryVectorStorage } from "@workglow/storage";
import { TypedArraySchema } from "@workglow/util";

const QuantizedSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    embedding: TypedArraySchema(),
    tags: { type: "object", format: "metadata", additionalProperties: true },
  },
  additionalProperties: false,
} as const;

// Use Int8Array for 4x smaller storage (binary quantization)
const repo = new InMemoryVectorStorage(
  QuantizedSchema,
  ["id"],
  [],
  384,
  Int8Array // Specify vector type
);
await repo.setupDatabase();

// Store quantized vectors
await repo.put({
  id: "item-001",
  embedding: new Int8Array([127, -128, 64 /* ... */]),
  tags: { category: "ai" },
});

// Search with quantized query
const results = await repo.similaritySearch(new Int8Array([100, -50, 75 /* ... */]), { topK: 5 });
```

### SQLite Storage (Local Persistence)

```typescript
import { SqliteVectorStorage } from "@workglow/storage";
import { TypedArraySchema } from "@workglow/util";

const MySchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    vector: TypedArraySchema(),
    data: { type: "object", format: "metadata", additionalProperties: true },
  },
  additionalProperties: false,
} as const;

const repo = new SqliteVectorStorage(
  "./vectors.db",  // database path
  "vectors",       // table name
  MySchema,
  ["id"],
  [],
  768              // vector dimension
);
await repo.setupDatabase();

// Bulk insert using inherited tabular methods
await repo.putMany([
  { id: "1", vector: new Float32Array([...]), data: { text: "..." } },
  { id: "2", vector: new Float32Array([...]), data: { text: "..." } },
]);
```

### PostgreSQL with pgvector

```typescript
import { Pool } from "pg";
import { PostgresVectorStorage } from "@workglow/storage";
import { TypedArraySchema } from "@workglow/util";

const MySchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    vector: TypedArraySchema(),
    info: { type: "object", format: "metadata", additionalProperties: true },
  },
  additionalProperties: false,
} as const;

const pool = new Pool({ connectionString: "postgresql://..." });
const repo = new PostgresVectorStorage(
  pool,
  "vectors",
  MySchema,
  ["id"],
  [],
  384 // vector dimension
);
await repo.setupDatabase();

// Native pgvector similarity search with filter
const results = await repo.similaritySearch(queryVector, {
  topK: 10,
  filter: { category: "ai" },
  scoreThreshold: 0.5,
});

// Hybrid search (vector + full-text)
const hybridResults = await repo.hybridSearch(queryVector, {
  textQuery: "machine learning",
  topK: 10,
  vectorWeight: 0.7,
  filter: { category: "ai" },
});
```

## Schema-Driven Design

The vector storage automatically detects which column contains the vector by looking for properties with `format: "TypedArray"` in your schema:

```typescript
import { TypedArraySchema } from "@workglow/util";

// Vector column is automatically detected by the storage implementation
const MySchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    embedding: TypedArraySchema(), // ← Detected as vector column
    metadata: {
      type: "object",
      format: "metadata", // ← Detected as metadata column (optional)
      additionalProperties: true,
    },
    created_at: { type: "string" },
  },
  additionalProperties: false,
} as const;
```

**Key Points:**

- **Vector Column**: Any property with `type: "array"` and `format: "TypedArray"` (or `format: "TypedArray:*"`)
- **Metadata Column**: Any property with `type: "object"` and `format: "metadata"` (optional, used for filtering)
- **Flexible Schema**: Add any additional properties you need - the storage will work with your schema

## API Reference

### IChunkVectorStorage Interface

Extends `ITabularStorage` with vector-specific methods:

```typescript
interface IChunkVectorStorage<Schema, PrimaryKeyNames, Entity> extends ITabularStorage<
  Schema,
  PrimaryKeyNames,
  Entity
> {
  // Get the vector dimension
  getVectorDimensions(): number;

  // Vector similarity search
  similaritySearch(
    query: TypedArray,
    options?: VectorSearchOptions
  ): Promise<(Entity & { score: number })[]>;

  // Hybrid search (optional - not all implementations support it)
  hybridSearch?(
    query: TypedArray,
    options: HybridSearchOptions
  ): Promise<(Entity & { score: number })[]>;
}
```

### Inherited Tabular Methods

From `ITabularStorage`:

```typescript
// Setup
setupDatabase(): Promise<void>;

// CRUD Operations
put(entity: Entity): Promise<void>;
putMany(entities: Entity[]): Promise<void>;
get(key: PrimaryKey): Promise<Entity | undefined>;
getAll(): Promise<Entity[] | undefined>;
delete(key: PrimaryKey): Promise<void>;
deleteMany(keys: PrimaryKey[]): Promise<void>;

// Utility
size(): Promise<number>;
clear(): Promise<void>;
destroy(): void;
```

### Search Options

```typescript
interface VectorSearchOptions<Metadata = Record<string, unknown>> {
  readonly topK?: number; // Number of results (default: 10)
  readonly filter?: Partial<Metadata>; // Filter by metadata fields
  readonly scoreThreshold?: number; // Minimum score 0-1 (default: 0)
}

interface HybridSearchOptions<Metadata> extends VectorSearchOptions<Metadata> {
  readonly textQuery: string; // Full-text query keywords
  readonly vectorWeight?: number; // Vector weight 0-1 (default: 0.7)
}
```

## Global Registry

Register and retrieve chunk vector repositories globally:

```typescript
import { getChunkVectorRepository, getGlobalChunkVectorRepositories } from "@workglow/storage";
import { registerChunkVectorRepository, getGlobalChunkVectorRepositories } from "@workglow/dataset";

// Register a repository
registerChunkVectorRepository("my-chunks", repo);

// Retrieve by ID
const repo = getChunkVectorRepository("my-chunks");

// Get all registered repositories
const allRepos = getGlobalChunkVectorRepositories();
```

## Quantization Benefits

Quantized vectors reduce storage and can improve performance:

| Vector Type  | Bytes/Dim | Storage vs Float32 | Use Case                             |
| ------------ | --------- | ------------------ | ------------------------------------ |
| Float32Array | 4         | 100% (baseline)    | Standard embeddings                  |
| Float64Array | 8         | 200%               | High precision needed                |
| Float16Array | 2         | 50%                | Great precision/size tradeoff        |
| Int16Array   | 2         | 50%                | Good precision/size tradeoff         |
| Int8Array    | 1         | 25%                | Binary quantization, max compression |
| Uint8Array   | 1         | 25%                | Quantized embeddings [0-255]         |

**Example:** A 768-dimensional embedding:

- Float32: 3,072 bytes
- Int8: 768 bytes (75% reduction!)

## Performance Considerations

### InMemory

- **Best for:** Testing, small datasets (<10K vectors), development
- **Pros:** Fastest, no dependencies, supports all vector types
- **Cons:** No persistence, memory limited

### SQLite

- **Best for:** Local apps, medium datasets (<100K vectors)
- **Pros:** Persistent, single file, no server
- **Cons:** No native vector indexing (linear scan), slower for large datasets

### PostgreSQL + pgvector

- **Best for:** Production, large datasets (>100K vectors)
- **Pros:** Native HNSW/IVFFlat indexing, efficient similarity search, scalable
- **Cons:** Requires PostgreSQL server and pgvector extension
- **Setup:** `CREATE EXTENSION vector;`

## Integration with DocumentDataset

The chunk vector repository works alongside `DocumentDataset` for hierarchical document storage:

```typescript
import {
  DocumentDataset,
  InMemoryChunkVectorStorage,
  InMemoryTabularStorage,
} from "@workglow/storage";
import { DocumentStorageSchema } from "@workglow/storage";

// Initialize storage backends
const tabularStorage = new InMemoryTabularStorage(DocumentStorageSchema, ["doc_id"]);
await tabularStorage.setupDatabase();

const vectorStorage = new InMemoryChunkVectorStorage(384);
await vectorStorage.setupDatabase();

// Create document dataset with both storages
const docDataset = new DocumentDataset(tabularStorage, vectorStorage);

// Store document structure in tabular, chunks in vector
await docDataset.upsert(document);

// Search chunks by vector similarity
const results = await docDataset.search(queryVector, { topK: 5 });
```

### Chunk Metadata for Hierarchical Documents

When using hierarchical chunking, chunk metadata typically includes:

```typescript
metadata: {
  text: string;           // Chunk text content
  leafNodeId?: string;    // Reference to document tree node
  depth?: number;         // Hierarchy depth
  nodePath?: string[];    // Node IDs from root to leaf
  summary?: string;       // Summary of the chunk content
  entities?: Entity[];    // Named entities extracted from the chunk
}
```

## License

Apache 2.0
