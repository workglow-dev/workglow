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
- [Data Flow](#data-flow)
  - [Ingestion Pipeline](#ingestion-pipeline)
  - [Retrieval Pipeline](#retrieval-pipeline)
- [API Reference](#api-reference)
  - [Document](#document)
  - [KnowledgeBase](#knowledgebase-1)
  - [createKnowledgeBase](#createknowledgebase)
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
