# @workglow/knowledge-base

Document management, hierarchical chunking, and knowledge base infrastructure for RAG pipelines.

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Documents](#documents)
  - [Document Tree Structure](#document-tree-structure)
  - [Parsing](#parsing)
  - [Node Enrichment](#node-enrichment)
- [Chunks](#chunks)
  - [ChunkRecord](#chunkrecord)
  - [Chunk Vector Storage](#chunk-vector-storage)
- [KnowledgeBase](#knowledgebase)
  - [Creating a KnowledgeBase](#creating-a-knowledgebase)
  - [Document CRUD](#document-crud)
  - [Chunk Operations](#chunk-operations)
  - [Search](#search)
  - [Tree Traversal](#tree-traversal)
  - [Lifecycle Management](#lifecycle-management)
  - [Registry](#registry)
- [Shared-Table Mode](#shared-table-mode)
  - [Overview](#overview-1)
  - [Setting Up Shared Storage](#setting-up-shared-storage)
  - [Scoped Wrappers](#scoped-wrappers)
  - [Registering with Shared Tables](#registering-with-shared-tables)
  - [Schemas and Indexes](#schemas-and-indexes)
  - [When to Use Shared Tables](#when-to-use-shared-tables)
- [Data Flow](#data-flow)
  - [Ingestion Pipeline](#ingestion-pipeline)
  - [Retrieval Pipeline](#retrieval-pipeline)
- [API Reference](#api-reference)
  - [Document](#document)
  - [KnowledgeBase](#knowledgebase-1)
  - [createKnowledgeBase](#createknowledgebase)
  - [ScopedTabularStorage](#scopedtabularstorage)
  - [ScopedVectorStorage](#scopedvectorstorage)
  - [StructuralParser](#structuralparser)
  - [Type Helpers](#type-helpers)
- [License](#license)

## Overview

This package provides the data layer for RAG (Retrieval-Augmented Generation) workflows. It ties together three concerns:

1. **Documents** — hierarchical tree representation of parsed text (sections, paragraphs, sentences)
2. **Chunks** — flat records derived from the document tree, each tracking its position via node paths
3. **KnowledgeBase** — unified interface that owns both document storage (tabular) and chunk storage (vector), with cascading lifecycle management

```
  Markdown / Plain Text
         │
         ▼
  ┌──────────────┐
  │   Document   │  Hierarchical tree (sections, paragraphs)
  │  (tabular)   │  Stored as serialized JSON
  └──────┬───────┘
         │  chunking
         ▼
  ┌──────────────┐
  │   Chunks     │  Flat records with tree linkage (nodePath, depth)
  │  (vector)    │  Stored with embedding vectors
  └──────┬───────┘
         │  search
         ▼
  ┌──────────────┐
  │   Results    │  Ranked by similarity score
  └──────────────┘
```

## Installation

```bash
bun install @workglow/knowledge-base
```

Peer dependencies: `@workglow/storage`, `@workglow/util`.

## Quick Start

```typescript
import {
  createKnowledgeBase,
  Document,
  StructuralParser,
} from "@workglow/knowledge-base";

// 1. Create a knowledge base
const kb = await createKnowledgeBase({
  name: "my-kb",
  vectorDimensions: 384,
});

// 2. Parse a document
const root = await StructuralParser.parseMarkdown("doc1", markdown, "My Doc");
const doc = new Document(root, { title: "My Doc" });

// 3. Store the document
const inserted = await kb.upsertDocument(doc);

// 4. Store chunk embeddings
await kb.upsertChunk({
  doc_id: inserted.doc_id!,
  vector: new Float32Array([0.1, 0.2, ...]),
  metadata: {
    chunkId: "chunk_1",
    doc_id: inserted.doc_id!,
    text: "The chunk text...",
    nodePath: [root.nodeId, sectionNodeId],
    depth: 2,
  },
});

// 5. Search (via task pipeline)
import { Workflow } from "@workglow/task-graph";

const result = await new Workflow()
  .chunkRetrieval({
    knowledgeBase: "my-kb",
    query: "your search query",
    model: "your-embedding-model",
    topK: 5,
  })
  .run();
```

## Architecture

The package is organized around three layers:

```
┌───────────────────────────────────────────────────┐
│                 KnowledgeBase                     │
│  Unified API for documents + chunks + search      │
├────────────────────┬──────────────────────────────┤
│  DocumentTabular   │      ChunkVector             │
│  Storage           │      Storage                 │
│  (ITabularStorage) │      (IVectorStorage)        │
│                    │                              │
│  Stores serialized │  Stores embeddings +         │
│  document trees    │  ChunkRecord metadata        │
└────────────────────┴──────────────────────────────┘
```

**Storage backends** are pluggable via the `@workglow/storage` interfaces. The `createKnowledgeBase` factory defaults to in-memory storage; production deployments can use SQLite, PostgreSQL, or any other `ITabularStorage` / `IVectorStorage` implementation.

## Documents

### Document Tree Structure

Documents are represented as a hierarchical tree using a **discriminated union** of node types:

```
DocumentRootNode (kind: "document")
├── SectionNode (kind: "section", level: 1)
│   ├── ParagraphNode (kind: "paragraph")
│   ├── ParagraphNode (kind: "paragraph")
│   └── SectionNode (kind: "section", level: 2)
│       └── ParagraphNode (kind: "paragraph")
├── SectionNode (kind: "section", level: 1)
│   └── ParagraphNode (kind: "paragraph")
└── ParagraphNode (kind: "paragraph")
```

**Node types:**

| Type               | Kind          | Has Children | Description                                       |
| ------------------ | ------------- | ------------ | ------------------------------------------------- |
| `DocumentRootNode` | `"document"`  | yes          | Root of the tree, has `title`                     |
| `SectionNode`      | `"section"`   | yes          | From headers (level 1-6), has `title` and `level` |
| `ParagraphNode`    | `"paragraph"` | no           | Prose content                                     |
| `SentenceNode`     | `"sentence"`  | no           | Fine-grained segmentation                         |
| `TopicNode`        | `"topic"`     | yes          | From topic segmentation algorithms                |

All nodes share a base set of fields:

```typescript
interface DocumentNodeBase {
  readonly nodeId: string; // Unique identifier (UUID)
  readonly kind: NodeKind; // Discriminator
  readonly range: NodeRange; // { startOffset, endOffset } in source text
  readonly text: string; // Text content
  readonly enrichment?: NodeEnrichment; // Optional summary, entities, keywords
}
```

Use the `NodeKind` constants for comparisons:

```typescript
import { NodeKind } from "@workglow/knowledge-base";

if (node.kind === NodeKind.SECTION) {
  console.log(node.title, node.level, node.children.length);
}
```

### Parsing

`StructuralParser` converts raw text into a `DocumentRootNode`:

```typescript
import { StructuralParser } from "@workglow/knowledge-base";

// Markdown — detects headers, creates nested sections
const root = await StructuralParser.parseMarkdown(docId, markdownText, "Title");

// Plain text — splits on blank lines into paragraphs
const root = await StructuralParser.parsePlainText(docId, plainText, "Title");

// Auto-detect format
const root = await StructuralParser.parse(docId, text, "Title");
```

The parser:

- Converts markdown headers (`#` through `######`) into nested `SectionNode`s
- Groups text between headers as `ParagraphNode` children
- Tracks character offsets (`startOffset`, `endOffset`) for every node
- Assigns a unique `nodeId` to each node

### Node Enrichment

Nodes can carry optional enrichment data populated by AI tasks:

```typescript
interface NodeEnrichment {
  summary?: string; // AI-generated summary
  entities?: Entity[]; // Named entities (text, type, confidence score)
  keywords?: string[]; // Extracted keywords
}
```

Enrichment is set on nodes during the ingestion pipeline (e.g., by `DocumentEnricherTask`) and propagated to chunks during hierarchy join.

## Chunks

### ChunkRecord

A `ChunkRecord` is a flat, self-contained unit of text with full context about its position in the document tree:

```typescript
interface ChunkRecord {
  // Identity
  chunkId: string; // Unique chunk identifier
  doc_id: string; // Parent document ID

  // Content
  text: string; // The text to embed and search

  // Tree linkage
  nodePath: string[]; // Node IDs from root to leaf
  depth: number; // Depth in the document tree

  // Optional fields
  leafNodeId?: string; // Leaf node this chunk belongs to
  summary?: string; // Chunk-level summary
  entities?: Entity[]; // Named entities
  parentSummaries?: string[]; // Summaries from ancestor nodes
  sectionTitles?: string[]; // Titles of ancestor sections
  doc_title?: string; // Document title
}
```

The `nodePath` and `depth` fields enable **hierarchy-aware retrieval**: given a search result, you can walk back up the document tree to get section titles, parent summaries, or sibling chunks for additional context.

### Chunk Vector Storage

Chunks are stored in vector storage as `ChunkVectorEntity`:

```typescript
interface ChunkVectorEntity {
  chunk_id: string; // Primary key (auto-generated UUID)
  doc_id: string; // For filtering by document
  vector: TypedArray; // Embedding (Float32Array, etc.)
  metadata: ChunkRecord; // Full chunk record
}
```

The `metadata` field holds the complete `ChunkRecord`, so search results carry all the context needed for hierarchy-aware retrieval without additional lookups.

## KnowledgeBase

`KnowledgeBase` is the central class that ties document storage and vector storage together.

### Creating a KnowledgeBase

**Factory function (recommended):**

```typescript
import { createKnowledgeBase } from "@workglow/knowledge-base";

const kb = await createKnowledgeBase({
  name: "my-kb", // Identifier
  vectorDimensions: 384, // Must match your embedding model
  backend: "in-memory", // Currently only "in-memory"
  vectorType: Float32Array, // Default: Float32Array
  register: true, // Register globally (default: true)
});
```

**Direct construction (custom storage backends):**

```typescript
import { KnowledgeBase } from "@workglow/knowledge-base";

const kb = new KnowledgeBase(
  "my-kb",
  myDocumentTabularStorage, // ITabularStorage implementation
  myChunkVectorStorage // IVectorStorage implementation
);
```

### Document CRUD

```typescript
// Upsert — auto-generates doc_id if not set
const doc = new Document(root, { title: "My Document" });
const inserted = await kb.upsertDocument(doc);
console.log(inserted.doc_id); // auto-generated UUID

// Get by ID
const retrieved = await kb.getDocument(inserted.doc_id!);

// List all document IDs
const docIds = await kb.listDocuments();

// Delete — cascades to all chunks in vector storage
await kb.deleteDocument(inserted.doc_id!);
```

### Chunk Operations

```typescript
// Upsert a single chunk
const entity = await kb.upsertChunk({
  doc_id: "doc1",
  vector: new Float32Array([0.1, 0.2, 0.3]),
  metadata: {
    chunkId: "chunk_1",
    doc_id: "doc1",
    text: "Some text...",
    nodePath: ["root", "section1"],
    depth: 2,
  },
});

// Upsert in bulk
const entities = await kb.upsertChunksBulk(chunkArray);

// Get a specific chunk
const chunk = await kb.getChunk("chunk_id_here");

// Get all chunks for a document
const docChunks = await kb.getChunksForDocument("doc1");

// Delete all chunks for a document (without deleting the document)
await kb.deleteChunksForDocument("doc1");
```

### Search

**Similarity search** — vector-only:

```typescript
const results = await kb.similaritySearch(queryVector, {
  topK: 10, // Max results (default varies by backend)
  scoreThreshold: 0.7, // Minimum similarity score
  filter: { doc_id: "doc1" }, // Metadata filter
});

// Each result: ChunkVectorEntity & { score: number }
for (const result of results) {
  console.log(result.chunk_id, result.score, result.metadata.text);
}
```

**Hybrid search** — combines vector similarity with full-text search. Requires a storage backend that supports it (e.g., PostgreSQL with pgvector). Returns an empty array if unsupported.

```typescript
const results = await kb.hybridSearch(queryVector, {
  textQuery: "machine learning",
  topK: 10,
  vectorWeight: 0.7, // 0-1, balance between vector and text
  scoreThreshold: 0.5,
  filter: { doc_id: "doc1" },
});
```

### Tree Traversal

Navigate the document tree stored in the knowledge base:

```typescript
// Get a specific node by ID
const node = await kb.getNode("doc1", nodeId);

// Get ancestors from root to target (useful for building context)
const ancestors = await kb.getAncestors("doc1", leafNodeId);
// Returns: [rootNode, sectionNode, subsectionNode, targetNode]

// Get chunks stored in the document JSON (not vector storage)
const chunks = await kb.getDocumentChunks("doc1");

// Find chunks whose nodePath contains a given node ID
const related = await kb.findChunksByNodeId("doc1", sectionNodeId);
```

### Lifecycle Management

```typescript
// Prepare for re-indexing: delete chunks but keep the document
const doc = await kb.prepareReindex("doc1");
// doc is returned so you can re-chunk and re-embed

// Initialize storage backends
await kb.setupDatabase();

// Tear down
kb.destroy();
```

### Registry

Knowledge bases can be registered globally by name, allowing tasks to reference them by string ID:

```typescript
import { registerKnowledgeBase, getKnowledgeBase, TypeKnowledgeBase } from "@workglow/knowledge-base";

// Register
registerKnowledgeBase("my-kb", kb);

// Retrieve
const retrieved = getKnowledgeBase("my-kb");

// In task schemas — accepts either a string ID or a KnowledgeBase instance
const inputSchema = {
  type: "object",
  properties: {
    knowledgeBase: TypeKnowledgeBase({
      title: "Knowledge Base",
      description: "The KB to search",
    }),
  },
  required: ["knowledgeBase"],
} as const;

// Both work:
await task.run({ knowledgeBase: kb }); // Direct instance
await task.run({ knowledgeBase: "my-kb" }); // Resolved from registry
```

## Shared-Table Mode

### Overview

By default, each `KnowledgeBase` gets its own document table and chunk table. **Shared-table mode** lets multiple knowledge bases share the same underlying storage tables, partitioned by a `kb_id` column. This is useful when you have many knowledge bases and want to reduce table proliferation in your database.

```
Default mode (per-KB tables):          Shared-table mode:
┌──────────────────────┐               ┌──────────────────────────┐
│ kb_docs_my_kb        │               │ shared_documents         │
│ (doc_id, data)       │               │ (doc_id, kb_id, data)    │
├──────────────────────┤               │  ├─ kb_id = "kb-1" rows  │
│ kb_chunks_my_kb      │               │  └─ kb_id = "kb-2" rows  │
│ (chunk_id, vector..) │               ├──────────────────────────┤
├──────────────────────┤               │ shared_chunks            │
│ kb_docs_other_kb     │               │ (chunk_id, kb_id, vec..) │
│ (doc_id, data)       │               │  ├─ kb_id = "kb-1" rows  │
├──────────────────────┤               │  └─ kb_id = "kb-2" rows  │
│ kb_chunks_other_kb   │               └──────────────────────────┘
│ (chunk_id, vector..) │
└──────────────────────┘
```

The `KnowledgeBase` class itself is unchanged — shared-table mode is implemented via thin wrapper classes (`ScopedTabularStorage`, `ScopedVectorStorage`) that inject `kb_id` on writes and filter by `kb_id` on reads.

### Setting Up Shared Storage

Create the shared storage instances once, globally:

```typescript
import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import {
  SharedDocumentStorageSchema,
  SharedChunkVectorStorageSchema,
  SharedDocumentIndexes,
  SharedChunkIndexes,
  SHARED_DOCUMENT_TABLE,
  SHARED_CHUNK_TABLE,
  DocumentStorageKey,
  ChunkVectorPrimaryKey,
} from "@workglow/knowledge-base";

const sharedDocStorage = new InMemoryTabularStorage(
  SharedDocumentStorageSchema,
  DocumentStorageKey,
  SharedDocumentIndexes
);

const sharedChunkStorage = new InMemoryVectorStorage(
  SharedChunkVectorStorageSchema,
  ChunkVectorPrimaryKey,
  SharedChunkIndexes,
  1024 // vector dimensions
);
```

For SQL backends (SQLite, PostgreSQL), replace `InMemoryTabularStorage` / `InMemoryVectorStorage` with the appropriate implementations. The shared schemas include indexes on `kb_id` and `[kb_id, doc_id]` for efficient scoped queries.

### Scoped Wrappers

For each knowledge base, create scoped wrappers that filter to that KB's data:

```typescript
import {
  ScopedTabularStorage,
  ScopedVectorStorage,
  KnowledgeBase,
} from "@workglow/knowledge-base";

// KB 1
const scopedDocs1 = new ScopedTabularStorage(sharedDocStorage, "kb-1");
const scopedChunks1 = new ScopedVectorStorage(sharedChunkStorage, "kb-1");
const kb1 = new KnowledgeBase("kb-1", scopedDocs1, scopedChunks1);

// KB 2
const scopedDocs2 = new ScopedTabularStorage(sharedDocStorage, "kb-2");
const scopedChunks2 = new ScopedVectorStorage(sharedChunkStorage, "kb-2");
const kb2 = new KnowledgeBase("kb-2", scopedDocs2, scopedChunks2);
```

Each `KnowledgeBase` instance works exactly the same as in default mode — all CRUD, search, and lifecycle operations are transparently scoped to the KB's data.

### Registering with Shared Tables

Pass `{ sharedTables: true }` when registering so that the metadata record uses the shared table names:

```typescript
import { registerKnowledgeBase } from "@workglow/knowledge-base";

await registerKnowledgeBase("kb-1", kb1, { sharedTables: true });
await registerKnowledgeBase("kb-2", kb2, { sharedTables: true });
```

You can check whether a persisted record uses shared tables with the `isSharedTableMode` helper:

```typescript
import { isSharedTableMode } from "@workglow/knowledge-base";

const record = await repo.getKnowledgeBase("kb-1");
if (isSharedTableMode(record)) {
  // reconstruct using scoped wrappers
}
```

### Schemas and Indexes

The shared schemas augment the standard schemas with a `kb_id` column:

| Schema                          | Base Schema                | Added Column |
| ------------------------------- | -------------------------- | ------------ |
| `SharedDocumentStorageSchema`   | `DocumentStorageSchema`    | `kb_id: string` |
| `SharedChunkVectorStorageSchema`| `ChunkVectorStorageSchema` | `kb_id: string` |

Default shared table names: `SHARED_DOCUMENT_TABLE = "shared_documents"`, `SHARED_CHUNK_TABLE = "shared_chunks"`.

Pre-defined index arrays for efficient queries:
- `SharedDocumentIndexes` — `[["kb_id"]]`
- `SharedChunkIndexes` — `[["kb_id"], ["kb_id", "doc_id"]]`

### When to Use Shared Tables

| Scenario | Recommendation |
| --- | --- |
| Few knowledge bases, each large | Default (per-KB tables) — simpler, no `kb_id` overhead |
| Many knowledge bases (e.g., per-user, per-tenant) | Shared tables — avoids table proliferation |
| Need cross-KB queries | Shared tables — query the shared storage directly |
| Using managed databases with table limits | Shared tables |

## Data Flow

### Ingestion Pipeline

All ingestion steps are composable Tasks that auto-connect in a Workflow:

```
Raw Text / Markdown
  │
  ▼  StructuralParserTask
DocumentRootNode (tree with character offsets)
  │
  ▼  DocumentEnricherTask (optional AI enrichment)
DocumentRootNode (+ summaries, entities on nodes)
  │
  ▼  HierarchicalChunkerTask
ChunkRecord[] (flat chunks with nodePath linkage)
  │
  ▼  TextEmbeddingTask (AI model)
ChunkRecord[] + Float32Array[] (text → vectors)
  │
  ▼  ChunkToVectorTask
Vectors + metadata in vector store format
  │
  ▼  ChunkVectorUpsertTask → vector + tabular storage
```

Example using the Workflow API:

```typescript
import { Workflow } from "@workglow/task-graph";

const result = await new Workflow()
  .fileLoader({ url: `file://${filePath}`, format: "markdown" })
  .structuralParser({ title: "My Document" })
  .documentEnricher({ generateSummaries: true, extractEntities: true })
  .hierarchicalChunker({ maxTokens: 512, overlap: 50 })
  .textEmbedding({ model: "your-embedding-model" })
  .chunkToVector()
  .chunkVectorUpsert({ knowledgeBase: "my-kb" })
  .run();

console.log(result.count); // Number of vectors stored
```

### Retrieval Pipeline

All retrieval steps are composable Tasks that auto-connect in a Workflow:

```
User Query
  │
  ▼  QueryExpanderTask (optional — generates query variations)
Expanded queries
  │
  ▼  ChunkRetrievalTask (embeds query + vector search)
     or ChunkVectorHybridSearchTask (vector + full-text search)
ChunkSearchResult[] (chunks, chunk_ids, scores, query)
  │
  ▼  HierarchyJoinTask (optional — enriches with ancestor context)
Enriched chunks (+ parentSummaries, sectionTitles, entities)
  │
  ▼  RerankerTask (optional — cross-encoder reranking)
Re-scored chunks
  │
  ▼  ContextBuilderTask
Formatted context string for LLM prompt
  │
  ▼  LLM
Answer
```

Example using the Workflow API:

```typescript
import { Workflow } from "@workglow/task-graph";

const result = await new Workflow()
  .chunkRetrieval({
    knowledgeBase: "my-kb",
    query: "What caused the Civil War?",
    model: "your-embedding-model",
    topK: 10,
  })
  .hierarchyJoin({
    knowledgeBase: "my-kb",
    includeParentSummaries: true,
  })
  .reranker({
    method: "cross-encoder",
    model: "your-reranker-model",
    topK: 5,
  })
  .contextBuilder({
    format: "numbered",
    includeMetadata: false,
  })
  .run();

console.log(result.context); // Formatted context ready for LLM
```

## API Reference

### Document

```typescript
class Document {
  readonly doc_id?: string;
  readonly root: DocumentRootNode;
  readonly metadata: DocumentMetadata;

  constructor(
    root: DocumentRootNode,
    metadata: DocumentMetadata,
    chunks?: ChunkRecord[],
    doc_id?: string
  );

  setDocId(id: string): void;
  setChunks(chunks: ChunkRecord[]): void;
  getChunks(): ChunkRecord[];
  findChunksByNodeId(nodeId: string): ChunkRecord[];
  toJSON(): object;
  static fromJSON(json: string, doc_id?: string): Document;
}
```

### KnowledgeBase

```typescript
class KnowledgeBase {
  readonly name: string;

  constructor(
    name: string,
    documentStorage: DocumentTabularStorage,
    chunkStorage: ChunkVectorStorage
  );

  // Documents
  upsertDocument(document: Document): Promise<Document>;
  getDocument(doc_id: string): Promise<Document | undefined>;
  deleteDocument(doc_id: string): Promise<void>;
  listDocuments(): Promise<string[]>;

  // Tree traversal
  getNode(doc_id: string, nodeId: string): Promise<DocumentNode | undefined>;
  getAncestors(doc_id: string, nodeId: string): Promise<DocumentNode[]>;

  // Chunks
  upsertChunk(chunk: InsertChunkVectorEntity): Promise<ChunkVectorEntity>;
  upsertChunksBulk(chunks: InsertChunkVectorEntity[]): Promise<ChunkVectorEntity[]>;
  getChunk(chunk_id: string): Promise<ChunkVectorEntity | undefined>;
  getChunksForDocument(doc_id: string): Promise<ChunkVectorEntity[]>;
  deleteChunksForDocument(doc_id: string): Promise<void>;

  // Search
  similaritySearch(
    query: TypedArray,
    options?: VectorSearchOptions<ChunkRecord>
  ): Promise<ChunkSearchResult[]>;
  hybridSearch(
    query: TypedArray,
    options: HybridSearchOptions<ChunkRecord>
  ): Promise<ChunkSearchResult[]>;

  // Lifecycle
  prepareReindex(doc_id: string): Promise<Document | undefined>;
  setupDatabase(): Promise<void>;
  destroy(): void;

  // Accessors
  put(chunk: InsertChunkVectorEntity): Promise<ChunkVectorEntity>;
  putBulk(chunks: InsertChunkVectorEntity[]): Promise<ChunkVectorEntity[]>;
  getAllChunks(): Promise<ChunkVectorEntity[] | undefined>;
  chunkCount(): Promise<number>;
  clearChunks(): Promise<void>;
  getVectorDimensions(): number;
  getDocumentChunks(doc_id: string): Promise<ChunkRecord[]>;
  findChunksByNodeId(doc_id: string, nodeId: string): Promise<ChunkRecord[]>;
}
```

### createKnowledgeBase

```typescript
function createKnowledgeBase(options: CreateKnowledgeBaseOptions): Promise<KnowledgeBase>;

interface CreateKnowledgeBaseOptions {
  readonly name: string;
  readonly vectorDimensions: number;
  readonly backend?: "in-memory";
  readonly vectorType?: { new (array: number[]): TypedArray };
  readonly register?: boolean; // Default: true
}
```

### ScopedTabularStorage

```typescript
class ScopedTabularStorage<Schema, PrimaryKeyNames, Entity, PrimaryKey, InsertType>
  implements ITabularStorage<Schema, PrimaryKeyNames, Entity, PrimaryKey, InsertType>
{
  constructor(inner: AnyTabularStorage, kbId: string);

  // All ITabularStorage methods are implemented.
  // Writes inject kb_id, reads filter by kb_id, results strip kb_id.
  // setupDatabase() and destroy() are no-ops (shared storage lifecycle is external).
}
```

### ScopedVectorStorage

```typescript
class ScopedVectorStorage<Metadata, Schema, Entity, PrimaryKeyNames>
  extends ScopedTabularStorage<Schema, PrimaryKeyNames, Entity>
  implements IVectorStorage<Metadata, Schema, Entity, PrimaryKeyNames>
{
  constructor(inner: AnyVectorStorage, kbId: string);

  getVectorDimensions(): number; // Delegates to inner
  similaritySearch(query, options?): Promise<(Entity & { score })[]>; // Post-filters by kb_id
  hybridSearch?(query, options): Promise<(Entity & { score })[]>; // Post-filters by kb_id
}
```

### StructuralParser

```typescript
class StructuralParser {
  static parseMarkdown(doc_id: string, text: string, title: string): Promise<DocumentRootNode>;
  static parsePlainText(doc_id: string, text: string, title: string): Promise<DocumentRootNode>;
  static parse(
    doc_id: string,
    text: string,
    title: string,
    format?: string
  ): Promise<DocumentRootNode>;
}
```

### Type Helpers

```typescript
// Schema helper for task inputs that accept a KnowledgeBase ID or instance
function TypeKnowledgeBase<O>(options?: O): JsonSchema;

// Schema helper for tabular storage inputs
function TypeTabularStorage<O>(options?: O): JsonSchema;
```

## License

Apache 2.0 - See [LICENSE](./LICENSE) for details
