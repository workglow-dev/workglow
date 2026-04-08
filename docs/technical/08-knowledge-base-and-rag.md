<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Knowledge Base and RAG Pipeline

## Overview

The Workglow knowledge base system (`@workglow/knowledge-base`) provides a unified abstraction for document ingestion, hierarchical structural parsing, chunk management, vector storage, and retrieval-augmented generation (RAG). It bridges the gap between raw text and the embedding-based retrieval that AI tasks need by modeling documents as trees, extracting chunks with full lineage information, and storing vector embeddings alongside rich metadata.

The system is built on two core ideas:

1. **Dual storage:** Every knowledge base owns both a tabular storage for document structure (serialized JSON trees) and a vector storage for chunk embeddings. Operations that span both stores -- such as deleting a document and all its chunks -- are managed by the `KnowledgeBase` class.

2. **Global registry:** Knowledge bases are registered by string ID in a global map, and the task system resolves these IDs at runtime through the `format: "knowledge-base"` input resolver. This means RAG tasks can reference a knowledge base by name without holding a direct reference.

## The KnowledgeBase Class

`KnowledgeBase` is the central facade. It coordinates document CRUD, chunk CRUD, vector search, and lifecycle operations across the two underlying storage backends.

```typescript
import { KnowledgeBase } from "@workglow/knowledge-base";

const kb = new KnowledgeBase(
  "my-kb",                   // name
  documentTabularStorage,     // ITabularStorage for documents
  chunkVectorStorage,         // IVectorStorage for chunk vectors
  "My Knowledge Base",        // title (optional)
  "Research papers corpus"    // description (optional)
);
```

### Properties

| Property | Type | Description |
|---|---|---|
| `name` | `string` | Unique identifier for the knowledge base |
| `title` | `string` | Human-readable title (defaults to `name`) |
| `description` | `string` | Description of the knowledge base contents |

### Document Operations

```typescript
// Upsert a document
const doc = await kb.upsertDocument(document);

// Retrieve a document
const doc = await kb.getDocument("doc-123");

// Delete a document and all its chunks (cascading)
await kb.deleteDocument("doc-123");

// List all document IDs
const docIds = await kb.listDocuments();
```

### Tree Traversal

The knowledge base provides traversal helpers that operate on the stored document tree:

```typescript
// Get a specific node by ID
const node = await kb.getNode("doc-123", "node-456");

// Get ancestors from root to a target node
const ancestors = await kb.getAncestors("doc-123", "node-789");
```

### Chunk Operations

```typescript
// Upsert a single chunk (validates vector dimensions)
const chunk = await kb.upsertChunk({
  doc_id: "doc-123",
  vector: embeddingVector,
  metadata: chunkRecord,
});

// Bulk upsert
const chunks = await kb.upsertChunksBulk(chunkArray);

// Get all chunks for a document
const docChunks = await kb.getChunksForDocument("doc-123");

// Get a chunk by ID
const chunk = await kb.getChunk("chunk-456");

// Get all chunks
const allChunks = await kb.getAllChunks();

// Get chunk count
const count = await kb.chunkCount();

// Clear all chunks
await kb.clearChunks();

// Delete chunks for a specific document
await kb.deleteChunksForDocument("doc-123");
```

### Vector Search

```typescript
// Similarity search
const results = await kb.similaritySearch(queryVector, {
  topK: 10,
  scoreThreshold: 0.7,
  filter: { doc_id: "doc-123" },
});

// Check hybrid search support
if (kb.supportsHybridSearch()) {
  const hybridResults = await kb.hybridSearch(queryVector, {
    textQuery: "transformer architecture",
    topK: 10,
    vectorWeight: 0.7,
  });
}
```

### Lifecycle

```typescript
// Prepare for re-indexing (deletes chunks, keeps document)
const doc = await kb.prepareReindex("doc-123");

// Setup underlying databases
await kb.setupDatabase();

// Cleanup
kb.destroy();
```

## Document Model

### Document Class

The `Document` class wraps a hierarchical tree structure (`DocumentRootNode`), metadata, and an array of chunk records. It serves as the serialization boundary -- documents are stored as JSON strings in tabular storage.

```typescript
import { Document } from "@workglow/knowledge-base";

const doc = new Document(
  rootNode,                    // DocumentRootNode tree
  { title: "My Document", sourceUri: "https://example.com/doc.md" },
  chunks,                      // ChunkRecord[] (optional)
  "doc-123"                    // doc_id (optional, auto-generated)
);

// Serialize
const json = JSON.stringify(doc.toJSON());

// Deserialize
const restored = Document.fromJSON(json, "doc-123");

// Access chunks
const chunks = doc.getChunks();
doc.setChunks(newChunks);

// Find chunks by node ID
const related = doc.findChunksByNodeId("section-node-5");
```

### DocumentMetadata

```typescript
interface DocumentMetadata {
  readonly title: string;
  readonly sourceUri?: string;
  readonly createdAt?: string;    // ISO timestamp
  // Additional properties allowed
}
```

### Document Tree Structure

Documents are represented as discriminated union trees using the `NodeKind` discriminator:

```typescript
const NodeKind = {
  DOCUMENT: "document",
  SECTION: "section",
  PARAGRAPH: "paragraph",
  SENTENCE: "sentence",
  TOPIC: "topic",
} as const;
```

Each node type has specific properties:

**DocumentRootNode** -- The root of every document tree:

```typescript
interface DocumentRootNode {
  readonly nodeId: string;
  readonly kind: "document";
  readonly range: NodeRange;
  readonly text: string;
  readonly title: string;
  readonly children: DocumentNode[];
  readonly enrichment?: NodeEnrichment;
}
```

**SectionNode** -- Represents a markdown header or structural division:

```typescript
interface SectionNode {
  readonly nodeId: string;
  readonly kind: "section";
  readonly level: number;         // 1-6 for markdown headers
  readonly title: string;
  readonly range: NodeRange;
  readonly text: string;
  readonly children: DocumentNode[];
  readonly enrichment?: NodeEnrichment;
}
```

**ParagraphNode** -- A block of text:

```typescript
interface ParagraphNode {
  readonly nodeId: string;
  readonly kind: "paragraph";
  readonly range: NodeRange;
  readonly text: string;
  readonly enrichment?: NodeEnrichment;
}
```

**SentenceNode** -- Fine-grained text segmentation:

```typescript
interface SentenceNode {
  readonly nodeId: string;
  readonly kind: "sentence";
  readonly range: NodeRange;
  readonly text: string;
  readonly enrichment?: NodeEnrichment;
}
```

**TopicNode** -- Semantic topic boundary:

```typescript
interface TopicNode {
  readonly nodeId: string;
  readonly kind: "topic";
  readonly range: NodeRange;
  readonly text: string;
  readonly children: DocumentNode[];
  readonly enrichment?: NodeEnrichment;
}
```

### NodeRange

Every node tracks its character offset range in the source text:

```typescript
interface NodeRange {
  readonly startOffset: number;   // Starting character offset
  readonly endOffset: number;     // Ending character offset
}
```

### NodeEnrichment

Optional AI-generated metadata attached to any node:

```typescript
interface NodeEnrichment {
  readonly summary?: string;
  readonly entities?: Entity[];     // { text, type, score }
  readonly keywords?: string[];
}
```

## Structural Parsing

The `StructuralParser` converts raw text into the hierarchical document tree. It supports markdown and plain text formats, with automatic format detection.

```typescript
import { StructuralParser } from "@workglow/knowledge-base";

// Auto-detect format
const root = await StructuralParser.parse("doc-1", text, "My Document");

// Explicit markdown parsing
const root = await StructuralParser.parseMarkdown("doc-1", markdownText, "My Document");

// Explicit plain text parsing
const root = await StructuralParser.parsePlainText("doc-1", plainText, "My Document");
```

### Markdown Parsing

The markdown parser recognizes header lines (`# ... ######`) and builds a nested section hierarchy. It:

1. Splits the input into lines and tracks character offsets.
2. When a header line is encountered, it flushes any accumulated paragraph text and creates a new `SectionNode`.
3. Manages a parent stack to nest sections correctly (a `## Section` becomes a child of the preceding `# Section`).
4. When a higher-level header appears, it pops the stack back to the appropriate parent, updating the `endOffset` of closed sections.
5. Non-header text is accumulated into `ParagraphNode` children.

All offsets are measured in UTF-16 code units, consistent with JavaScript's `String.prototype.length`.

### Plain Text Parsing

The plain text parser splits by double newlines (`\n\n`) to create paragraph nodes. Each paragraph tracks its trimmed offset range within the source text.

### Format Detection

`StructuralParser.parse()` auto-detects the format by checking for markdown header patterns (`/^#{1,6}\s/m`). If found, it delegates to `parseMarkdown`; otherwise, `parsePlainText`.

## Chunk System

Chunks are the atomic units for embedding and retrieval. Each chunk carries its text, tree lineage, and optional enrichment metadata.

### ChunkRecord

```typescript
interface ChunkRecord {
  readonly chunkId: string;
  readonly doc_id: string;
  readonly text: string;
  readonly nodePath: string[];      // Node IDs from root to leaf
  readonly depth: number;           // Depth in the document tree
  readonly leafNodeId?: string;     // ID of the originating leaf node
  readonly summary?: string;        // AI-generated summary
  readonly entities?: Entity[];     // Named entities
  readonly parentSummaries?: string[];  // Summaries from ancestor nodes
  readonly sectionTitles?: string[];    // Titles of ancestor sections
  readonly doc_title?: string;          // Parent document title
}
```

The `nodePath` field is critical for hierarchical RAG. It records the full path from the document root to the node that produced this chunk, enabling:

- **Hierarchy joins:** Given a chunk hit, reconstruct its section context by walking the path.
- **Filtering:** Find all chunks that belong to a specific section.
- **Deduplication:** Identify chunks that share ancestor nodes.

### ChunkVectorStorageSchema

Chunks are stored in vector storage with the following schema:

```typescript
const ChunkVectorStorageSchema = {
  type: "object",
  properties: {
    chunk_id: { type: "string", "x-auto-generated": true },
    doc_id: { type: "string" },
    vector: TypedArraySchema(),
    metadata: { type: "object", format: "metadata", additionalProperties: true },
  },
  required: ["chunk_id", "doc_id", "vector", "metadata"],
  additionalProperties: false,
};
```

The `metadata` field holds the `ChunkRecord` content. The `chunk_id` is auto-generated (UUID). The `vector` field stores the embedding as a typed array (Float32Array by default).

### ChunkVectorEntity

The full entity type combines the storage fields with the chunk metadata:

```typescript
interface ChunkVectorEntity {
  chunk_id: string;
  doc_id: string;
  vector: TypedArray;
  metadata: ChunkRecord;
}
```

When inserting, `chunk_id` is optional (auto-generated):

```typescript
type InsertChunkVectorEntity = Omit<ChunkVectorEntity, "chunk_id"> &
  Partial<Pick<ChunkVectorEntity, "chunk_id">>;
```

## Dual Storage Architecture

Every knowledge base uses two separate storage backends:

### 1. Document Tabular Storage

Stores the serialized document tree as a JSON string in a tabular backend:

```typescript
const DocumentStorageSchema = {
  type: "object",
  properties: {
    doc_id: { type: "string", "x-auto-generated": true },
    data: { type: "string" },       // JSON-serialized Document
    metadata: { type: "object" },
  },
  required: ["doc_id", "data"],
};
```

The `data` column contains the full `Document.toJSON()` output -- the tree, metadata, and chunk records. This is the source of truth for document structure.

### 2. Chunk Vector Storage

Stores chunk embeddings in a vector backend for similarity search. Each chunk references its parent document through `doc_id`. The vector storage is the source of truth for retrieval.

### Cascading Deletes

When `kb.deleteDocument(doc_id)` is called, the knowledge base first deletes all chunks for that document (`chunkStorage.deleteSearch({ doc_id })`), then deletes the document itself from tabular storage. This ensures referential integrity without requiring foreign key support in the storage backends.

## RAG Tasks

The Workglow AI package provides pre-built tasks for the RAG pipeline. These tasks reference knowledge bases by string ID and resolve them at runtime through the input resolver.

### Pipeline Overview

```
Text Document
    |
    v
StructuralParser -----> DocumentRootNode tree
    |
    v
Chunking Task --------> ChunkRecord[]
    |
    v
ChunkToVectorTask ----> Float32Array[] (embeddings)
    |
    v
ChunkVectorUpsertTask -> Stored in KnowledgeBase vector storage
    |
    v
ChunkRetrievalTask <--- Query + KnowledgeBase ID -> Relevant chunks
    |
    v
AI Generation Task ---> Answer with context
```

### Key RAG Tasks

**ChunkToVectorTask** -- Generates embeddings for an array of chunks using a specified model:

```typescript
// Input: { vector: TypedArray, chunks: ChunkRecord[] }
// Output: { vectors: Float32Array[] }
```

**ChunkVectorUpsertTask** -- Stores chunk vectors in a knowledge base:

```typescript
// Input: { knowledgeBase: "my-kb", vectors: ChunkVectorEntity[] }
```

**ChunkRetrievalTask** -- Retrieves relevant chunks from a knowledge base given a query:

```typescript
// Input: { knowledgeBase: "my-kb", query: "What is...", model: "..." }
// Output: { chunks: ChunkSearchResult[] }
```

**ChunkVectorSearchTask** -- Direct vector similarity search against a knowledge base.

**ChunkVectorHybridSearchTask** -- Combined vector + full-text search.

**HierarchyJoinTask** -- Given chunk search results, walks the document tree to reconstruct section context and enrich the results with ancestor information.

### Example Workflow

```typescript
import { Workflow } from "@workglow/task-graph";
import { createKnowledgeBase } from "@workglow/knowledge-base";

// Create and register a knowledge base
const kb = await createKnowledgeBase({
  name: "research-papers",
  vectorDimensions: 1024,
});

// Build an ingestion pipeline
const workflow = new Workflow("ingest");
const parseTask = workflow.addTask("StructuralParseTask", {
  text: documentText,
  title: "My Paper",
});
const chunkTask = workflow.addTask("ChunkingTask", {});
const embedTask = workflow.addTask("ChunkToVectorTask", {
  model: "text-embedding-3-small",
});
const upsertTask = workflow.addTask("ChunkVectorUpsertTask", {
  knowledgeBase: "research-papers",
});

workflow.pipe(parseTask, chunkTask, embedTask, upsertTask);
await workflow.run();
```

## Global Registry

Knowledge bases are managed through a global registry backed by the service container.

### Registration

```typescript
import {
  registerKnowledgeBase,
  getKnowledgeBase,
  getGlobalKnowledgeBases,
  createKnowledgeBase,
} from "@workglow/knowledge-base";

// Factory function (creates in-memory storage and registers automatically)
const kb = await createKnowledgeBase({
  name: "my-kb",
  vectorDimensions: 768,
  title: "My Knowledge Base",
  description: "Contains project documentation",
});

// Manual registration
await registerKnowledgeBase("custom-kb", customKnowledgeBase);

// Retrieval
const kb = getKnowledgeBase("my-kb");

// Enumerate all
const allKbs = getGlobalKnowledgeBases(); // Map<string, KnowledgeBase>
```

### createKnowledgeBase Factory

The factory function provides a convenient way to create a fully configured knowledge base with in-memory storage:

```typescript
interface CreateKnowledgeBaseOptions {
  readonly name: string;                                     // Required: unique ID
  readonly vectorDimensions: number;                         // Required: embedding dimensions
  readonly vectorType?: { new (array: number[]): TypedArray }; // Default: Float32Array
  readonly register?: boolean;                                // Default: true
  readonly title?: string;                                   // Human-readable title
  readonly description?: string;                             // Description
}
```

It creates an `InMemoryTabularStorage` for documents and an `InMemoryVectorStorage` for chunks, calls `setupDatabase()` on both, constructs a `KnowledgeBase`, and registers it globally (unless `register: false`).

### Persistent Repository

Beyond the in-memory live map, knowledge base metadata is persisted in a `KnowledgeBaseRepository` backed by tabular storage:

```typescript
const KnowledgeBaseRecordSchema = {
  type: "object",
  properties: {
    kb_id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    vector_dimensions: { type: "integer" },
    document_table: { type: "string" },
    chunk_table: { type: "string" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
};
```

The repository emits events (`knowledge_base_added`, `knowledge_base_removed`, `knowledge_base_updated`) and supports CRUD operations. Table names are generated from the knowledge base ID using `knowledgeBaseTableNames(kbId)`:

```typescript
knowledgeBaseTableNames("research-papers");
// { documentTable: "kb_docs_research_papers", chunkTable: "kb_chunks_research_papers" }
```

### Input Resolution

The knowledge base registry integrates with Workglow's input resolution system. Task schemas that declare `format: "knowledge-base"` on an input property will have the string ID automatically resolved to the `KnowledgeBase` instance:

```typescript
static inputSchema(): DataPortSchema {
  return {
    type: "object",
    properties: {
      knowledgeBase: {
        type: "string",
        format: "knowledge-base",
        title: "Knowledge Base",
      },
    },
  } as const satisfies DataPortSchema;
}
```

At runtime, when the task receives `{ knowledgeBase: "research-papers" }`, the resolver looks up `"research-papers"` in the global map and replaces the string with the actual `KnowledgeBase` instance. The corresponding compactor reverses this process for serialization.

### Service Tokens

| Token | Type | Description |
|---|---|---|
| `KNOWLEDGE_BASES` | `Map<string, KnowledgeBase>` | Live registry of active knowledge bases |
| `KNOWLEDGE_BASE_REPOSITORY` | `KnowledgeBaseRepository` | Persistent metadata repository |

## API Reference

### KnowledgeBase

- `new KnowledgeBase(name, documentStorage, chunkStorage, title?, description?)` -- Create a knowledge base.
- `upsertDocument(document): Promise<Document>` -- Insert or update a document.
- `getDocument(doc_id): Promise<Document | undefined>` -- Retrieve a document.
- `deleteDocument(doc_id): Promise<void>` -- Delete a document and its chunks.
- `listDocuments(): Promise<string[]>` -- List all document IDs.
- `getNode(doc_id, nodeId): Promise<DocumentNode | undefined>` -- Get a node from the tree.
- `getAncestors(doc_id, nodeId): Promise<DocumentNode[]>` -- Get ancestor nodes.
- `upsertChunk(chunk): Promise<ChunkVectorEntity>` -- Insert or update a chunk vector.
- `upsertChunksBulk(chunks): Promise<ChunkVectorEntity[]>` -- Bulk upsert chunks.
- `getChunk(chunk_id): Promise<ChunkVectorEntity | undefined>` -- Get a chunk by ID.
- `getChunksForDocument(doc_id): Promise<ChunkVectorEntity[]>` -- Get all chunks for a document.
- `deleteChunksForDocument(doc_id): Promise<void>` -- Delete chunks by document.
- `getAllChunks(): Promise<ChunkVectorEntity[] | undefined>` -- Get all chunks.
- `chunkCount(): Promise<number>` -- Count chunks.
- `clearChunks(): Promise<void>` -- Delete all chunks.
- `put(chunk): Promise<ChunkVectorEntity>` -- Alias for `upsertChunk`.
- `putBulk(chunks): Promise<ChunkVectorEntity[]>` -- Alias for `upsertChunksBulk`.
- `similaritySearch(query, options?): Promise<ChunkSearchResult[]>` -- Vector search.
- `hybridSearch(query, options): Promise<ChunkSearchResult[]>` -- Combined vector + text search.
- `supportsHybridSearch(): boolean` -- Check backend support.
- `prepareReindex(doc_id): Promise<Document | undefined>` -- Delete chunks, keep document.
- `getDocumentChunks(doc_id): Promise<ChunkRecord[]>` -- Get chunks from the document JSON.
- `findChunksByNodeId(doc_id, nodeId): Promise<ChunkRecord[]>` -- Find chunks by node path.
- `getVectorDimensions(): number` -- Get configured vector dimensions.
- `setupDatabase(): Promise<void>` -- Initialize storage backends.
- `destroy(): void` -- Free resources.

### Document

- `new Document(root, metadata, chunks?, doc_id?)` -- Create a document.
- `toJSON(): { metadata, root, chunks }` -- Serialize.
- `Document.fromJSON(json, doc_id?): Document` -- Deserialize.
- `getChunks(): ChunkRecord[]` -- Get chunk records.
- `setChunks(chunks): void` -- Replace chunk records.
- `findChunksByNodeId(nodeId): ChunkRecord[]` -- Filter chunks by node path.
- `setDocId(doc_id): void` -- Set the document ID.

### StructuralParser

- `StructuralParser.parse(doc_id, text, title, format?): Promise<DocumentRootNode>` -- Auto-detect and parse.
- `StructuralParser.parseMarkdown(doc_id, text, title): Promise<DocumentRootNode>` -- Parse markdown.
- `StructuralParser.parsePlainText(doc_id, text, title): Promise<DocumentRootNode>` -- Parse plain text.

### Registry Functions

- `createKnowledgeBase(options): Promise<KnowledgeBase>` -- Factory with in-memory storage.
- `registerKnowledgeBase(id, kb): Promise<void>` -- Register globally.
- `getKnowledgeBase(id): KnowledgeBase | undefined` -- Look up by ID.
- `getGlobalKnowledgeBases(): Map<string, KnowledgeBase>` -- Get the live registry map.
- `getGlobalKnowledgeBaseRepository(): KnowledgeBaseRepository` -- Get the persistent repository.
- `setGlobalKnowledgeBaseRepository(repository): void` -- Replace the persistent repository.
