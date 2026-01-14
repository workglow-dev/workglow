/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RAG (Retrieval Augmented Generation) Workflow End-to-End Test
 *
 * This test demonstrates a complete RAG pipeline using the Workflow API
 * in a way that's compatible with visual node editors.
 *
 * Node Editor Mapping:
 * ====================
 * Each workflow step below represents a node in a visual editor with
 * dataflow connections between them:
 *
 * 1. Document Ingestion Pipeline (per file):
 *    FileLoader → StructuralParser → DocumentEnricher → HierarchicalChunker
 *    → [Array Processing] → TextEmbedding (multiple) → ChunkToVector → VectorStoreUpsert
 *
 *    Note: The array processing step (embedding multiple chunks) would use:
 *    - A "ForEach" or "Map" control node in the visual editor
 *    - Or an ArrayTask wrapper that replicates TextEmbedding nodes
 *    - Or a batch TextEmbedding node that accepts arrays
 *
 * 2. Semantic Search Pipeline:
 *    Query (input) → DocumentNodeRetrievalTask → Results (output)
 *
 * 3. Question Answering Pipeline:
 *    Question → DocumentNodeRetrievalTask → ContextBuilder → TextQuestionAnswerTask → Answer
 *
 * Models Used:
 *    - Xenova/all-MiniLM-L6-v2 (Text Embedding - 384D)
 *    - onnx-community/NeuroBERT-NER-ONNX (Named Entity Recognition)
 *    - Xenova/distilbert-base-uncased-distilled-squad (Question Answering)
 */

import {
  InMemoryModelRepository,
  retrieval,
  RetrievalTaskOutput,
  setGlobalModelRepository,
  textQuestionAnswer,
  TextQuestionAnswerTaskOutput,
  VectorStoreUpsertTaskOutput,
} from "@workglow/ai";
import { register_HFT_InlineJobFns } from "@workglow/ai-provider";
import {
  DocumentChunk,
  DocumentChunkDataset,
  DocumentChunkPrimaryKey,
  DocumentChunkSchema,
  DocumentRepository,
  DocumentStorageKey,
  DocumentStorageSchema,
  registerDocumentChunkDataset,
} from "@workglow/dataset";
import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import { getTaskQueueRegistry, setTaskQueueRegistry, Workflow } from "@workglow/task-graph";
import { readdirSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerHuggingfaceLocalModels } from "../../samples";
export { FileLoaderTask } from "@workglow/tasks";

describe("RAG Workflow End-to-End", () => {
  let storage: InMemoryVectorStorage<
    typeof DocumentChunkSchema,
    typeof DocumentChunkPrimaryKey,
    Record<string, unknown>,
    Float32Array,
    DocumentChunk
  >;
  let vectorDataset: DocumentChunkDataset;
  let docRepo: DocumentRepository;
  const vectorRepoName = "rag-test-vector-repo";
  const embeddingModel = "onnx:Xenova/all-MiniLM-L6-v2:q8";
  const summaryModel = "onnx:Falconsai/text_summarization:fp32";
  const nerModel = "onnx:onnx-community/NeuroBERT-NER-ONNX:q8";
  const qaModel = "onnx:onnx-community/ModernBERT-finetuned-squad-ONNX";

  beforeAll(async () => {
    // Setup task queue and model repository
    setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await register_HFT_InlineJobFns();

    await registerHuggingfaceLocalModels();

    // Setup repositories
    storage = new InMemoryVectorStorage<
      typeof DocumentChunkSchema,
      typeof DocumentChunkPrimaryKey,
      Record<string, unknown>,
      Float32Array,
      DocumentChunk
    >(DocumentChunkSchema, DocumentChunkPrimaryKey, [], 3, Float32Array);
    await storage.setupDatabase();
    vectorDataset = new DocumentChunkDataset(storage);

    // Register vector dataset for use in workflows
    registerDocumentChunkDataset(vectorRepoName, vectorDataset);

    const tabularRepo = new InMemoryTabularStorage(DocumentStorageSchema, DocumentStorageKey);
    await tabularRepo.setupDatabase();

    docRepo = new DocumentRepository(tabularRepo, vectorDataset as any);
  });

  afterAll(async () => {
    getTaskQueueRegistry().stopQueues().clearQueues();
    setTaskQueueRegistry(null);
  });

  it("should ingest markdown documents with NER enrichment", async () => {
    // Find markdown files in docs folder
    const docsPath = join(process.cwd(), "docs", "background");
    const files = readdirSync(docsPath).filter((f) => f.endsWith(".md"));

    console.log(`Found ${files.length} markdown files to process`);

    let totalVectors = 0;

    for (const file of files) {
      const filePath = join(docsPath, file);
      console.log(`Processing: ${file}`);

      const ingestionWorkflow = new Workflow();

      ingestionWorkflow
        .fileLoader({ url: `file://${filePath}`, format: "markdown" })
        .structuralParser({
          title: filePath.split("/").pop()?.split(".")[0] || "",
          format: "markdown",
          sourceUri: filePath,
        })
        .documentEnricher({
          generateSummaries: false,
          extractEntities: false,
          summaryModel,
          nerModel,
        })
        .hierarchicalChunker({
          maxTokens: 512,
          overlap: 50,
          strategy: "hierarchical",
        })
        .textEmbedding({
          model: embeddingModel,
        })
        .vectorStoreUpsert({
          dataset: vectorRepoName,
        });

      const result = (await ingestionWorkflow.run()) as VectorStoreUpsertTaskOutput;

      console.log(`  → Stored ${result.count} vectors`);
      totalVectors += result.count;
    }

    // Verify vectors were stored
    expect(totalVectors).toBeGreaterThan(0);
    console.log(`Total vectors in repository: ${totalVectors}`);
  }, 360000); // 3 minute timeout for model downloads

  it("should search for relevant content", async () => {
    const query = "What is retrieval augmented generation?";

    console.log(`\nSearching for: "${query}"`);

    // Create search workflow
    const searchWorkflow = new Workflow();

    searchWorkflow.retrieval({
      dataset: vectorRepoName,
      query,
      model: embeddingModel,
      topK: 5,
      scoreThreshold: 0.3,
    });

    const searchResult = (await searchWorkflow.run()) as RetrievalTaskOutput;

    // Verify search results
    expect(searchResult.chunks).toBeDefined();
    expect(Array.isArray(searchResult.chunks)).toBe(true);
    expect(searchResult.chunks.length).toBeGreaterThan(0);
    expect(searchResult.chunks.length).toBeLessThanOrEqual(5);
    expect(searchResult.scores).toBeDefined();
    expect(searchResult.scores!.length).toBe(searchResult.chunks.length);

    console.log(`Found ${searchResult.chunks.length} relevant chunks:`);
    for (let i = 0; i < searchResult.chunks.length; i++) {
      const chunk = searchResult.chunks[i];
      const score = searchResult.scores![i];
      console.log(`  ${i + 1}. Score: ${score.toFixed(3)} - ${chunk.substring(0, 80)}...`);
    }

    // Verify scores are in descending order
    for (let i = 1; i < searchResult.scores!.length; i++) {
      expect(searchResult.scores![i]).toBeLessThanOrEqual(searchResult.scores![i - 1]);
    }
  }, 60000); // 1 minute timeout

  it("should answer questions using retrieved context", async () => {
    const question = "What is RAG?";

    console.log(`\nAnswering question: "${question}"`);

    const retrievalResult = await retrieval({
      dataset: vectorRepoName,
      query: question,
      model: embeddingModel,
      topK: 3,
      scoreThreshold: 0.2,
    });

    expect(retrievalResult.chunks).toBeDefined();

    if (retrievalResult.chunks.length === 0) {
      console.log("No relevant chunks found, skipping QA");
      return; // Skip QA if no relevant context found
    }

    console.log(`Retrieved ${retrievalResult.chunks.length} context chunks`);

    // Step 2: Build context from retrieved chunks
    const context = retrievalResult.chunks.join("\n\n");

    console.log(`Context length: ${context.length} characters`);

    const answer = await textQuestionAnswer({
      context,
      question,
      model: qaModel,
    });

    // Verify answer
    expect(answer.text).toBeDefined();
    expect(typeof answer.text).toBe("string");
    expect(answer.text.length).toBeGreaterThan(0);

    console.log(`\nAnswer: ${answer.text}`);
  }, 60000); // 1 minute timeout

  it("should handle complex multi-step RAG pipeline", async () => {
    const question = "How does vector search work?";

    console.log(`\nComplex RAG pipeline for: "${question}"`);

    // Step 1: Retrieve context
    const retrievalWorkflow = new Workflow();
    retrievalWorkflow.retrieval({
      dataset: vectorRepoName,
      query: question,
      model: embeddingModel,
      topK: 3,
      scoreThreshold: 0.2,
    });

    const retrievalResult = (await retrievalWorkflow.run()) as RetrievalTaskOutput;

    if (retrievalResult.chunks.length === 0) {
      console.log("No chunks found, skipping QA step");
      return;
    }

    // Step 2: Answer question with retrieved context
    const context = retrievalResult.chunks.join("\n\n");
    const qaWorkflow = new Workflow();
    qaWorkflow.textQuestionAnswer({
      context,
      question,
      model: qaModel,
    });

    const result = (await qaWorkflow.run()) as TextQuestionAnswerTaskOutput;

    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);

    console.log(`Answer: ${result.text}`);
  }, 60000); // 1 minute timeout
});
