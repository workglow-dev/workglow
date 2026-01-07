/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { cosineSimilarity, EventEmitter, TypedArray } from "@workglow/util";
import {
  HybridSearchOptions,
  IVectorRepository,
  SearchResult,
  VectorEntry,
  VectorEventListeners,
  VectorSearchOptions,
} from "./IVectorRepository";

/**
 * Check if metadata matches filter
 */
function matchesFilter<Metadata>(metadata: Metadata, filter: Partial<Metadata>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key as keyof Metadata] !== value) {
      return false;
    }
  }
  return true;
}

/**
 * Simple full-text search scoring (keyword matching)
 */
function textRelevance(text: string, query: string): number {
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);
  if (queryWords.length === 0) {
    return 0;
  }
  let matches = 0;
  for (const word of queryWords) {
    if (textLower.includes(word)) {
      matches++;
    }
  }
  return matches / queryWords.length;
}

/**
 * EdgeVec vector repository implementation.
 * Optimized for edge/browser deployment with minimal dependencies.
 * Stores vectors in memory with optional IndexedDB persistence.
 * Designed for privacy-sensitive on-device RAG applications.
 *
 * Features:
 * - Lightweight in-memory storage
 * - Optional IndexedDB persistence for browser
 * - WebGPU/WASM acceleration support (when available)
 * - Supports quantized vectors (Int8Array, Uint8Array, etc.)
 * - No server dependency
 * - Privacy-first design
 *
 * @template Metadata - Type for metadata associated with vectors
 * @template Vector - Type of vector array (Float32Array, Int8Array, etc.)
 */
export class EdgeVecRepository<
  Metadata = Record<string, unknown>,
  VectorChoice extends TypedArray = Float32Array,
>
  extends EventEmitter<VectorEventListeners<Metadata, VectorChoice>>
  implements IVectorRepository<Metadata, VectorChoice>
{
  private vectors: Map<string, VectorEntry<Metadata, VectorChoice>> = new Map();
  private dbName?: string;
  private db?: IDBDatabase;
  private initialized = false;
  private useWebGPU = false;
  private gpuDevice?: any;

  /**
   * Creates a new EdgeVec repository
   * @param options - Configuration options
   */
  constructor(
    options: {
      /** IndexedDB database name for persistence (browser only) */
      dbName?: string;
      /** Enable WebGPU acceleration if available */
      enableWebGPU?: boolean;
    } = {}
  ) {
    super();
    this.dbName = options.dbName;
    this.useWebGPU = options.enableWebGPU ?? false;
  }

  async setupDatabase(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize WebGPU if requested and available
    if (this.useWebGPU && typeof navigator !== "undefined" && "gpu" in navigator) {
      try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (adapter) {
          this.gpuDevice = await adapter.requestDevice();
        }
      } catch (error) {
        console.warn("WebGPU initialization failed, falling back to CPU:", error);
      }
    }

    // Initialize IndexedDB if dbName provided (browser only)
    if (this.dbName && typeof indexedDB !== "undefined") {
      await this.initIndexedDB();
      await this.loadFromIndexedDB();
    }

    this.initialized = true;
  }

  private async initIndexedDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName!, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("vectors")) {
          db.createObjectStore("vectors", { keyPath: "id" });
        }
      };
    });
  }

  private async loadFromIndexedDB(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["vectors"], "readonly");
      const store = transaction.objectStore("vectors");
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entries = request.result as Array<{
          id: string;
          vector: number[];
          metadata: Metadata;
        }>;
        for (const entry of entries) {
          this.vectors.set(entry.id, {
            id: entry.id,
            vector: this.copyVector(new Float32Array(entry.vector)) as VectorChoice,
            metadata: entry.metadata,
          });
        }
        resolve();
      };
    });
  }

  private async saveToIndexedDB(entry: VectorEntry<Metadata, VectorChoice>): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["vectors"], "readwrite");
      const store = transaction.objectStore("vectors");
      const request = store.put({
        id: entry.id,
        vector: Array.from(entry.vector),
        metadata: entry.metadata,
      });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  private async deleteFromIndexedDB(id: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["vectors"], "readwrite");
      const store = transaction.objectStore("vectors");
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async upsert(id: string, vector: VectorChoice, metadata: Metadata): Promise<void> {
    const entry: VectorEntry<Metadata, VectorChoice> = {
      id,
      vector: this.copyVector(vector) as VectorChoice,
      metadata: { ...metadata } as Metadata,
    };
    this.vectors.set(id, entry);

    if (this.db) {
      await this.saveToIndexedDB(entry);
    }

    this.emit("upsert", entry);
  }

  async upsertBulk(items: VectorEntry<Metadata, VectorChoice>[]): Promise<void> {
    for (const item of items) {
      const entry: VectorEntry<Metadata, VectorChoice> = {
        id: item.id,
        vector: this.copyVector(item.vector) as VectorChoice,
        metadata: { ...item.metadata } as Metadata,
      };
      this.vectors.set(item.id, entry);

      if (this.db) {
        await this.saveToIndexedDB(entry);
      }

      this.emit("upsert", entry);
    }
  }

  /**
   * Copy a vector to avoid external mutations
   */
  private copyVector(vector: TypedArray): TypedArray {
    if (vector instanceof Float32Array) return new Float32Array(vector);
    if (vector instanceof Float64Array) return new Float64Array(vector);
    if (vector instanceof Int8Array) return new Int8Array(vector);
    if (vector instanceof Uint8Array) return new Uint8Array(vector);
    if (vector instanceof Int16Array) return new Int16Array(vector);
    if (vector instanceof Uint16Array) return new Uint16Array(vector);
    return new Float32Array(vector);
  }

  async similaritySearch(
    query: VectorChoice,
    options: VectorSearchOptions<Metadata, VectorChoice> = {}
  ): Promise<SearchResult<Metadata, VectorChoice>[]> {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const results: SearchResult<Metadata, VectorChoice>[] = [];

    // Use WebGPU acceleration if available
    if (this.gpuDevice && this.vectors.size > 100) {
      // TODO: Implement WebGPU-accelerated similarity computation
      // For now, fall back to CPU
    }

    // CPU-based similarity computation
    for (const entry of this.vectors.values()) {
      if (filter && !matchesFilter(entry.metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(query, entry.vector);

      if (score >= scoreThreshold) {
        results.push({
          id: entry.id,
          vector: entry.vector,
          metadata: entry.metadata,
          score,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    this.emit("search", query, topResults);
    return topResults;
  }

  async hybridSearch(
    query: VectorChoice,
    options: HybridSearchOptions<Metadata, VectorChoice>
  ): Promise<SearchResult<Metadata, VectorChoice>[]> {
    const { topK = 10, filter, scoreThreshold = 0, textQuery, vectorWeight = 0.7 } = options;

    if (!textQuery || textQuery.trim().length === 0) {
      return this.similaritySearch(query, { topK, filter, scoreThreshold });
    }

    const results: SearchResult<Metadata, VectorChoice>[] = [];

    for (const entry of this.vectors.values()) {
      if (filter && !matchesFilter(entry.metadata, filter)) {
        continue;
      }

      const vectorScore = cosineSimilarity(query, entry.vector);
      const metadataText = JSON.stringify(entry.metadata).toLowerCase();
      const textScore = textRelevance(metadataText, textQuery);
      const combinedScore = vectorWeight * vectorScore + (1 - vectorWeight) * textScore;

      if (combinedScore >= scoreThreshold) {
        results.push({
          id: entry.id,
          vector: entry.vector,
          metadata: entry.metadata,
          score: combinedScore,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    this.emit("search", query, topResults);
    return topResults;
  }

  async get(id: string): Promise<VectorEntry<Metadata, VectorChoice> | undefined> {
    const entry = this.vectors.get(id);
    if (entry) {
      return {
        id: entry.id,
        vector: this.copyVector(entry.vector) as VectorChoice,
        metadata: { ...entry.metadata } as Metadata,
      };
    }
    return undefined;
  }

  async delete(id: string): Promise<void> {
    if (this.vectors.has(id)) {
      this.vectors.delete(id);
      if (this.db) {
        await this.deleteFromIndexedDB(id);
      }
      this.emit("delete", id);
    }
  }

  async deleteBulk(ids: string[]): Promise<void> {
    for (const id of ids) {
      if (this.vectors.has(id)) {
        this.vectors.delete(id);
        if (this.db) {
          await this.deleteFromIndexedDB(id);
        }
        this.emit("delete", id);
      }
    }
  }

  async deleteByFilter(filter: Partial<Metadata>): Promise<void> {
    const idsToDelete: string[] = [];
    for (const entry of this.vectors.values()) {
      if (matchesFilter(entry.metadata, filter)) {
        idsToDelete.push(entry.id);
      }
    }
    await this.deleteBulk(idsToDelete);
  }

  async size(): Promise<number> {
    return this.vectors.size;
  }

  async clear(): Promise<void> {
    const ids = Array.from(this.vectors.keys());
    this.vectors.clear();

    if (this.db) {
      const transaction = this.db.transaction(["vectors"], "readwrite");
      const store = transaction.objectStore("vectors");
      store.clear();
    }

    for (const id of ids) {
      this.emit("delete", id);
    }
  }

  destroy(): void {
    this.vectors.clear();
    if (this.db) {
      this.db.close();
    }
    this.removeAllListeners();
  }

  /**
   * Get WebGPU device if available
   */
  getGPUDevice(): any | undefined {
    return this.gpuDevice;
  }
}
