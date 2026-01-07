/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ChunkToVectorTask,
  getGlobalModelRepository,
  HierarchicalChunkerTask,
  InMemoryModelRepository,
  RetrievalTask,
  setGlobalModelRepository,
  StructuralParserTask,
  TextEmbeddingTask,
  VectorStoreSearchTask,
  VectorStoreUpsertTask,
} from "@workglow/ai";
import {
  HF_TRANSFORMERS_ONNX,
  HfTransformersOnnxModelRecord,
  register_HFT_InlineJobFns,
} from "@workglow/ai-provider";
import { InMemoryVectorRepository, registerVectorRepository } from "@workglow/storage";
import {
  Dataflow,
  getTaskQueueRegistry,
  setTaskQueueRegistry,
  TaskGraph,
  Workflow,
} from "@workglow/task-graph";
import { FileLoaderTask } from "@workglow/tasks";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Model configuration for embeddings
const EMBEDDING_MODEL: HfTransformersOnnxModelRecord = {
  model_id: "onnx:Supabase/gte-small:q8",
  title: "GTE Small",
  description: "Supabase/gte-small quantized to 8bit",
  tasks: ["TextEmbeddingTask"],
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "feature-extraction",
    model_path: "Supabase/gte-small",
    dtype: "q8",
    native_dimensions: 384,
  },
  metadata: {},
};

// Type for vector metadata
interface ChunkVectorMetadata {
  readonly docId: string;
  readonly chunkId: string;
  readonly leafNodeId: string;
  readonly depth: number;
  readonly text: string;
  readonly nodePath: readonly string[];
  readonly sourceFile?: string;
}

describe("RAG Pipeline with Docs", () => {
  let vectorRepo: InMemoryVectorRepository<ChunkVectorMetadata>;

  beforeAll(async () => {
    // Setup task queue and model repository
    setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await register_HFT_InlineJobFns();

    // Register embedding model
    await getGlobalModelRepository().addModel(EMBEDDING_MODEL);

    // Setup vector repository
    vectorRepo = new InMemoryVectorRepository<ChunkVectorMetadata>();
    await vectorRepo.setupDatabase();
    registerVectorRepository("rag-docs-repo", vectorRepo);
  });

  afterAll(async () => {
    getTaskQueueRegistry().stopQueues().clearQueues();
    setTaskQueueRegistry(null);
    vectorRepo.destroy();
  });

  /**
   * Helper to get all markdown files from the docs directory
   */
  async function getDocsMdFiles(): Promise<string[]> {
    const docsPath = join(process.cwd(), "docs");
    const files: string[] = [];

    // Get background files
    const backgroundPath = join(docsPath, "background");
    const backgroundFiles = await readdir(backgroundPath);
    for (const file of backgroundFiles) {
      if (file.endsWith(".md")) {
        files.push(join(backgroundPath, file));
      }
    }

    // Get developer files
    const developersPath = join(docsPath, "developers");
    const developersFiles = await readdir(developersPath);
    for (const file of developersFiles) {
      if (file.endsWith(".md")) {
        files.push(join(developersPath, file));
      }
    }

    return files;
  }

  describe("TaskGraph-based RAG Pipeline", () => {
    it("should build an ingestion pipeline as a serializable TaskGraph", async () => {
      // Get all markdown files
      const mdFiles = await getDocsMdFiles();
      expect(mdFiles.length).toBeGreaterThan(0);

      // Use the first file for this test (with file:// protocol)
      const testFile = `file://${mdFiles[0]}`;

      // Create a TaskGraph for the ingestion pipeline
      const graph = new TaskGraph();

      // Task 1: Load the file
      const fileLoaderTask = new FileLoaderTask(
        { url: testFile, format: "markdown" },
        { id: "fileLoader" }
      );
      graph.addTask(fileLoaderTask);

      // Task 2: Parse into document tree
      const structuralParserTask = new StructuralParserTask(
        { format: "markdown" },
        { id: "structuralParser" }
      );
      graph.addTask(structuralParserTask);

      // Dataflow: fileLoader.text -> structuralParser.text
      // Dataflow: fileLoader.metadata.title -> structuralParser.title
      graph.addDataflow(new Dataflow("fileLoader", "text", "structuralParser", "text"));
      graph.addDataflow(new Dataflow("fileLoader", "metadata.title", "structuralParser", "title"));

      // Task 3: Chunk the document
      const chunkerTask = new HierarchicalChunkerTask(
        { maxTokens: 512, overlap: 50, strategy: "hierarchical" },
        { id: "chunker" }
      );
      graph.addTask(chunkerTask);

      // Dataflow: structuralParser -> chunker
      graph.addDataflow(new Dataflow("structuralParser", "docId", "chunker", "docId"));
      graph.addDataflow(
        new Dataflow("structuralParser", "documentTree", "chunker", "documentTree")
      );

      // Task 4: Generate embeddings for chunk texts
      const embeddingTask = new TextEmbeddingTask(
        { model: EMBEDDING_MODEL.model_id },
        { id: "embeddings" }
      );
      graph.addTask(embeddingTask);

      // Dataflow: chunker.text -> embeddings.text
      graph.addDataflow(new Dataflow("chunker", "text", "embeddings", "text"));

      // Task 5: Transform chunks and vectors to vector store format
      const chunkToVectorTask = new ChunkToVectorTask({}, { id: "chunkToVector" });
      graph.addTask(chunkToVectorTask);

      // Dataflow: chunker.chunks -> chunkToVector.chunks, embeddings.vector -> chunkToVector.vectors
      graph.addDataflow(new Dataflow("chunker", "chunks", "chunkToVector", "chunks"));
      graph.addDataflow(new Dataflow("embeddings", "vector", "chunkToVector", "vectors"));

      // Task 6: Store in vector repository
      const upsertTask = new VectorStoreUpsertTask(
        { repository: vectorRepo },
        { id: "vectorUpsert" }
      );
      graph.addTask(upsertTask);

      // Dataflow: chunkToVector -> vectorUpsert
      graph.addDataflow(new Dataflow("chunkToVector", "ids", "vectorUpsert", "ids"));
      graph.addDataflow(new Dataflow("chunkToVector", "vectors", "vectorUpsert", "vectors"));
      graph.addDataflow(new Dataflow("chunkToVector", "metadata", "vectorUpsert", "metadata"));

      // Verify graph structure
      expect(graph.getTasks()).toHaveLength(6);
      expect(graph.getDataflows()).toHaveLength(10);

      // Serialize to JSON
      const graphJson = graph.toJSON();
      expect(graphJson.tasks).toHaveLength(6);
      expect(graphJson.dataflows).toHaveLength(10);

      // Verify the JSON is serializable (can be JSON.stringify'd)
      const jsonString = JSON.stringify(graphJson, null, 2);
      expect(jsonString).toBeTruthy();
      expect(JSON.parse(jsonString)).toEqual(graphJson);

      // Log the JSON for inspection (useful for pasting into web example)
      console.log("Ingestion Pipeline Graph JSON:");
      console.log(jsonString);
    });

    it("should build a search pipeline as a serializable TaskGraph", async () => {
      const searchQuery = "What is retrieval augmented generation?";

      // Create a TaskGraph for the search pipeline
      const graph = new TaskGraph();

      // Task 1: Embed the query
      const queryEmbeddingTask = new TextEmbeddingTask(
        { text: searchQuery, model: EMBEDDING_MODEL.model_id },
        { id: "queryEmbedding" }
      );
      graph.addTask(queryEmbeddingTask);

      // Task 2: Search the vector store
      const searchTask = new VectorStoreSearchTask(
        { repository: vectorRepo, topK: 5 },
        { id: "vectorSearch" }
      );
      graph.addTask(searchTask);

      // Dataflow: queryEmbedding.vector -> vectorSearch.query
      graph.addDataflow(new Dataflow("queryEmbedding", "vector", "vectorSearch", "query"));

      // Verify graph structure
      expect(graph.getTasks()).toHaveLength(2);
      expect(graph.getDataflows()).toHaveLength(1);

      // Serialize to JSON
      const graphJson = graph.toJSON();
      expect(graphJson.tasks).toHaveLength(2);
      expect(graphJson.dataflows).toHaveLength(1);

      // Verify JSON serialization
      const jsonString = JSON.stringify(graphJson, null, 2);
      expect(jsonString).toBeTruthy();

      console.log("Search Pipeline Graph JSON:");
      console.log(jsonString);
    });

    it("should run complete RAG pipeline: ingest all docs and search", async () => {
      // Get all markdown files
      const mdFiles = await getDocsMdFiles();
      expect(mdFiles.length).toBeGreaterThan(0);

      console.log(`Processing ${mdFiles.length} markdown files from docs...`);

      // Process each file through the ingestion pipeline using Workflow
      for (const filePath of mdFiles) {
        const fileName = filePath.split("/").pop() || filePath;
        console.log(`  Ingesting: ${fileName}`);

        // Load the file
        // Use file:// protocol for local file paths
        const fileUrl = `file://${filePath}`;
        const loadResult = await new Workflow()
          .fileLoader({ url: fileUrl, format: "markdown" })
          .run();

        const text = loadResult.text as string;
        const title = (loadResult.metadata as { title?: string })?.title || fileName;

        // Parse, chunk, embed, and store
        const result = await new Workflow()
          .structuralParser({
            text,
            title,
            format: "markdown",
            sourceUri: filePath,
          })
          .hierarchicalChunker({
            maxTokens: 512,
            overlap: 50,
            strategy: "hierarchical",
          })
          .run();

        // Get chunks and generate embeddings for their texts
        const chunks = result.chunks as Array<{
          chunkId: string;
          docId: string;
          text: string;
          nodePath: string[];
          depth: number;
        }>;

        if (chunks.length === 0) {
          console.log(`    No chunks generated for ${fileName}`);
          continue;
        }

        // Generate embeddings for all chunks
        const chunkTexts = chunks.map((c) => c.text);
        const embeddingResult = await new Workflow()
          .textEmbedding({
            text: chunkTexts,
            model: EMBEDDING_MODEL.model_id,
          })
          .run();

        // Handle both single and multiple vector cases
        // When a single text is embedded, result.vector is a Float32Array
        // When multiple texts are embedded, result.vector is an array of Float32Arrays
        const rawVectors = embeddingResult.vector;
        const vectors: Float32Array[] =
          Array.isArray(rawVectors) && rawVectors[0] instanceof Float32Array
            ? (rawVectors as Float32Array[])
            : [rawVectors as Float32Array];

        // Transform to vector store format
        const vectorData = await new Workflow()
          .chunkToVector({
            chunks,
            vectors,
          })
          .run();

        // Store in vector repository (use task directly for proper repository binding)
        const upsertTask = new VectorStoreUpsertTask();
        await upsertTask.run({
          repository: vectorRepo,
          ids: vectorData.ids as string[],
          vectors: vectorData.vectors as Float32Array[],
          metadata: vectorData.metadata as unknown as { [x: string]: unknown }[],
        });

        console.log(`    Stored ${chunks.length} chunks`);
      }

      // Verify vectors were stored
      const vectorCount = await vectorRepo.size();
      expect(vectorCount).toBeGreaterThan(0);
      console.log(`Total vectors in repository: ${vectorCount}`);

      // Now search for content about RAG
      const searchQuery = "What is retrieval augmented generation?";
      console.log(`\nSearching for: "${searchQuery}"`);

      // Generate query embedding and search
      const queryEmbeddingResult = await new Workflow()
        .textEmbedding({
          text: searchQuery,
          model: EMBEDDING_MODEL.model_id,
        })
        .run();

      const queryVector = queryEmbeddingResult.vector as Float32Array;

      // Use task directly for proper repository binding
      const searchTask = new VectorStoreSearchTask();
      const searchResult = await searchTask.run({
        repository: vectorRepo,
        query: queryVector,
        topK: 5,
      });

      expect(searchResult.count).toBeGreaterThan(0);
      expect(searchResult.ids.length).toBe(searchResult.count);
      expect(searchResult.scores.length).toBe(searchResult.count);
      expect(searchResult.metadata.length).toBe(searchResult.count);

      console.log(`\nSearch Results (top ${searchResult.count}):`);
      for (let i = 0; i < searchResult.count; i++) {
        const meta = searchResult.metadata[i] as unknown as ChunkVectorMetadata;
        console.log(`  ${i + 1}. Score: ${searchResult.scores[i].toFixed(4)}`);
        console.log(`     Text: ${meta.text.substring(0, 100)}...`);
      }

      // The search should find content about RAG from the docs
      const ragMetadata = searchResult.metadata as unknown as ChunkVectorMetadata[];
      const hasRagContent = ragMetadata.some(
        (m) =>
          m.text.toLowerCase().includes("retrieval") ||
          m.text.toLowerCase().includes("rag") ||
          m.text.toLowerCase().includes("augment")
      );
      expect(hasRagContent).toBe(true);
    }, 300000); // 5 minute timeout for model download and processing

    it("should use RetrievalTask for simplified search", async () => {
      // Assume vectors are already stored from previous test
      const vectorCount = await vectorRepo.size();
      if (vectorCount === 0) {
        console.log("Skipping RetrievalTask test - no vectors in repository");
        return;
      }

      const searchQuery = "What are the motivations for this project?";

      // Generate query embedding
      const queryEmbeddingResult = await new Workflow()
        .textEmbedding({
          text: searchQuery,
          model: EMBEDDING_MODEL.model_id,
        })
        .run();

      const queryVector = queryEmbeddingResult.vector as Float32Array;

      // Use RetrievalTask which extracts text from metadata
      const retrievalTask = new RetrievalTask();
      const retrievalResult = await retrievalTask.run({
        repository: vectorRepo,
        query: queryVector,
        topK: 3,
      });

      expect(retrievalResult.count).toBeGreaterThan(0);
      expect(retrievalResult.chunks).toBeDefined();
      expect(retrievalResult.chunks.length).toBe(retrievalResult.count);

      console.log(`\nRetrieval Results for: "${searchQuery}"`);
      for (let i = 0; i < retrievalResult.count; i++) {
        console.log(`  ${i + 1}. Score: ${retrievalResult.scores[i].toFixed(4)}`);
        console.log(`     Chunk: ${retrievalResult.chunks[i].substring(0, 100)}...`);
      }
    }, 60000);

    it("should serialize complete pipeline to portable JSON", async () => {
      // Build a complete end-to-end pipeline as a TaskGraph
      const graph = new TaskGraph();

      // === Ingestion Phase ===
      // Note: In the JSON, defaults are the initial values
      // Dynamic values (like file path) would be provided at runtime

      const fileLoaderTask = new FileLoaderTask(
        { url: "placeholder.md", format: "markdown" },
        { id: "load", name: "Load Document" }
      );
      graph.addTask(fileLoaderTask);

      const parserTask = new StructuralParserTask(
        { format: "markdown" },
        { id: "parse", name: "Parse Structure" }
      );
      graph.addTask(parserTask);

      const chunkerTask = new HierarchicalChunkerTask(
        { maxTokens: 512, overlap: 50, strategy: "hierarchical" },
        { id: "chunk", name: "Chunk Document" }
      );
      graph.addTask(chunkerTask);

      const embedTask = new TextEmbeddingTask(
        { model: EMBEDDING_MODEL.model_id },
        { id: "embed", name: "Generate Embeddings" }
      );
      graph.addTask(embedTask);

      const transformTask = new ChunkToVectorTask(
        {},
        { id: "transform", name: "Transform for Storage" }
      );
      graph.addTask(transformTask);

      const storeTask = new VectorStoreUpsertTask(
        { repository: "rag-docs-repo" as any },
        { id: "store", name: "Store Vectors" }
      );
      graph.addTask(storeTask);

      // Dataflows for ingestion
      graph.addDataflow(new Dataflow("load", "text", "parse", "text"));
      graph.addDataflow(new Dataflow("load", "metadata.title", "parse", "title"));
      graph.addDataflow(new Dataflow("parse", "docId", "chunk", "docId"));
      graph.addDataflow(new Dataflow("parse", "documentTree", "chunk", "documentTree"));
      graph.addDataflow(new Dataflow("chunk", "text", "embed", "text"));
      graph.addDataflow(new Dataflow("chunk", "chunks", "transform", "chunks"));
      graph.addDataflow(new Dataflow("embed", "vector", "transform", "vectors"));
      graph.addDataflow(new Dataflow("transform", "ids", "store", "ids"));
      graph.addDataflow(new Dataflow("transform", "vectors", "store", "vectors"));
      graph.addDataflow(new Dataflow("transform", "metadata", "store", "metadata"));

      // Get JSON representation
      const graphJson = graph.toJSON();

      // Verify structure
      expect(graphJson.tasks).toHaveLength(6);
      expect(graphJson.dataflows).toHaveLength(10);

      // Verify each task has required fields
      for (const task of graphJson.tasks) {
        expect(task.id).toBeDefined();
        expect(task.type).toBeDefined();
      }

      // Verify dataflows connect properly
      for (const df of graphJson.dataflows) {
        expect(df.sourceTaskId).toBeDefined();
        expect(df.sourceTaskPortId).toBeDefined();
        expect(df.targetTaskId).toBeDefined();
        expect(df.targetTaskPortId).toBeDefined();
      }

      // The JSON can be exported and used in the web example
      const exportableJson = JSON.stringify(graphJson, null, 2);
      console.log("\n=== Portable RAG Ingestion Pipeline JSON ===");
      console.log(exportableJson);

      // Verify it's valid JSON that can be parsed back
      const parsed = JSON.parse(exportableJson);
      expect(parsed.tasks).toHaveLength(6);
      expect(parsed.dataflows).toHaveLength(10);
    });
  });
});
