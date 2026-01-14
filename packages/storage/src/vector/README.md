# Chunk Vector Storage Module

Storage for document chunk embeddings with vector similarity search capabilities. Extends the tabular repository pattern to add vector search functionality for RAG (Retrieval-Augmented Generation) pipelines.

## Features

- **Multiple Storage Backends:**
  - 🧠 `InMemoryChunkVectorStorage` - Fast in-memory storage for testing and small datasets
  - 📁 `SqliteChunkVectorStorage` - Persistent SQLite storage for local applications
  - 🐘 `PostgresChunkVectorStorage` - PostgreSQL with pgvector extension for production

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

### In-Memory Repository (Testing/Development)

```typescript
import { InMemoryChunkVectorStorage } from "@workglow/storage";

// Create repository with 384 dimensions
const repo = new InMemoryChunkVectorStorage(384);
await repo.setupDatabase();

// Store a chunk with its embedding
await repo.put({
  chunk_id: "chunk-001",
  doc_id: "doc-001",
  vector: new Float32Array([0.1, 0.2, 0.3 /* ... 384 dims */]),
  metadata: { text: "Hello world", source: "example.txt" },
});

// Search for similar chunks
const results = await repo.similaritySearch(new Float32Array([0.15, 0.25, 0.35 /* ... */]), {
  topK: 5,
  scoreThreshold: 0.7,
});
```

### Quantized Vectors (Reduced Storage)

```typescript
import { InMemoryChunkVectorStorage } from "@workglow/storage";

// Use Int8Array for 4x smaller storage (binary quantization)
const repo = new InMemoryChunkVectorStorage<{ text: string }, Int8Array>(384, Int8Array);
await repo.setupDatabase();

// Store quantized vectors
await repo.put({
  chunk_id: "chunk-001",
  doc_id: "doc-001",
  vector: new Int8Array([127, -128, 64 /* ... */]),
  metadata: { category: "ai" },
});

// Search with quantized query
const results = await repo.similaritySearch(new Int8Array([100, -50, 75 /* ... */]), { topK: 5 });
```

### SQLite Repository (Local Persistence)

```typescript
import { SqliteChunkVectorStorage } from "@workglow/storage";

const repo = new SqliteChunkVectorStorage<{ text: string }>(
  "./vectors.db", // database path
  "chunks",       // table name
  768             // vector dimension
);
await repo.setupDatabase();

// Bulk insert using inherited tabular methods
await repo.putMany([
  { chunk_id: "1", doc_id: "doc1", vector: new Float32Array([...]), metadata: { text: "..." } },
  { chunk_id: "2", doc_id: "doc1", vector: new Float32Array([...]), metadata: { text: "..." } },
]);
```

### PostgreSQL with pgvector

```typescript
import { Pool } from "pg";
import { PostgresChunkVectorStorage } from "@workglow/storage";

const pool = new Pool({ connectionString: "postgresql://..." });
const repo = new PostgresChunkVectorStorage<{ text: string; category: string }>(
  pool,
  "chunks",
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

## Data Model

### ChunkVector Schema

Each chunk vector entry contains:

```typescript
interface ChunkVector<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  Vector extends TypedArray = Float32Array,
> {
  chunk_id: string; // Unique identifier for the chunk
  doc_id: string; // Parent document identifier
  vector: Vector; // Embedding vector
  metadata: Metadata; // Custom metadata (text content, entities, etc.)
}
```

### Default Schema

```typescript
const ChunkVectorSchema = {
  type: "object",
  properties: {
    chunk_id: { type: "string" },
    doc_id: { type: "string" },
    vector: TypedArraySchema(),
    metadata: { type: "object", additionalProperties: true },
  },
  additionalProperties: false,
} as const;

const ChunkVectorKey = ["chunk_id"] as const;
```

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
import {
  registerChunkVectorRepository,
  getChunkVectorRepository,
  getGlobalChunkVectorRepositories,
} from "@workglow/storage";

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

## Integration with DocumentRepository

The chunk vector repository works alongside `DocumentRepository` for hierarchical document storage:

```typescript
import {
  DocumentRepository,
  InMemoryChunkVectorStorage,
  InMemoryTabularStorage,
} from "@workglow/storage";
import { DocumentStorageSchema } from "@workglow/storage";

// Initialize storage backends
const tabularStorage = new InMemoryTabularStorage(DocumentStorageSchema, ["doc_id"]);
await tabularStorage.setupDatabase();

const vectorStorage = new InMemoryChunkVectorStorage(384);
await vectorStorage.setupDatabase();

// Create document repository with both storages
const docRepo = new DocumentRepository(tabularStorage, vectorStorage);

// Store document structure in tabular, chunks in vector
await docRepo.upsert(document);

// Search chunks by vector similarity
const results = await docRepo.search(queryVector, { topK: 5 });
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
