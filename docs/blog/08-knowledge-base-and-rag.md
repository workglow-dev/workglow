<!--
@license
Copyright 2025 Steven Roussey <sroussey@gmail.com>
SPDX-License-Identifier: Apache-2.0
-->

# Trees, Chunks, and Vectors: How Workglow Models Documents for RAG

Retrieval-Augmented Generation has a dirty secret. Most RAG systems treat documents as bags of text. They split content into overlapping windows, embed each window into a vector, and call it a day. When a user asks a question, the system retrieves the top-K most similar chunks and jams them into a prompt. It works -- sort of. But the moment you need to tell the user *where* an answer came from, or why one chunk matters more than another, the flat-chunk approach falls apart. You have text fragments floating in space with no memory of the structure they came from.

Workglow takes a different path. Documents live as hierarchical trees *and* flat vector-indexed chunks simultaneously, unified behind a single `KnowledgeBase` class that manages both representations, keeps them in sync, and exposes the whole thing as composable pipeline tasks.

This post walks through the architecture: from document parsing and tree modeling, through the dual-storage design, to the RAG pipeline tasks that tie it all together.

---

## The Problem with Flat Chunks

Consider a 50-page technical specification. It has a title, sections, subsections, paragraphs, and sentences. Traditional RAG pipelines run a "text splitter" that chops this into, say, 512-token windows with 64-token overlaps. Each window becomes a vector. Search works fine for simple factoid queries. But:

- **Source attribution is lossy.** Which section did a chunk come from? You only know it started at character 14,382. Reconstructing the section path requires re-parsing the original document.
- **Context is missing.** A chunk about "rate limits" makes more sense if you know it lives under "API Reference > Authentication > Rate Limiting." That hierarchy is gone.
- **Reranking is naive.** Without structure, you cannot boost chunks that share a section with a high-scoring match, or pull in the parent section's summary to disambiguate.

What you really want is *both* representations: a tree for browsing and contextual understanding, and flat chunks for vector search. Workglow gives you both, and keeps them tightly coupled.

---

## The Document Tree Model

At the core is a discriminated union of node types, defined in `DocumentSchema.ts`:

```typescript
export const NodeKind = {
  DOCUMENT: "document",
  SECTION: "section",
  PARAGRAPH: "paragraph",
  SENTENCE: "sentence",
  TOPIC: "topic",
} as const;
```

Each node carries a `nodeId`, a `kind` discriminator, a `range` (character offsets into the original text), and the node's `text` content. Container nodes -- `document`, `section`, and `topic` -- have a `children` array. Leaf nodes -- `paragraph` and `sentence` -- do not. The result is a proper tree:

```
DocumentRootNode ("document")
  +-- SectionNode ("section", level: 1, title: "Introduction")
  |     +-- ParagraphNode ("paragraph", text: "RAG pipelines typically...")
  |     +-- ParagraphNode ("paragraph", text: "This approach has limits...")
  +-- SectionNode ("section", level: 1, title: "Architecture")
        +-- SectionNode ("section", level: 2, title: "Storage Layer")
        |     +-- ParagraphNode ("paragraph", text: "Documents are stored...")
        +-- SectionNode ("section", level: 2, title: "Search Layer")
              +-- ParagraphNode ("paragraph", text: "Vector similarity...")
```

Every node type is a TypeScript interface extending a common `DocumentNodeBase`, and the full `DocumentNode` type is their union:

```typescript
export type DocumentNode =
  | DocumentRootNode
  | SectionNode
  | ParagraphNode
  | SentenceNode
  | TopicNode;
```

This is not just aesthetic. Discriminated unions let TypeScript narrow types at each branch. When you check `node.kind === "section"`, you get access to `level`, `title`, and `children` with full type safety. No casting, no runtime surprises.

Nodes can also carry optional `enrichment` data -- summaries, extracted named entities, keywords -- that gets populated by downstream AI tasks and propagated to chunks during indexing.

---

## Structural Parsing: Text to Tree

Raw text enters the system through `StructuralParser`, which converts markdown or plain text into a `DocumentRootNode` tree. The parser is deliberately simple and synchronous in spirit (the async signature exists for future extensibility):

**Markdown parsing** walks line by line. When it encounters a header (`# ... ######`), it creates a `SectionNode` with the appropriate `level`. It manages a parent stack: encountering a level-2 header while inside a level-3 section pops the stack until the right nesting depth is reached. Non-header lines accumulate in a text buffer that gets flushed as `ParagraphNode` children when the next header arrives or the document ends. Every node records its `startOffset` and `endOffset` in the original text, so you can always slice back to the source.

**Plain text parsing** is simpler: it splits on double newlines to create paragraphs under the root node, each with accurate character offsets.

The parser also includes a `looksLikeMarkdown` heuristic -- if the text contains lines starting with `#` followed by a space, it routes to the markdown path. Otherwise, plain text.

```typescript
const root = await StructuralParser.parse(docId, rawText, "My Document");
// root.children[0].kind === "section" -- type-safe access
```

The key insight is that parsing produces *structure*, not just text. The tree preserves the author's organizational intent, which turns out to be exactly the context that makes retrieved chunks useful.

---

## Chunks with Tree Linkage

Once you have a tree, you need chunks for vector search. Workglow's `ChunkRecord` is a flat record -- suitable for storage and embedding -- but it carries its lineage:

```typescript
// Required fields
{
  chunkId: string;      // Unique identifier
  doc_id: string;       // Parent document
  text: string;         // The actual chunk content
  nodePath: string[];   // Node IDs from root to leaf
  depth: number;        // Depth in the document tree
}

// Optional enrichment fields
{
  leafNodeId: string;       // The specific node this chunk represents
  summary: string;          // AI-generated summary
  entities: Entity[];       // Extracted named entities
  parentSummaries: string[];// Summaries from ancestor nodes
  sectionTitles: string[];  // Titles of ancestor sections
  doc_title: string;        // Document title for display
}
```

The `nodePath` is the critical field. It is an array of `nodeId` strings tracing the path from the document root down to the leaf node that produced the chunk. Given a `nodePath` like `["root-abc", "section-def", "paragraph-ghi"]`, you can reconstruct exactly where in the document hierarchy this chunk lives. The `Document` class provides `findChunksByNodeId(nodeId)` to locate all chunks that pass through a given node -- useful for finding everything under a particular section.

Chunks are stored *inside* the `Document` object as well (via `setChunks` / `getChunks`), creating a self-contained artifact that carries both its tree structure and its chunk decomposition. This makes serialization and document-level operations straightforward.

---

## Dual Storage: Tabular + Vector

Here is where the design gets interesting. A `KnowledgeBase` owns two storage backends:

1. **Tabular storage** (`DocumentTabularStorage`) -- stores complete `Document` objects as serialized JSON, keyed by `doc_id`. This is the source of truth for the full tree structure, metadata, and chunk records. The schema is minimal: `doc_id` (auto-generated) and `data` (the JSON blob).

2. **Vector storage** (`ChunkVectorStorage`) -- stores chunk embeddings alongside their `ChunkRecord` metadata, keyed by `chunk_id`. This is what gets searched. The schema holds `chunk_id`, `doc_id`, a `vector` (typed array), and a `metadata` object containing the full `ChunkRecord`.

These are not redundant. The tabular storage holds the *structure* -- you query it to traverse the tree, find ancestors, or re-index a document. The vector storage holds the *semantics* -- you query it with an embedding vector to find similar chunks. The `KnowledgeBase` class sits above both and coordinates operations:

```typescript
const kb = await createKnowledgeBase({
  name: "research-papers",
  vectorDimensions: 1024,
});

// Store a document (tree + chunks go to tabular storage)
const doc = new Document(root, { title: "My Paper" }, chunks);
await kb.upsertDocument(doc);

// Store chunk embeddings (vectors go to vector storage)
await kb.upsertChunksBulk(chunkVectorEntities);

// Search by semantic similarity (queries vector storage)
const results = await kb.similaritySearch(queryVector, { topK: 5 });

// Traverse the tree (queries tabular storage)
const ancestors = await kb.getAncestors(docId, nodeId);
```

Cascading deletes are built in: `deleteDocument(doc_id)` removes the document from tabular storage *and* all its chunks from vector storage. `prepareReindex(doc_id)` deletes chunks but keeps the document, ready for re-embedding with a different model.

---

## The KnowledgeBase as Unified API

The `KnowledgeBase` class is intentionally the single entry point for all document and chunk operations. It provides:

- **Document CRUD**: `upsertDocument`, `getDocument`, `deleteDocument`, `listDocuments`
- **Tree traversal**: `getNode` (find a node by ID), `getAncestors` (path from root to target)
- **Chunk operations**: `upsertChunk`, `upsertChunksBulk`, `getChunk`, `getAllChunks`, `clearChunks`
- **Search**: `similaritySearch` (pure vector), `hybridSearch` (vector + full-text, backend-dependent)
- **Lifecycle**: `setupDatabase`, `destroy`, `prepareReindex`

Knowledge bases register globally via `registerKnowledgeBase(id, kb)` and can be resolved by string ID at runtime. This is critical for the task system: RAG tasks reference knowledge bases by name (e.g., `"research-papers"`), and the framework's input resolver system transparently looks up the live `KnowledgeBase` instance. The `TypeKnowledgeBase()` schema helper encodes this contract -- inputs accept either a string ID or a direct instance, and the resolver handles the rest.

The factory function `createKnowledgeBase` wires up in-memory storage by default, but the design is backend-agnostic. Swap in SQLite tabular storage and PostgreSQL vector storage (with pgvector) for production, and the `KnowledgeBase` API stays identical.

---

## RAG Pipeline as Composable Tasks

With the storage layer in place, Workglow expresses the entire RAG pipeline as a graph of composable tasks. Each task handles one well-defined step, and they snap together via the standard task-graph dataflow mechanism.

### ChunkToVectorTask

Bridges chunking and embedding. Takes an array of `ChunkRecord` objects and their corresponding embedding vectors, and produces vector-store-ready output: IDs, vectors, and metadata (including `leafNodeId`, `depth`, `nodePath`, and optional enrichments like summaries and entities). This task does not call an embedding model -- it *pairs* chunks with pre-computed embeddings, keeping concerns separated.

### ChunkVectorUpsertTask

Takes the output of `ChunkToVectorTask` (or any source of vectors + metadata) and writes them into a `KnowledgeBase`. Supports single and bulk upserts, validates vector dimensions against the knowledge base configuration, and returns the chunk IDs of stored vectors. Marked as non-cacheable because it has side effects.

### ChunkRetrievalTask

The end-to-end retrieval workhorse. Accepts a query (string or pre-computed vector), a knowledge base, and search parameters (`topK`, `scoreThreshold`, metadata filters). If the query is a string, it automatically spawns a `TextEmbeddingTask` to generate the query vector -- you just specify the model. Returns chunks, IDs, metadata, scores, and optionally the raw vectors.

### ChunkVectorSearchTask

A lower-level alternative to `ChunkRetrievalTask` that takes a pre-computed query vector directly. Returns matching vectors, metadata, and scores. Useful when you have already embedded the query or want to search with a modified vector.

### ChunkVectorHybridSearchTask

Combines vector similarity with full-text keyword matching. Takes both a `queryVector` and a `queryText`, with a configurable `vectorWeight` (default 0.7) that controls the balance between semantic and lexical relevance. Requires a storage backend that supports hybrid search (such as PostgreSQL with pgvector and full-text search).

### HierarchyJoinTask

This is where the tree-plus-flat duality pays off. After retrieval returns a set of chunks with their metadata, `HierarchyJoinTask` walks back up the document tree for each chunk, collecting:

- **Parent summaries**: AI-generated summaries from ancestor nodes, giving the LLM broader context about the section a chunk lives in.
- **Section titles**: The breadcrumb trail of section headers, enabling source attribution like "Architecture > Storage Layer > Vector Index."
- **Aggregated entities**: Named entities extracted from the full ancestor chain, deduplicated by name with the highest confidence score retained.

The task uses the `KnowledgeBase.getAncestors()` method, which traverses the persisted document tree in tabular storage. This means hierarchy enrichment works even if the original document object is no longer in memory.

### Composing the Pipeline

Because these are standard Workglow tasks, you compose them with dataflows in a task graph or with the high-level `Workflow` builder:

```
Parse Document
    |
    v
Hierarchical Chunker --> TextEmbeddingTask
    |                         |
    v                         v
    +-------> ChunkToVectorTask
                    |
                    v
           ChunkVectorUpsertTask
```

And at query time:

```
User Query --> ChunkRetrievalTask --> HierarchyJoinTask --> LLM Prompt
```

Each arrow is a dataflow. Each box is a task. The graph handles execution order, error propagation, and caching automatically.

---

## Why Tree + Flat Duality Matters

The dual representation is not just an implementation detail -- it unlocks capabilities that flat-chunk RAG cannot provide.

**Hierarchical reranking.** When multiple chunks match a query, you can boost chunks that share a section. If three of your top-5 results come from "Section 3.2: Authentication," that section is probably highly relevant. Without tree structure, you cannot detect this clustering.

**Source attribution.** Every chunk carries its `nodePath` and `sectionTitles`. You can tell the user exactly where an answer came from: "Based on *API Reference > Rate Limiting > Retry Behavior*, paragraph 3." This is table stakes for trustworthy AI applications.

**Context window optimization.** Instead of stuffing the prompt with raw chunks, you can use `parentSummaries` to give the LLM a map of the document. "This chunk is from a section about authentication. The section's summary is: ..." This lets the model reason about context without consuming tokens on full parent text.

**Selective re-indexing.** Need to re-embed a document with a new model? `prepareReindex` clears the vector storage for that document while keeping the tree intact. Chunking is deterministic from the tree, so you only re-run embedding -- not parsing.

**Cascading consistency.** Delete a document, and its chunks vanish from vector storage automatically. No orphaned vectors, no stale search results, no manual cleanup.

The `KnowledgeBase` class, with its dual-storage backbone and task-graph integration, makes these capabilities feel natural. You do not need to wire up custom logic to keep trees and vectors in sync. The framework handles it, and you compose your pipeline from the pieces that matter for your use case.

---

## Looking Ahead

The current architecture opens the door to further enhancements: topic segmentation (the `TopicNode` type is already in the schema), multi-document knowledge graphs built from entity cross-references, and incremental re-indexing where only changed sections get re-embedded. The tree structure makes all of these tractable because the document's organization is a first-class citizen, not an afterthought reconstructed from character offsets.

RAG does not have to mean "throw text at a vector database and hope for the best." With a proper document model, dual storage, and composable pipeline tasks, you can build retrieval systems that are precise, explainable, and maintainable. That is what Workglow's Knowledge Base is designed for.
