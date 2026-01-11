# Vector Storage Module

A flexible vector storage solution with multiple backend implementations for RAG (Retrieval-Augmented Generation) pipelines. Provides a consistent interface for vector CRUD operations with similarity search and hybrid search capabilities.

## Features

- **Multiple Storage Backends:**
  - 🧠 `InMemoryVectorRepository` - Fast in-memory storage for testing and small datasets
  - 📁 `SqliteVectorRepository` - Persistent SQLite storage for local applications
  - 🐘 `PostgresVectorRepository` - PostgreSQL with pgvector extension for production
  - 🔍 `SeekDbVectorRepository` - SeekDB/OceanBase with native hybrid search
  - 📱 `EdgeVecRepository` - Edge/browser deployment with IndexedDB and WebGPU support

- **Quantized Vector Support:**
  - Float32Array (standard 32-bit floating point)
  - Float16Array (16-bit floating point)
  - Float64Array (64-bit high precision)
  - Int8Array (8-bit signed - binary quantization)
  - Uint8Array (8-bit unsigned - quantization)
  - Int16Array (16-bit signed - quantization)
  - Uint16Array (16-bit unsigned - quantization)

- **Advanced Search Capabilities:**
  - Vector similarity search (cosine similarity)
  - Hybrid search (vector + full-text)
  - Metadata filtering
  - Top-K retrieval with score thresholds

- **Production Ready:**
  - Type-safe interfaces
  - Event emitters for monitoring
  - Bulk operations support
  - Efficient indexing strategies

## Installation

```bash
bun install @workglow/storage
```

## Usage

### In-Memory Repository (Testing/Browser)

```typescript
import { InMemoryVectorRepository } from "@workglow/storage";

// Standard Float32 vectors
const repo = new InMemoryVectorRepository<{ text: string; source: string }>();
await repo.setupDatabase();

// Upsert vectors
await repo.upsert(
  "doc1",
  new Float32Array([0.1, 0.2, 0.3, ...]),
  { text: "Hello world", source: "example.txt" }
);

// Search for similar vectors
const results = await repo.similaritySearch(
  new Float32Array([0.15, 0.25, 0.35, ...]),
  { topK: 5, scoreThreshold: 0.7 }
);
```

### Quantized Vectors (Reduced Storage)

```typescript
import { InMemoryVectorRepository } from "@workglow/storage";

// Use Int8Array for 4x smaller storage (binary quantization)
const repo = new InMemoryVectorRepository<
  { text: string },
  Int8Array
>();
await repo.setupDatabase();

// Store quantized vectors
await repo.upsert(
  "doc1",
  new Int8Array([127, -128, 64, ...]),
  { text: "Quantized embedding" }
);

// Search with quantized query
const results = await repo.similaritySearch(
  new Int8Array([100, -50, 75, ...]),
  { topK: 5 }
);
```

### SQLite Repository (Local Persistence)

```typescript
import { SqliteVectorRepository } from "@workglow/storage";

const repo = new SqliteVectorRepository<{ text: string }>(
  "./vectors.db", // database path
  "embeddings"    // table name
);
await repo.setupDatabase();

// Bulk upsert
await repo.upsertBulk([
  { id: "1", vector: new Float32Array([...]), metadata: { text: "..." } },
  { id: "2", vector: new Float32Array([...]), metadata: { text: "..." } },
]);
```

### PostgreSQL with pgvector

```typescript
import { Pool } from "pg";
import { PostgresVectorRepository } from "@workglow/storage";

const pool = new Pool({ connectionString: "postgresql://..." });
const repo = new PostgresVectorRepository<{ text: string; category: string }>(
  pool,
  "vectors",
  384 // vector dimension
);
await repo.setupDatabase();

// Hybrid search (vector + full-text)
const results = await repo.hybridSearch(queryVector, {
  textQuery: "machine learning",
  topK: 10,
  vectorWeight: 0.7,
  filter: { category: "ai" },
});
```

### SeekDB (Hybrid Search Database)

```typescript
import mysql from "mysql2/promise";
import { SeekDbVectorRepository } from "@workglow/storage";

const pool = mysql.createPool({ host: "...", database: "..." });
const repo = new SeekDbVectorRepository<{ text: string }>(
  pool,
  "vectors",
  768 // vector dimension
);
await repo.setupDatabase();

// Native hybrid search
const results = await repo.hybridSearch(queryVector, {
  textQuery: "neural networks",
  topK: 5,
  vectorWeight: 0.6,
});
```

### EdgeVec (Browser/Edge Deployment)

```typescript
import { EdgeVecRepository } from "@workglow/storage";

const repo = new EdgeVecRepository<{ text: string }>({
  dbName: "my-vectors", // IndexedDB name
  enableWebGPU: true, // Enable GPU acceleration
});
await repo.setupDatabase();

// Works entirely in the browser
await repo.upsert("1", vector, { text: "..." });
const results = await repo.similaritySearch(queryVector, { topK: 3 });
```

## API Documentation

### Core Methods

All repositories implement the `IVectorRepository` interface:

```typescript
interface IVectorRepository<Metadata> {
  // Setup
  setupDatabase(): Promise<void>;

  // CRUD Operations
  upsert(id: string, vector: Float32Array, metadata: Metadata): Promise<void>;
  upsertBulk(items: VectorEntry<Metadata>[]): Promise<void>;
  get(id: string): Promise<VectorEntry<Metadata> | undefined>;
  delete(id: string): Promise<void>;
  deleteBulk(ids: string[]): Promise<void>;
  deleteByFilter(filter: Partial<Metadata>): Promise<void>;

  // Search
  search(
    query: Float32Array,
    options?: VectorSearchOptions<Metadata>
  ): Promise<SearchResult<Metadata>[]>;
  hybridSearch?(
    query: Float32Array,
    options: HybridSearchOptions<Metadata>
  ): Promise<SearchResult<Metadata>[]>;

  // Utility
  size(): Promise<number>;
  clear(): Promise<void>;
  destroy(): void;

  // Events
  on(event: "upsert" | "delete" | "search", callback: Function): void;
}
```

### Search Options

```typescript
interface VectorSearchOptions<Metadata> {
  topK?: number; // Number of results (default: 10)
  filter?: Partial<Metadata>; // Filter by metadata
  scoreThreshold?: number; // Minimum score (0-1)
}

interface HybridSearchOptions<Metadata> extends VectorSearchOptions<Metadata> {
  textQuery: string; // Full-text query
  vectorWeight?: number; // Vector weight 0-1 (default: 0.7)
}
```

## Quantization Benefits

Quantized vectors can significantly reduce storage and improve performance:

| Vector Type  | Bytes/Dim | Storage vs Float32 | Use Case                             |
| ------------ | --------- | ------------------ | ------------------------------------ |
| Float32Array | 4         | 100% (baseline)    | Standard embeddings                  |
| Float64Array | 8         | 200%               | High precision needed                |
| Int16Array   | 2         | 50%                | Good precision/size tradeoff         |
| Int8Array    | 1         | 25%                | Binary quantization, max compression |
| Uint8Array   | 1         | 25%                | Quantized embeddings [0-255]         |

**Example:** A 768-dimensional embedding:

- Float32: 3,072 bytes
- Int8: 768 bytes (75% reduction!)

## Performance Considerations

### InMemory

- **Best for:** Testing, small datasets (<10K vectors), browser apps
- **Pros:** Fastest, no dependencies, supports all vector types
- **Cons:** No persistence, memory limited

### SQLite

- **Best for:** Local apps, medium datasets (<100K vectors)
- **Pros:** Persistent, single file, no server
- **Cons:** No native vector indexing, slower for large datasets

### PostgreSQL + pgvector

- **Best for:** Production, large datasets (>100K vectors)
- **Pros:** HNSW indexing, efficient, scalable
- **Cons:** Requires PostgreSQL server and pgvector extension

### SeekDB

- **Best for:** Hybrid search workloads, production
- **Pros:** Native hybrid search, MySQL-compatible
- **Cons:** Requires SeekDB/OceanBase instance

### EdgeVec

- **Best for:** Privacy-sensitive apps, offline-first, edge computing
- **Pros:** No server, IndexedDB persistence, WebGPU acceleration
- **Cons:** Limited by browser storage, smaller datasets

## Integration with RAG Tasks

The vector repositories integrate seamlessly with RAG tasks:

```typescript
import { InMemoryVectorRepository } from "@workglow/storage";
import { Workflow } from "@workglow/task-graph";

const repo = new InMemoryVectorRepository();
await repo.setupDatabase();

const workflow = new Workflow()
  // Load and chunk document
  .fileLoader({ path: "./doc.md" })
  .textChunker({ chunkSize: 512, chunkOverlap: 50 })

  // Generate embeddings
  .textEmbedding({ model: "Xenova/all-MiniLM-L6-v2" })

  // Store in vector repository
  .vectorStoreUpsert({ repository: repo });

await workflow.run();

// Later: Search
const searchWorkflow = new Workflow()
  .textEmbedding({ text: "What is RAG?", model: "..." })
  .vectorStoreSearch({ repository: repo, topK: 5 })
  .contextBuilder({ format: "markdown" })
  .textQuestionAnswer({ question: "What is RAG?" });

const result = await searchWorkflow.run();
```

## Hierarchical Document Integration

For document-level storage and hierarchical context enrichment, use vector repositories alongside document repositories:

```typescript
import { InMemoryVectorRepository, InMemoryDocumentRepository } from "@workglow/storage";
import { Workflow } from "@workglow/task-graph";

const vectorRepo = new InMemoryVectorRepository();
const docRepo = new InMemoryDocumentRepository();
await vectorRepo.setupDatabase();

// Ingestion with hierarchical structure
await new Workflow()
  .structuralParser({
    text: markdownContent,
    title: "Documentation",
    format: "markdown",
  })
  .hierarchicalChunker({
    maxTokens: 512,
    overlap: 50,
    strategy: "hierarchical",
  })
  .textEmbedding({ model: "Xenova/all-MiniLM-L6-v2" })
  .chunkToVector()
  .vectorStoreUpsert({ repository: vectorRepo })
  .run();

// Retrieval with parent context
const result = await new Workflow()
  .textEmbedding({ text: query, model: "Xenova/all-MiniLM-L6-v2" })
  .vectorStoreSearch({ repository: vectorRepo, topK: 10 })
  .hierarchyJoin({
    documentRepository: docRepo,
    includeParentSummaries: true,
    includeEntities: true,
  })
  .reranker({ query, topK: 5 })
  .contextBuilder({ format: "markdown" })
  .run();
```

### Vector Metadata for Hierarchical Documents

When using hierarchical chunking, base vector metadata (stored in vector database) includes:

```typescript
metadata: {
  doc_id: string,        // Document identifier
  chunkId: string,      // Chunk identifier
  leafNodeId: string,   // Reference to document tree node
  depth: number,        // Hierarchy depth
  text: string,         // Chunk text content
  nodePath: string[],   // Node IDs from root to leaf
  // From enrichment (optional):
  summary?: string,     // Summary of the chunk content
  entities?: Entity[],  // Named entities extracted from the chunk
}
```

After `HierarchyJoinTask`, enriched metadata includes additional fields:

```typescript
enrichedMetadata: {
  // ... all base metadata fields above ...
  parentSummaries?: string[],  // Summaries from ancestor nodes (looked up on-demand)
  sectionTitles?: string[],     // Titles of ancestor section nodes
}
```

Note: `parentSummaries` is not stored in the vector database. It is computed on-demand by `HierarchyJoinTask` using `doc_id` and `leafNodeId` to look up ancestors from the document repository.

## Document Repository

The `IDocumentRepository` interface provides storage for hierarchical document structures:

```typescript
class DocumentRepository {
  constructor(tabularStorage: ITabularRepository, vectorStorage: IVectorRepository);

  upsert(document: Document): Promise<void>;
  get(doc_id: string): Promise<Document | undefined>;
  getNode(doc_id: string, nodeId: string): Promise<DocumentNode | undefined>;
  getAncestors(doc_id: string, nodeId: string): Promise<DocumentNode[]>;
  getChunks(doc_id: string): Promise<ChunkNode[]>;
  findChunksByNodeId(doc_id: string, nodeId: string): Promise<ChunkNode[]>;
  delete(doc_id: string): Promise<void>;
  list(): Promise<string[]>;
  search(query: TypedArray, options?: VectorSearchOptions): Promise<SearchResult[]>;
}
```

### Document Repository

The `DocumentRepository` class provides a unified interface for storing hierarchical documents and searching chunks. It uses composition of storage backends:

| Component            | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `ITabularRepository` | Stores document structure and metadata       |
| `IVectorRepository`  | Enables similarity search on document chunks |

**Example Usage:**

```typescript
import {
  DocumentRepository,
  InMemoryTabularRepository,
  InMemoryVectorRepository,
} from "@workglow/storage";

// Define schema for document storage
const DocumentStorageSchema = {
  type: "object",
  properties: {
    doc_id: { type: "string" },
    data: { type: "string" },
  },
  required: ["doc_id", "data"],
} as const;

// Initialize storage backends
const tabularStorage = new InMemoryTabularRepository(DocumentStorageSchema, ["doc_id"]);
await tabularStorage.setupDatabase();

const vectorStorage = new InMemoryVectorRepository();
await vectorStorage.setupDatabase();

// Create document repository
const docRepo = new DocumentRepository(tabularStorage, vectorStorage);

// Use the repository
await docRepo.upsert(document);
const results = await docRepo.search(queryVector, { topK: 5 });
```

## License

Apache 2.0
