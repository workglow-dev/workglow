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
 *    Query (input) → RetrievalTask → Results (output)
 *
 * 3. Question Answering Pipeline:
 *    Question → RetrievalTask → ContextBuilder → TextQuestionAnswerTask → Answer
 *
 * Models Used:
 *    - Xenova/all-MiniLM-L6-v2 (Text Embedding - 384D)
 *    - onnx-community/NeuroBERT-NER-ONNX (Named Entity Recognition)
 *    - Xenova/distilbert-base-uncased-distilled-squad (Question Answering)
 */

import {
  DocumentRepository,
  DocumentStorageSchema,
  getGlobalModelRepository,
  HierarchicalChunkerTaskOutput,
  InMemoryModelRepository,
  RetrievalTaskOutput,
  setGlobalModelRepository,
  TextEmbeddingTaskOutput,
  TextQuestionAnswerTaskOutput,
  VectorStoreUpsertTaskOutput,
} from "@workglow/ai";
import {
  HF_TRANSFORMERS_ONNX,
  HfTransformersOnnxModelRecord,
  register_HFT_InlineJobFns,
} from "@workglow/ai-provider";
import {
  InMemoryTabularRepository,
  InMemoryVectorRepository,
  registerVectorRepository,
} from "@workglow/storage";
import { getTaskQueueRegistry, setTaskQueueRegistry, Workflow } from "@workglow/task-graph";
import { FileLoaderTask } from "@workglow/tasks";
import { readdirSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("RAG Workflow End-to-End", () => {
  let vectorRepo: InMemoryVectorRepository;
  let docRepo: DocumentRepository;
  const vectorRepoName = "rag-test-vector-repo";
  const embeddingModel = "onnx:Xenova/all-MiniLM-L6-v2:q8";
  const nerModel = "onnx:onnx-community/NeuroBERT-NER-ONNX:q8";
  const qaModel = "onnx:Xenova/distilbert-base-uncased-distilled-squad:q8";

  beforeAll(async () => {
    // Setup task queue and model repository
    setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await register_HFT_InlineJobFns();

    // Register ONNX models
    const models: HfTransformersOnnxModelRecord[] = [
      {
        model_id: embeddingModel,
        title: "All MiniLM L6 V2 384D",
        description: "Xenova/all-MiniLM-L6-v2",
        tasks: ["TextEmbeddingTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "feature-extraction",
          model_path: "Xenova/all-MiniLM-L6-v2",
          native_dimensions: 384,
        },
        metadata: {},
      },
      {
        model_id: nerModel,
        title: "NeuroBERT NER",
        description: "onnx-community/NeuroBERT-NER-ONNX",
        tasks: ["TextNamedEntityRecognitionTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "token-classification",
          model_path: "onnx-community/NeuroBERT-NER-ONNX",
        },
        metadata: {},
      },
      {
        model_id: qaModel,
        title: "distilbert-base-uncased-distilled-squad",
        description: "Xenova/distilbert-base-uncased-distilled-squad quantized to 8bit",
        tasks: ["TextQuestionAnswerTask"],
        provider: HF_TRANSFORMERS_ONNX,
        provider_config: {
          pipeline: "question-answering",
          model_path: "Xenova/distilbert-base-uncased-distilled-squad",
        },
        metadata: {},
      },
    ];

    for (const model of models) {
      await getGlobalModelRepository().addModel(model);
    }

    // Setup repositories
    vectorRepo = new InMemoryVectorRepository();
    await vectorRepo.setupDatabase();

    // Register vector repository for use in workflows
    registerVectorRepository(vectorRepoName, vectorRepo);

    const tabularRepo = new InMemoryTabularRepository(DocumentStorageSchema, ["docId"]);
    await tabularRepo.setupDatabase();

    docRepo = new DocumentRepository(tabularRepo, vectorRepo);
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

    // Process first 2 files for testing (to keep test fast)
    const filesToProcess = files.slice(0, 8);

    let totalVectors = 0;

    // NODE EDITOR MAPPING:
    // In a visual node editor, this loop would be replaced by either:
    // - Multiple FileLoader nodes (one per file), or
    // - A "ForEach File" control flow node that iterates the pipeline
    for (const file of filesToProcess) {
      const filePath = join(docsPath, file);
      console.log(`Processing: ${file}`);

      // Step 1: Load file
      // NODE: FileLoaderTask
      const fileLoader = new FileLoaderTask({ url: `file://${filePath}`, format: "markdown" });
      const fileContent = await fileLoader.run();
      expect(fileContent.text).toBeDefined();

      // Step 2-4: Parse, enrich, and chunk
      // NODES: StructuralParserTask → DocumentEnricherTask → HierarchicalChunkerTask
      // DATAFLOWS: text → documentTree → documentTree → chunks[]
      const ingestionWorkflow = new Workflow();
      ingestionWorkflow
        .structuralParser({
          text: fileContent.text!,
          title: fileContent.metadata.title,
          format: "markdown",
          sourceUri: filePath,
        })
        .documentEnricher({
          generateSummaries: false,
          extractEntities: true,
          nerModel,
        })
        .hierarchicalChunker({
          maxTokens: 512,
          overlap: 50,
          strategy: "hierarchical",
        });

      const chunkResult = (await ingestionWorkflow.run()) as HierarchicalChunkerTaskOutput;
      console.log(`  → Generated ${chunkResult.chunks.length} chunks`);

      // Step 5: Generate embeddings for array of chunks
      // NODE EDITOR: This array processing would use one of:
      //   - ArrayTask wrapper around TextEmbeddingTask (processes each item)
      //   - ForEach control node that replicates TextEmbedding node per chunk
      //   - Batch TextEmbedding node that accepts text[] array
      const embeddingWorkflows = chunkResult.text.map((text) => {
        const embeddingWf = new Workflow();
        embeddingWf.textEmbedding({
          text,
          model: embeddingModel,
        });
        return embeddingWf.run();
      });

      const embeddingResults = await Promise.all(embeddingWorkflows);
      const vectors = embeddingResults.map((r) => (r as TextEmbeddingTaskOutput).vector);

      // Step 6-7: Transform and store vectors
      // NODES: ChunkToVectorTask → VectorStoreUpsertTask
      // DATAFLOWS: chunks[] + vectors[] → ids[] + vectors[] + metadata[] → count
      const storeWorkflow = new Workflow();
      storeWorkflow
        .chunkToVector({
          docId: chunkResult.docId,
          chunks: chunkResult.chunks,
          vectors,
        })
        .vectorStoreUpsert({
          repository: vectorRepoName,
        });

      const result = (await storeWorkflow.run()) as VectorStoreUpsertTaskOutput;

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
      repository: vectorRepoName,
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

    // Step 1: Retrieve relevant context
    const retrievalWorkflow = new Workflow();

    retrievalWorkflow.retrieval({
      repository: vectorRepoName,
      query: question,
      model: embeddingModel,
      topK: 3,
      scoreThreshold: 0.2, // Lower threshold to find results
    });

    const retrievalResult = (await retrievalWorkflow.run()) as RetrievalTaskOutput;

    expect(retrievalResult.chunks).toBeDefined();

    if (retrievalResult.chunks.length === 0) {
      console.log("No relevant chunks found, skipping QA");
      return; // Skip QA if no relevant context found
    }

    console.log(`Retrieved ${retrievalResult.chunks.length} context chunks`);

    // Step 2: Build context from retrieved chunks
    const context = retrievalResult.chunks.join("\n\n");

    console.log(`Context length: ${context.length} characters`);

    // Step 3: Answer question using context
    const qaWorkflow = new Workflow();

    qaWorkflow.textQuestionAnswer({
      context,
      question,
      model: qaModel,
    });

    const answer = (await qaWorkflow.run()) as TextQuestionAnswerTaskOutput;

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
      repository: vectorRepoName,
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
