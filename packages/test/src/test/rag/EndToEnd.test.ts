/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Complete End-to-End RAG Pipeline Test
 *
 * This test demonstrates a full RAG pipeline using single, composable workflows:
 *
 * Stage 1 - Document Ingestion Pipeline:
 *   FileLoader → StructuralParser → DocumentEnricher → HierarchicalChunker
 *   → TextEmbedding → ChunkToVector → ChunkVectorUpsert
 *
 * Stage 2 - Query Retrieval Pipeline with RAG Tasks:
 *   ChunkRetrieval → Reranker → ContextBuilder
 *
 * All 6 RAG Tasks Demonstrated (category = "RAG"):
 *   1. ChunkRetrievalTask - Embed query and search vector store for similar chunks
 *   2. RerankerTask - Rerank retrieved chunks to improve relevance
 *   3. ContextBuilderTask - Format chunks into context for LLM prompts
 *   4. QueryExpanderTask - Generate query variations for improved recall
 *   5. ChunkVectorHybridSearchTask - Combined vector + full-text search
 *   6. HierarchyJoinTask - Enrich results with document hierarchy context
 *
 * KNOWN GAPS (workflow auto-connect limitations):
 * - QueryExpander → ChunkRetrieval: field name mismatch (`queries` vs `query`)
 * - ChunkRetrieval → Reranker: `query` must be provided explicitly
 *
 * Models Used:
 *   - Qwen3 Embedding 0.6B (1024D) for text embedding
 *
 * Sample Document:
 *   - history_of_the_united_states.md
 */

import {
  ChunkRetrievalTaskOutput,
  ContextBuilderTaskOutput,
  HierarchyJoinTaskOutput,
  HybridSearchTaskOutput,
  InMemoryModelRepository,
  QueryExpanderTaskOutput,
  RerankerTaskOutput,
  setGlobalModelRepository,
  TextEmbeddingTaskOutput,
} from "@workglow/ai";
import { register_HFT_InlineJobFns } from "@workglow/ai-provider";
import {
  DocumentChunk,
  DocumentChunkDataset,
  DocumentChunkPrimaryKey,
  DocumentChunkSchema,
  DocumentDataset,
  DocumentStorageKey,
  DocumentStorageSchema,
  registerDocumentChunkDataset,
  registerDocumentDataset,
} from "@workglow/dataset";
import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import { getTaskQueueRegistry, setTaskQueueRegistry, Workflow } from "@workglow/task-graph";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerHuggingfaceLocalModels } from "../../samples";
export { FileLoaderTask } from "@workglow/tasks";

describe("End-to-End RAG Pipeline", () => {
  // Configuration
  const embeddingModel = "onnx:Qwen3-Embedding-0.6B:auto";
  const vectorDatasetName = "e2e-rag-test-dataset";
  const documentDatasetName = "e2e-rag-document-dataset";
  const sampleFileName = "history_of_the_united_states.md";

  // Storage
  let vectorStorage: InMemoryVectorStorage<
    typeof DocumentChunkSchema,
    typeof DocumentChunkPrimaryKey,
    Record<string, unknown>,
    Float32Array,
    DocumentChunk
  >;
  let vectorDataset: DocumentChunkDataset;
  let documentTabularStorage: InMemoryTabularStorage<
    typeof DocumentStorageSchema,
    typeof DocumentStorageKey
  >;
  let documentDataset: DocumentDataset;

  beforeAll(async () => {
    // Setup task queue and model repository
    setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await register_HFT_InlineJobFns();
    await registerHuggingfaceLocalModels();

    // Setup vector storage with 1024 dimensions for Qwen3 model
    vectorStorage = new InMemoryVectorStorage<
      typeof DocumentChunkSchema,
      typeof DocumentChunkPrimaryKey,
      Record<string, unknown>,
      Float32Array,
      DocumentChunk
    >(DocumentChunkSchema, DocumentChunkPrimaryKey, [], 1024, Float32Array);
    await vectorStorage.setupDatabase();
    vectorDataset = new DocumentChunkDataset(vectorStorage);

    // Setup tabular storage for document hierarchy (needed for HierarchyJoinTask)
    documentTabularStorage = new InMemoryTabularStorage<
      typeof DocumentStorageSchema,
      typeof DocumentStorageKey
    >(DocumentStorageSchema, DocumentStorageKey);
    await documentTabularStorage.setupDatabase();
    documentDataset = new DocumentDataset(documentTabularStorage, vectorStorage);

    // Register datasets for use in workflows
    registerDocumentChunkDataset(vectorDatasetName, vectorDataset);
    registerDocumentDataset(documentDatasetName, documentDataset);
  });

  afterAll(async () => {
    getTaskQueueRegistry().stopQueues().clearQueues();
    setTaskQueueRegistry(null);
  });

  it("should ingest document through complete pipeline", async () => {
    // Get the path to the sample file
    const sampleFilePath = join(__dirname, sampleFileName);

    console.log(`\n=== Stage 1: Document Ingestion ===`);
    console.log(`Processing: ${sampleFileName}`);

    // Complete ingestion workflow as a single chain:
    // fileLoader → structuralParser → documentEnricher → hierarchicalChunker
    // → textEmbedding → chunkToVector → chunkVectorUpsert
    //
    // NOTE: ChunkToVectorTask needs inputs from multiple earlier tasks:
    // - chunks from HierarchicalChunkerTask
    // - vectors from TextEmbeddingTask
    // The workflow auto-connect only looks back for REQUIRED inputs,
    // but ChunkToVectorTask has required: []. This needs to be fixed in the task.
    //
    // For now, we manually connect the dataflows after building the workflow.
    const ingestionWorkflow = new Workflow()
      .fileLoader({
        url: `file://${sampleFilePath}`,
        format: "markdown",
      })
      .structuralParser({
        title: "A Concise History of the United States of America",
        format: "markdown",
        sourceUri: sampleFilePath,
      })
      .documentEnricher({
        generateSummaries: false, // Keep test faster
        extractEntities: false,
      })
      .hierarchicalChunker({
        maxTokens: 512,
        overlap: 50,
        strategy: "hierarchical",
      })
      .textEmbedding({
        model: embeddingModel,
      })
      .chunkToVector()
      .chunkVectorUpsert({
        dataset: vectorDatasetName,
      });

    // Verify workflow was built correctly (no errors during construction)
    expect(ingestionWorkflow.error).toBe("");

    // Run the ingestion workflow
    const result = await ingestionWorkflow.run();

    // Verify results
    expect(result).toBeDefined();
    expect(result.count).toBeGreaterThan(0);
    expect(result.doc_id).toBeDefined();
    expect(result.chunk_ids).toBeDefined();
    expect(result.chunk_ids.length).toBe(result.count);

    console.log(`  → Document ID: ${result.doc_id}`);
    console.log(`  → Stored ${result.count} vectors`);
    console.log(`  → Chunk IDs: ${result.chunk_ids.slice(0, 3).join(", ")}...`);
  }, 60000); // 1 minute timeout for model download and processing

  it("should retrieve relevant chunks via query workflow", async () => {
    const query = "What caused the Civil War?";

    console.log(`\n=== Stage 2: Query Retrieval ===`);
    console.log(`Query: "${query}"`);

    // Working retrieval workflow: chunkRetrieval → reranker → contextBuilder
    // Note: QueryExpander cannot auto-connect to ChunkRetrieval (queries vs query).
    // Note: RerankerTask requires `query` which ChunkRetrievalTask doesn't output,
    // so we must provide it explicitly. See KNOWN GAP in file header.
    const retrievalWorkflow = new Workflow()
      .chunkRetrieval({
        dataset: vectorDatasetName,
        query,
        model: embeddingModel,
        topK: 10,
        scoreThreshold: 0.1,
      })
      .reranker({
        query, // Must provide explicitly - not auto-connected from ChunkRetrieval
        method: "simple",
        topK: 5,
      })
      .contextBuilder({
        format: "numbered",
        includeMetadata: false,
        separator: "\n\n---\n\n",
      });

    // Verify workflow was built correctly
    expect(retrievalWorkflow.error).toBe("");

    // Run the retrieval workflow
    const result = (await retrievalWorkflow.run()) as ContextBuilderTaskOutput;

    // Verify results from ContextBuilder
    expect(result).toBeDefined();
    expect(result.context).toBeDefined();
    expect(typeof result.context).toBe("string");
    expect(result.context.length).toBeGreaterThan(0);
    expect(result.chunksUsed).toBeGreaterThan(0);
    expect(result.chunksUsed).toBeLessThanOrEqual(5);
    expect(result.totalLength).toBe(result.context.length);

    console.log(`  → Built context from ${result.chunksUsed} chunks`);
    console.log(`  → Total context length: ${result.totalLength} characters`);
    console.log(`  → Context preview (first 300 chars):`);
    console.log(`       ${result.context.substring(0, 300)}...`);

    // Verify the context contains Civil War content
    const contextLower = result.context.toLowerCase();
    const relevantTerms = [
      "civil",
      "war",
      "slavery",
      "union",
      "confederate",
      "secession",
      "lincoln",
    ];
    const hasRelevantContent = relevantTerms.some((term) => contextLower.includes(term));
    expect(hasRelevantContent).toBe(true);
  }, 120000); // 2 minute timeout

  it("should answer questions about US history", async () => {
    // Use broader terms that are more likely to appear in semantic results
    const questions = [
      {
        query: "When did the American Revolution begin?",
        expectedTerms: ["revolution", "colonial", "1775", "independence", "british", "war"],
      },
      {
        query: "What was the Great Depression?",
        expectedTerms: ["depression", "economic", "1929", "crash", "new deal", "federal"],
      },
      {
        query: "Who led the Continental Army?",
        expectedTerms: ["washington", "army", "continental", "military", "war", "general"],
      },
    ];

    console.log(`\n=== Quality Verification ===`);

    let totalQueriesWithResults = 0;

    for (const { query, expectedTerms } of questions) {
      console.log(`\nQuery: "${query}"`);

      // Simple retrieval for each question
      const workflow = new Workflow().chunkRetrieval({
        dataset: vectorDatasetName,
        query,
        model: embeddingModel,
        topK: 3,
        scoreThreshold: 0.0, // Lower threshold for better recall
      });

      const result = (await workflow.run()) as ChunkRetrievalTaskOutput;

      expect(result.chunks).toBeDefined();

      if (result.chunks.length === 0) {
        console.log(`  → No chunks found`);
        continue;
      }

      console.log(`  → Found ${result.chunks.length} chunks`);
      console.log(`  → First chunk preview: ${result.chunks[0].substring(0, 100)}...`);

      // Check if relevant content was retrieved
      const allChunksText = result.chunks.join(" ").toLowerCase();
      const foundTerms = expectedTerms.filter((term) => allChunksText.includes(term.toLowerCase()));

      console.log(`  → Matched terms: ${foundTerms.join(", ") || "none"}`);

      if (foundTerms.length > 0) {
        totalQueriesWithResults++;
      }
    }

    // At least one query should return relevant results
    // (Semantic search may not always return exact keyword matches)
    expect(totalQueriesWithResults).toBeGreaterThanOrEqual(1);
  }, 180000); // 3 minute timeout

  it("should use QueryExpander to generate query variations", async () => {
    const query = "What were the major battles of World War II?";

    console.log(`\n=== QueryExpander RAG Task ===`);
    console.log(`Original query: "${query}"`);

    // Use QueryExpander to generate multiple query variations
    // This improves retrieval coverage by searching with different phrasings
    const expanderWorkflow = new Workflow().queryExpander({
      query,
      method: "multi-query",
      numVariations: 3,
    });

    expect(expanderWorkflow.error).toBe("");

    const expanderResult = (await expanderWorkflow.run()) as QueryExpanderTaskOutput;

    // Verify QueryExpander results
    expect(expanderResult).toBeDefined();
    expect(expanderResult.queries).toBeDefined();
    expect(Array.isArray(expanderResult.queries)).toBe(true);
    expect(expanderResult.queries.length).toBeGreaterThan(1);
    expect(expanderResult.originalQuery).toBe(query);
    expect(expanderResult.method).toBe("multi-query");
    expect(expanderResult.count).toBe(expanderResult.queries.length);

    console.log(`  → Generated ${expanderResult.count} query variations:`);
    for (const q of expanderResult.queries) {
      console.log(`     - "${q}"`);
    }

    // Now use the expanded queries to retrieve chunks
    // Since QueryExpander outputs `queries` array but ChunkRetrieval expects `query`,
    // we need to manually connect them (known gap in workflow auto-connect)
    console.log(`\n  → Retrieving chunks for each query variation:`);
    let totalChunksFound = 0;

    for (const expandedQuery of expanderResult.queries.slice(0, 2)) {
      const retrievalWorkflow = new Workflow()
        .chunkRetrieval({
          dataset: vectorDatasetName,
          query: expandedQuery,
          model: embeddingModel,
          topK: 3,
          scoreThreshold: 0.0,
        })
        .reranker({
          query: expandedQuery,
          method: "simple",
          topK: 2,
        });

      const result = (await retrievalWorkflow.run()) as RerankerTaskOutput;
      totalChunksFound += result.count;
      console.log(`     Query: "${expandedQuery.substring(0, 50)}..." → ${result.count} chunks`);
    }

    expect(totalChunksFound).toBeGreaterThan(0);
    console.log(`  → Total chunks retrieved across variations: ${totalChunksFound}`);
  }, 180000); // 3 minute timeout

  it("should use ContextBuilder with different formats", async () => {
    const query = "What was the Declaration of Independence?";

    console.log(`\n=== ContextBuilder Format Options ===`);
    console.log(`Query: "${query}"`);

    // First, retrieve chunks
    const retrievalWorkflow = new Workflow().chunkRetrieval({
      dataset: vectorDatasetName,
      query,
      model: embeddingModel,
      topK: 3,
      scoreThreshold: 0.0,
    });

    const retrievalResult = (await retrievalWorkflow.run()) as ChunkRetrievalTaskOutput;
    expect(retrievalResult.chunks.length).toBeGreaterThan(0);

    console.log(`  → Retrieved ${retrievalResult.count} chunks`);

    // Test different ContextBuilder formats
    const formats = ["simple", "numbered", "xml", "markdown"] as const;

    for (const format of formats) {
      const contextWorkflow = new Workflow().contextBuilder({
        chunks: retrievalResult.chunks,
        scores: retrievalResult.scores,
        format,
        includeMetadata: format !== "simple",
        maxLength: 1000,
      });

      expect(contextWorkflow.error).toBe("");

      const contextResult = (await contextWorkflow.run()) as ContextBuilderTaskOutput;

      expect(contextResult.context).toBeDefined();
      expect(contextResult.chunksUsed).toBeGreaterThan(0);

      console.log(`\n  → Format: ${format}`);
      console.log(`     Chunks used: ${contextResult.chunksUsed}`);
      console.log(`     Total length: ${contextResult.totalLength} chars`);
      console.log(
        `     Preview: ${contextResult.context.substring(0, 150).replace(/\n/g, "\\n")}...`
      );
    }
  }, 120000); // 2 minute timeout

  it("should use ChunkVectorHybridSearchTask for combined vector + text search", async () => {
    const query = "Civil War slavery abolition Lincoln";

    console.log(`\n=== ChunkVectorHybridSearchTask ===`);
    console.log(`Query: "${query}"`);

    // First, compute the query vector using TextEmbedding
    // HybridSearch requires both a pre-computed vector and text query
    const embeddingWorkflow = new Workflow().textEmbedding({
      text: query,
      model: embeddingModel,
    });

    const embeddingResult = (await embeddingWorkflow.run()) as TextEmbeddingTaskOutput;
    expect(embeddingResult.vector).toBeDefined();

    const queryVector = embeddingResult.vector as Float32Array;
    console.log(`  → Computed query vector (${queryVector.length} dimensions)`);

    // Now use hybrid search combining vector similarity with text matching
    const hybridWorkflow = new Workflow().hybridSearch({
      dataset: vectorDatasetName,
      queryVector,
      queryText: query,
      topK: 5,
      vectorWeight: 0.7, // 70% vector similarity, 30% text matching
      scoreThreshold: 0.0,
    });

    expect(hybridWorkflow.error).toBe("");

    const result = (await hybridWorkflow.run()) as HybridSearchTaskOutput;

    // Verify hybrid search results
    expect(result).toBeDefined();
    expect(result.chunks).toBeDefined();
    expect(Array.isArray(result.chunks)).toBe(true);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks.length).toBeLessThanOrEqual(5);
    expect(result.ids).toBeDefined();
    expect(result.scores).toBeDefined();
    expect(result.count).toBe(result.chunks.length);

    console.log(`  → Hybrid search found ${result.count} chunks`);
    console.log(
      `  → Top scores: ${result.scores
        .slice(0, 3)
        .map((s) => s.toFixed(3))
        .join(", ")}`
    );

    // Verify content is relevant
    const allChunksText = result.chunks.join(" ").toLowerCase();
    const relevantTerms = ["civil", "war", "slavery", "lincoln", "union", "emancipation"];
    const foundTerms = relevantTerms.filter((term) => allChunksText.includes(term));

    console.log(`  → Matched terms: ${foundTerms.join(", ")}`);
    expect(foundTerms.length).toBeGreaterThan(0);

    // Show first chunk preview
    if (result.chunks.length > 0) {
      console.log(`  → First chunk: ${result.chunks[0].substring(0, 150)}...`);
    }
  }, 120000); // 2 minute timeout

  it("should use HierarchyJoinTask to enrich results with document context", async () => {
    const query = "American Revolution independence";

    console.log(`\n=== HierarchyJoinTask ===`);
    console.log(`Query: "${query}"`);

    // First, retrieve chunks with metadata
    const hierarchyWorkflow = new Workflow()
      .chunkRetrieval({
        dataset: vectorDatasetName,
        query,
        model: embeddingModel,
        topK: 3,
        scoreThreshold: 0.0,
      })
      .hierarchyJoin({
        documents: documentDatasetName,
        includeParentSummaries: true,
        includeEntities: true,
      });

    expect(hierarchyWorkflow.error).toBe("");

    const result = (await hierarchyWorkflow.run()) as HierarchyJoinTaskOutput;

    // Verify hierarchy join results
    expect(result).toBeDefined();
    expect(result.chunks).toBeDefined();
    expect(result.chunk_ids).toBeDefined();
    expect(result.metadata).toBeDefined();
    expect(result.scores).toBeDefined();
    expect(result.count).toBe(result.chunks.length);

    console.log(`  → HierarchyJoin processed ${result.count} chunks`);

    // Check if metadata was enriched (may have parentSummaries, sectionTitles, entities)
    for (let i = 0; i < Math.min(result.metadata.length, 2); i++) {
      const meta = result.metadata[i] as Record<string, unknown>;
      console.log(`  → Chunk ${i + 1} metadata keys: ${Object.keys(meta).join(", ")}`);

      if (meta.parentSummaries) {
        console.log(`     - Has ${(meta.parentSummaries as string[]).length} parent summaries`);
      }
      if (meta.sectionTitles) {
        console.log(`     - Section titles: ${(meta.sectionTitles as string[]).join(" > ")}`);
      }
      if (meta.entities) {
        console.log(`     - Has ${(meta.entities as unknown[]).length} entities`);
      }
    }
  }, 120000); // 2 minute timeout

  it("should demonstrate workflow composability", async () => {
    console.log(`\n=== Workflow Composability Test ===`);

    // Test that we can build and verify workflows without running them
    const ingestionWorkflow = new Workflow()
      .fileLoader({ url: "file:///test.md", format: "markdown" })
      .structuralParser({ title: "Test" })
      .documentEnricher({})
      .hierarchicalChunker({ maxTokens: 512 })
      .textEmbedding({ model: embeddingModel })
      .chunkToVector({})
      .chunkVectorUpsert({ dataset: vectorDatasetName });

    // Verify the workflow graph structure
    const tasks = ingestionWorkflow.graph.getTasks();
    expect(tasks.length).toBe(7);

    const taskTypes = tasks.map((t) => t.type);
    expect(taskTypes).toContain("FileLoaderTask");
    expect(taskTypes).toContain("StructuralParserTask");
    expect(taskTypes).toContain("DocumentEnricherTask");
    expect(taskTypes).toContain("HierarchicalChunkerTask");
    expect(taskTypes).toContain("TextEmbeddingTask");
    expect(taskTypes).toContain("ChunkToVectorTask");
    expect(taskTypes).toContain("ChunkVectorUpsertTask");

    console.log(`  → Ingestion workflow has ${tasks.length} tasks`);
    console.log(`  → Task chain: ${taskTypes.join(" → ")}`);

    // Verify dataflows were created
    const dataflows = ingestionWorkflow.graph.getDataflows();
    expect(dataflows.length).toBeGreaterThan(0);

    console.log(`  → Created ${dataflows.length} dataflows between tasks`);

    // Test full retrieval workflow with all RAG tasks:
    // ChunkRetrieval → Reranker → ContextBuilder
    const retrievalWorkflow = new Workflow()
      .chunkRetrieval({ dataset: vectorDatasetName, query: "test", model: embeddingModel })
      .reranker({ query: "test", method: "simple", topK: 5 })
      .contextBuilder({ format: "numbered", includeMetadata: true });

    const retrievalTasks = retrievalWorkflow.graph.getTasks();
    expect(retrievalTasks.length).toBe(3);
    expect(retrievalWorkflow.error).toBe("");

    const retrievalTaskTypes = retrievalTasks.map((t) => t.type);
    expect(retrievalTaskTypes).toContain("ChunkRetrievalTask");
    expect(retrievalTaskTypes).toContain("RerankerTask");
    expect(retrievalTaskTypes).toContain("ContextBuilderTask");

    console.log(`  → Retrieval workflow has ${retrievalTasks.length} RAG tasks`);
    console.log(`  → Task chain: ${retrievalTaskTypes.join(" → ")}`);

    // Test QueryExpander workflow
    const queryExpanderWorkflow = new Workflow().queryExpander({
      query: "test query",
      method: "multi-query",
      numVariations: 3,
    });

    const queryExpanderTasks = queryExpanderWorkflow.graph.getTasks();
    expect(queryExpanderTasks.length).toBe(1);
    expect(queryExpanderWorkflow.error).toBe("");
    expect(queryExpanderTasks[0].type).toBe("QueryExpanderTask");

    console.log(`  → QueryExpander workflow verified`);

    // Test HybridSearch workflow structure
    const hybridSearchWorkflow = new Workflow().hybridSearch({
      dataset: vectorDatasetName,
      queryVector: new Float32Array(1024),
      queryText: "test",
      topK: 5,
    });

    const hybridTasks = hybridSearchWorkflow.graph.getTasks();
    expect(hybridTasks.length).toBe(1);
    expect(hybridSearchWorkflow.error).toBe("");
    expect(hybridTasks[0].type).toBe("ChunkVectorHybridSearchTask");

    console.log(`  → HybridSearch workflow verified`);

    // Test HierarchyJoin workflow structure
    const hierarchyJoinWorkflow = new Workflow().hierarchyJoin({
      documents: documentDatasetName,
      chunks: ["test"],
      chunk_ids: ["id1"],
      metadata: [
        {
          doc_id: "doc1",
          chunkId: "chunk1",
          leafNodeId: "node1",
          depth: 0,
          nodePath: ["root"],
          text: "test",
        },
      ],
      scores: [0.9],
    });

    const hierarchyTasks = hierarchyJoinWorkflow.graph.getTasks();
    expect(hierarchyTasks.length).toBe(1);
    expect(hierarchyJoinWorkflow.error).toBe("");
    expect(hierarchyTasks[0].type).toBe("HierarchyJoinTask");
  });
});
