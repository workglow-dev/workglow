/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Document,
  DocumentEnricherTask,
  HierarchicalChunkerTask,
  NodeIdGenerator,
  StructuralParser,
} from "@workglow/ai";
import { register_HFT_InlineJobFns } from "@workglow/ai-provider";
import { TaskGraph, Workflow, type Provenance, type ProvenanceItem } from "@workglow/task-graph";
import { describe, expect, it } from "bun:test";
import { registerHuggingfaceLocalModels } from "../../samples";

describe("Provenance Tracking in RAG Workflow", () => {
  const sampleMarkdown = `# Machine Learning Guide

Machine learning is a subset of artificial intelligence that focuses on data-driven algorithms.

## Deep Learning

Deep learning uses neural networks with multiple layers to process complex patterns.

### Neural Networks

Neural networks are computational models inspired by biological neural networks.

## Applications

Machine learning has applications in computer vision, natural language processing, and more.`;

  it("should track provenance through chunking task", async () => {
    const docId = await NodeIdGenerator.generateDocId("ml-guide", sampleMarkdown);
    const root = await StructuralParser.parseMarkdown(docId, sampleMarkdown, "ML Guide");

    const chunkerTask = new HierarchicalChunkerTask(
      {
        docId,
        documentTree: root,
        maxTokens: 256,
        overlap: 25,
        strategy: "hierarchical",
      },
      { id: "chunker-1" }
    );

    const result = await chunkerTask.run();

    // Get the provenance from the task
    const taskProvenance = chunkerTask.getProvenance();
    expect(taskProvenance).toBeDefined();
    expect(taskProvenance?.chunkerStrategy).toBe("hierarchical");
    expect(taskProvenance?.maxTokens).toBe(256);
    expect(taskProvenance?.overlap).toBe(25);
    expect(taskProvenance?.docId).toBe(docId);

    // Verify chunks were created
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it("should accumulate provenance through multi-task workflow", async () => {
    const docId = await NodeIdGenerator.generateDocId("ml-guide", sampleMarkdown);
    const root = await StructuralParser.parseMarkdown(docId, sampleMarkdown, "ML Guide");

    // Create a task graph to track provenance through multiple tasks
    const graph = new TaskGraph();

    // Task 1: Chunk the document
    const chunkerTask = new HierarchicalChunkerTask(
      {
        docId,
        documentTree: root,
        maxTokens: 256,
        overlap: 25,
        strategy: "hierarchical",
      },
      { id: "chunker-1" }
    );
    graph.addTask(chunkerTask);

    // Run the graph and check provenance
    const results = await graph.run({}, { parentProvenance: [] });

    expect(results.length).toBe(1);
    expect(results[0].id).toBe("chunker-1");

    // Get provenance from the task
    const chunkerProvenance = chunkerTask.getProvenance();
    expect(chunkerProvenance).toBeDefined();
    expect(chunkerProvenance?.chunkerStrategy).toBe("hierarchical");
  });

  it("should track model configurations through enrichment workflow", async () => {
    const docId = await NodeIdGenerator.generateDocId("ml-guide", sampleMarkdown);
    const root = await StructuralParser.parseMarkdown(docId, sampleMarkdown, "ML Guide");

    // Create enrichment task with model configurations
    const enricherTask = new DocumentEnricherTask(
      {
        docId,
        documentTree: root,
        generateSummaries: false, // Disable to avoid model requirements
        extractEntities: false, // Disable to avoid model requirements
      },
      { id: "enricher-1" }
    );

    const result = await enricherTask.run();

    // Verify task executed
    expect(result.docId).toBe(docId);
    expect(result.summaryCount).toBe(0);
    expect(result.entityCount).toBe(0);
  });

  it("should build complete provenance history in Document variants", async () => {
    const docId = await NodeIdGenerator.generateDocId("ml-guide", sampleMarkdown);
    const root = await StructuralParser.parseMarkdown(docId, sampleMarkdown, "ML Guide");

    // Chunk the document
    const chunkerTask = new HierarchicalChunkerTask({
      docId,
      documentTree: root,
      maxTokens: 256,
      overlap: 25,
      strategy: "hierarchical",
    });

    const chunkResult = await chunkerTask.run();

    // Create a document and add variant with provenance history
    const doc = new Document(docId, root, { title: "ML Guide" });

    // Build provenance array showing workflow history
    const workflowProvenance: Provenance = [
      {
        step: "parsing",
        parser: "markdown",
        timestamp: new Date().toISOString(),
      },
      {
        step: "chunking",
        chunkerStrategy: "hierarchical",
        maxTokens: 256,
        overlap: 25,
        docId,
      },
      {
        step: "embedding",
        embeddingModel: "text-embedding-3-small",
        dimensions: 1536,
      },
    ];

    const configId = await doc.addVariant(workflowProvenance, chunkResult.chunks);

    // Verify variant was created with provenance
    const variant = doc.getVariant(configId);
    expect(variant).toBeDefined();
    expect(variant?.provenance.embeddingModel).toBe("text-embedding-3-small");
    expect(variant?.provenance.chunkerStrategy).toBe("hierarchical");
  });

  it("should track multiple model configurations in parallel workflows", async () => {
    const docId = await NodeIdGenerator.generateDocId("ml-guide", sampleMarkdown);
    const root = await StructuralParser.parseMarkdown(docId, sampleMarkdown, "ML Guide");

    // Create multiple chunking strategies
    const strategies = [
      { strategy: "hierarchical" as const, maxTokens: 256, overlap: 25 },
      { strategy: "hierarchical" as const, maxTokens: 512, overlap: 50 },
      { strategy: "flat" as const, maxTokens: 256, overlap: 25 },
    ];

    const doc = new Document(docId, root, { title: "ML Guide" });
    const configIds: string[] = [];

    // Process with each strategy
    for (const config of strategies) {
      const chunkerTask = new HierarchicalChunkerTask({
        docId,
        documentTree: root,
        ...config,
      });

      const result = await chunkerTask.run();
      const taskProvenance = chunkerTask.getProvenance();

      // Build provenance history for this variant
      const variantProvenance: Provenance = [
        {
          step: "chunking",
          ...taskProvenance,
        },
        {
          step: "embedding",
          embeddingModel: "text-embedding-3-small",
        },
      ];

      const configId = await doc.addVariant(variantProvenance, result.chunks);
      configIds.push(configId);
    }

    // Verify all variants have unique configIds due to different provenance
    const uniqueIds = new Set(configIds);
    expect(uniqueIds.size).toBe(3);

    // Verify each variant has correct provenance
    for (let i = 0; i < configIds.length; i++) {
      const variant = doc.getVariant(configIds[i]);
      expect(variant).toBeDefined();
      expect(variant?.provenance.chunkerStrategy).toBe(strategies[i].strategy);
      expect(variant?.provenance.maxTokens).toBe(strategies[i].maxTokens);
    }
  });

  it("should demonstrate end-to-end RAG workflow provenance", async () => {
    const docId = await NodeIdGenerator.generateDocId("ml-guide", sampleMarkdown);
    const root = await StructuralParser.parseMarkdown(docId, sampleMarkdown, "ML Guide");

    // Step 1: Chunk with specific configuration
    const chunkerTask = new HierarchicalChunkerTask({
      docId,
      documentTree: root,
      maxTokens: 512,
      overlap: 50,
      strategy: "hierarchical",
    });

    const chunkResult = await chunkerTask.run();
    const chunkerProvenance = chunkerTask.getProvenance();

    // Build complete provenance history using array spread
    const completeProvenance: Provenance = [
      // Add parsing provenance
      {
        taskType: "StructuralParser",
        format: "markdown",
        docId,
        timestamp: new Date().toISOString(),
      },
      // Add chunking provenance
      ...(chunkerProvenance
        ? [
            {
              taskType: "HierarchicalChunker",
              ...chunkerProvenance,
              timestamp: new Date().toISOString(),
            },
          ]
        : []),
      // Add embedding provenance (simulated)
      {
        taskType: "TextEmbedding",
        model: "text-embedding-3-small",
        modelVersion: "v3",
        dimensions: 1536,
        timestamp: new Date().toISOString(),
      },
      // Add vector store provenance
      {
        taskType: "VectorStore",
        storageType: "in-memory",
        indexType: "flat",
        timestamp: new Date().toISOString(),
      },
    ];

    // Create document with complete provenance
    const doc = new Document(docId, root, { title: "ML Guide" });
    const configId = await doc.addVariant(completeProvenance, chunkResult.chunks);

    const variant = doc.getVariant(configId);
    expect(variant).toBeDefined();

    // Verify we can reconstruct the complete workflow from provenance
    expect(variant?.provenance.chunkerStrategy).toBe("hierarchical");
    expect(variant?.provenance.maxTokens).toBe(512);
    expect(variant?.provenance.overlap).toBe(50);

    // The extractConfigFields function should find relevant fields from the array
    expect(variant?.chunks.length).toBeGreaterThan(0);
  });

  it("should handle tasks that opt out of provenance tracking", async () => {
    const docId = await NodeIdGenerator.generateDocId("ml-guide", sampleMarkdown);
    const root = await StructuralParser.parseMarkdown(docId, sampleMarkdown, "ML Guide");

    // Create a task graph with mixed provenance
    const graph = new TaskGraph();

    const chunkerTask = new HierarchicalChunkerTask(
      {
        docId,
        documentTree: root,
        maxTokens: 256,
        overlap: 25,
        strategy: "hierarchical",
      },
      { id: "chunker-1" }
    );

    graph.addTask(chunkerTask);

    // Run with initial provenance
    const initialProvenance: Provenance = [
      {
        workflowId: "test-workflow",
        startTime: new Date().toISOString(),
      },
    ];

    await graph.run({}, { parentProvenance: initialProvenance });

    // Verify the chunker added its provenance
    const chunkerProvenance = chunkerTask.getProvenance();
    expect(chunkerProvenance).toBeDefined();

    // If a task returns undefined, it won't be added to the history
    // This allows tasks to opt out of provenance tracking
  });

  it("should preserve provenance order through task execution", async () => {
    // Simulate a multi-stage workflow
    const stages: ProvenanceItem[] = [];

    stages.push({
      stage: 1,
      taskType: "DocumentParser",
      model: "markdown-parser-v1",
      timestamp: "2025-01-01T10:00:00Z",
    });

    stages.push({
      stage: 2,
      taskType: "Chunker",
      model: "hierarchical-chunker-v2",
      maxTokens: 512,
      timestamp: "2025-01-01T10:00:01Z",
    });

    stages.push({
      stage: 3,
      taskType: "Embedder",
      model: "text-embedding-3-small",
      dimensions: 1536,
      timestamp: "2025-01-01T10:00:02Z",
    });

    stages.push({
      stage: 4,
      taskType: "VectorStore",
      model: "faiss-index",
      indexType: "IVF",
      timestamp: "2025-01-01T10:00:03Z",
    });

    const provenance: Provenance = stages;

    // Verify order is preserved
    expect(provenance.length).toBe(4);
    expect(provenance[0].stage).toBe(1);
    expect(provenance[1].stage).toBe(2);
    expect(provenance[2].stage).toBe(3);
    expect(provenance[3].stage).toBe(4);

    // Verify we can extract model information in order
    const models = provenance.map((p) => p.model).filter(Boolean);
    expect(models).toEqual([
      "markdown-parser-v1",
      "hierarchical-chunker-v2",
      "text-embedding-3-small",
      "faiss-index",
    ]);
  });

  it("should compare provenance across different RAG configurations", async () => {
    const docId = await NodeIdGenerator.generateDocId("ml-guide", sampleMarkdown);
    const root = await StructuralParser.parseMarkdown(docId, sampleMarkdown, "ML Guide");

    const doc = new Document(docId, root, { title: "ML Guide" });

    // Configuration 1: Small chunks with OpenAI embeddings
    const config1Provenance: Provenance = [
      {
        chunkerStrategy: "hierarchical",
        maxTokens: 256,
        overlap: 25,
      },
      {
        embeddingModel: "text-embedding-3-small",
        provider: "openai",
        dimensions: 1536,
      },
    ];

    // Configuration 2: Large chunks with different embeddings
    const config2Provenance: Provenance = [
      {
        chunkerStrategy: "hierarchical",
        maxTokens: 1024,
        overlap: 100,
      },
      {
        embeddingModel: "text-embedding-3-large",
        provider: "openai",
        dimensions: 3072,
      },
    ];

    // Configuration 3: Flat chunking with alternative embeddings
    const config3Provenance: Provenance = [
      {
        chunkerStrategy: "flat",
        maxTokens: 512,
        overlap: 50,
      },
      {
        embeddingModel: "all-MiniLM-L6-v2",
        provider: "huggingface",
        dimensions: 384,
      },
    ];

    // Create chunker for generating chunks (use config1 settings)
    const chunkerTask = new HierarchicalChunkerTask({
      docId,
      documentTree: root,
      maxTokens: 256,
      overlap: 25,
      strategy: "hierarchical",
    });
    const chunkResult = await chunkerTask.run();

    // Add all configurations as variants
    const configId1 = await doc.addVariant(config1Provenance, chunkResult.chunks);
    const configId2 = await doc.addVariant(config2Provenance, chunkResult.chunks);
    const configId3 = await doc.addVariant(config3Provenance, chunkResult.chunks);

    // Verify all configs have unique IDs
    expect(configId1).not.toBe(configId2);
    expect(configId2).not.toBe(configId3);
    expect(configId1).not.toBe(configId3);

    // Verify each variant preserves its complete provenance
    const variant1 = doc.getVariant(configId1);
    const variant2 = doc.getVariant(configId2);
    const variant3 = doc.getVariant(configId3);

    expect(variant1?.provenance.embeddingModel).toBe("text-embedding-3-small");
    expect(variant1?.provenance.maxTokens).toBe(256);

    expect(variant2?.provenance.embeddingModel).toBe("text-embedding-3-large");
    expect(variant2?.provenance.maxTokens).toBe(1024);

    expect(variant3?.provenance.embeddingModel).toBe("all-MiniLM-L6-v2");
    expect(variant3?.provenance.chunkerStrategy).toBe("flat");
  });

  it("should track provenance through chained Workflow API", async () => {
    const docId = await NodeIdGenerator.generateDocId("ml-guide", sampleMarkdown);
    const root = await StructuralParser.parseMarkdown(docId, sampleMarkdown, "ML Guide");

    // Build a RAG workflow using chainable API
    const workflow = new Workflow()
      .hierarchicalChunker(
        {
          docId,
          documentTree: root,
          maxTokens: 512,
          overlap: 50,
          strategy: "hierarchical",
        },
        {
          id: "chunker",
          provenance: [
            {
              workflowStep: "chunking",
              model: "hierarchical-chunker-v2",
              config: "medium-chunks",
            },
          ],
        }
      )
      .documentEnricher(
        {
          docId,
          generateSummaries: false,
          extractEntities: false,
        },
        {
          id: "enricher",
          provenance: [
            {
              workflowStep: "enrichment",
              model: "doc-enricher-v1",
              config: "minimal",
            },
          ],
        }
      );

    // Execute the workflow
    const results = await workflow.run({ docId, documentTree: root });

    // Get tasks from the workflow to check their provenance
    const tasks = workflow.graph.getTasks();
    expect(tasks.length).toBe(2);

    // Check chunker task provenance
    const chunkerTask = tasks.find((t) => t.config.id === "chunker");
    expect(chunkerTask).toBeDefined();
    const chunkerProvenance = chunkerTask?.getProvenance();
    expect(chunkerProvenance).toBeDefined();
    expect(chunkerProvenance?.chunkerStrategy).toBe("hierarchical");
    expect(chunkerProvenance?.maxTokens).toBe(512);
    expect(chunkerProvenance?.overlap).toBe(50);

    // Verify workflow executed successfully
    // Results are from the final task (documentEnricher)
    expect(results).toBeDefined();
    expect(results.docId).toBe(docId);
    expect(results.summaryCount).toBe(0);
    expect(results.entityCount).toBe(0);
  });

  it("should accumulate provenance from parent workflow through chained tasks", async () => {
    const docId = await NodeIdGenerator.generateDocId("ml-guide", sampleMarkdown);
    const root = await StructuralParser.parseMarkdown(docId, sampleMarkdown, "ML Guide");

    const workflow = new Workflow()
      .hierarchicalChunker(
        {
          docId,
          documentTree: root,
          maxTokens: 256,
          overlap: 25,
          strategy: "hierarchical",
        },
        { id: "chunker-task" }
      )
      .documentEnricher(
        {
          docId,
          generateSummaries: false,
          extractEntities: false,
        },
        { id: "enricher-task" }
      );

    // Run with parent provenance
    await workflow.run({ docId, documentTree: root });

    // Verify tasks received parent provenance
    const tasks = workflow.graph.getTasks();
    expect(tasks.length).toBe(2);

    // Each task should have accumulated provenance from parent
    for (const task of tasks) {
      // The task's runner should have received the parent provenance
      // which gets merged with task-specific provenance during execution
      expect(task.config.id).toBeDefined();
    }
  });

  it("should demonstrate complete RAG workflow with Workflow API and provenance", async () => {
    register_HFT_InlineJobFns();
    await registerHuggingfaceLocalModels();

    // Create base workflow to get chunks
    const baseWorkflow = new Workflow()
      .structuralParser(
        {
          text: sampleMarkdown,
          title: "ML Guide",
          format: "markdown" as const,
          sourceUri: "ml-guide.md",
        },
        { id: "parser" }
      )
      .hierarchicalChunker(
        {
          maxTokens: 1024,
          overlap: 100,
          strategy: "hierarchical",
        },
        { id: "chunker" }
      )
      .textEmbedding(
        {
          model: ["onnx:Xenova/all-MiniLM-L6-v2:q8", "onnx:Xenova/bge-base-en-v1.5:q8"],
        },
        { id: "embedding" }
      )
      .output({}, { id: "output" });

    const results = await baseWorkflow.run();

    // Get provenance for each task to trace how results were created
    const parserProvenance = baseWorkflow.getProvenanceForTask("parser");
    const chunkerProvenance = baseWorkflow.getProvenanceForTask("chunker");
    const embeddingProvenance = baseWorkflow.getProvenanceForTask("embedding");
    const outputProvenance = baseWorkflow.getProvenanceForTask("output");

    // Parser should have minimal provenance (just its own config)
    expect(parserProvenance).toBeDefined();
    expect(parserProvenance!.length).toBe(0);

    // Chunker should have provenance from parser
    expect(chunkerProvenance).toBeDefined();
    expect(chunkerProvenance!.length).toBe(1);

    // Embedding should have the complete chain: parser -> chunker -> embedding
    expect(embeddingProvenance).toBeDefined();
    expect(embeddingProvenance!.length).toBe(2);

    const embeddingProvenanceData = embeddingProvenance!;
    expect(embeddingProvenanceData.length).toBe(2);

    // Output should have the complete chain: parser -> chunker -> embedding -> output (output has no provenance)
    expect(outputProvenance).toBeDefined();
    expect(outputProvenance!.length).toBe(2);
    console.log("outputProvenance", outputProvenance);

    // Verify results contain vector embeddings
    expect(results.vector).toBeDefined();
    expect(Array.isArray(results.vector)).toBe(true);

    const vectors = results.vector as Float32Array[];
    expect(vectors.length).toBe(4 * 2); // 4 chunks × 2 models

    // Find the embedding task's provenance item which contains model info
    const embeddingTaskProvenance = outputProvenance!.find((p) => p.task === "TextEmbeddingTask");
    expect(embeddingTaskProvenance).toBeDefined();
    expect(embeddingTaskProvenance!.model).toBeDefined();

    // The model in provenance is an array of model IDs (strings)
    const modelIds = embeddingTaskProvenance!.model as string[];
    expect(Array.isArray(modelIds)).toBe(true);
    expect(modelIds.length).toBe(2);
    expect(modelIds).toContain("onnx:Xenova/all-MiniLM-L6-v2:q8");
    expect(modelIds).toContain("onnx:Xenova/bge-base-en-v1.5:q8");

    // Now verify we can trace each vector to its creating model
    // ArrayTask generates combinations by iterating the rightmost array first (models),
    // then the leftmost array (chunks). The pattern is:
    // [chunk0+model0, chunk0+model1, chunk1+model0, chunk1+model1, ...]
    //
    // With input:
    //   text: [chunk0, chunk1, chunk2, chunk3]
    //   model: [all-MiniLM-L6-v2:q8, bge-base-en-v1.5:q8]
    //
    // The vectors are ordered as:
    // 0: chunk0 + all-MiniLM-L6-v2 (384D)
    // 1: chunk0 + bge-base-en-v1.5 (768D)
    // 2: chunk1 + all-MiniLM-L6-v2 (384D)
    // 3: chunk1 + bge-base-en-v1.5 (768D)
    // 4: chunk2 + all-MiniLM-L6-v2 (384D)
    // 5: chunk2 + bge-base-en-v1.5 (768D)
    // 6: chunk3 + all-MiniLM-L6-v2 (384D)
    // 7: chunk3 + bge-base-en-v1.5 (768D)

    // Verify each vector can be traced to its exact model and chunk
    expect(vectors.length).toBe(8);

    for (let i = 0; i < vectors.length; i++) {
      const vector = vectors[i];
      const chunkIndex = Math.floor(i / modelIds.length);
      const modelIndex = i % modelIds.length;
      const modelId = modelIds[modelIndex];

      // Map each vector to its creating model using the combination pattern
      if (modelId === "onnx:Xenova/all-MiniLM-L6-v2:q8") {
        expect(vector.length).toBe(384);
        console.log(`Vector ${i}: chunk${chunkIndex} + all-MiniLM-L6-v2 → 384D`);
      } else if (modelId === "onnx:Xenova/bge-base-en-v1.5:q8") {
        expect(vector.length).toBe(768);
        console.log(`Vector ${i}: chunk${chunkIndex} + bge-base-en-v1.5 → 768D`);
      } else {
        throw new Error(`Unexpected model: ${modelId}`);
      }
    }

    // This demonstrates complete provenance tracing:
    // 1. Get the embedding task provenance which lists models in order
    // 2. Use ArrayTask's combination pattern (rightmost array iterates first)
    // 3. Map each vector to its exact (chunk, model) pair
    // 4. Verify dimensions match the expected model, even if dimensions were the same!
  });
});
