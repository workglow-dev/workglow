/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createServiceToken,
  globalServiceRegistry,
  registerInputResolver,
  ServiceRegistry,
} from "@workglow/util";
import type { DocumentChunkDataset } from "./DocumentChunkDataset";

/**
 * Service token for the document chunk dataset registry
 * Maps dataset IDs to DocumentChunkDataset instances
 */
export const DOCUMENT_CHUNK_DATASET =
  createServiceToken<Map<string, DocumentChunkDataset>>("dataset.document-chunk");

// Register default factory if not already registered
if (!globalServiceRegistry.has(DOCUMENT_CHUNK_DATASET)) {
  globalServiceRegistry.register(
    DOCUMENT_CHUNK_DATASET,
    (): Map<string, DocumentChunkDataset> => new Map(),
    true
  );
}

/**
 * Gets the global document chunk dataset registry
 * @returns Map of document chunk dataset ID to instance
 */
export function getGlobalDocumentChunkDataset(): Map<string, DocumentChunkDataset> {
  return globalServiceRegistry.get(DOCUMENT_CHUNK_DATASET);
}

/**
 * Registers a document chunk dataset globally by ID
 * @param id The unique identifier for this dataset
 * @param dataset The dataset instance to register
 */
export function registerDocumentChunkDataset(id: string, dataset: DocumentChunkDataset): void {
  const datasets = getGlobalDocumentChunkDataset();
  datasets.set(id, dataset);
}

/**
 * Gets a document chunk dataset by ID from the global registry
 * @param id The dataset identifier
 * @returns The dataset instance or undefined if not found
 */
export function getDocumentChunkDataset(id: string): DocumentChunkDataset | undefined {
  return getGlobalDocumentChunkDataset().get(id);
}

/**
 * Resolves a dataset ID to a DocumentChunkDataset from the registry.
 * Used by the input resolver system.
 */
async function resolveDocumentChunkDatasetFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<DocumentChunkDataset> {
  const datasets = registry.has(DOCUMENT_CHUNK_DATASET)
    ? registry.get<Map<string, DocumentChunkDataset>>(DOCUMENT_CHUNK_DATASET)
    : getGlobalDocumentChunkDataset();

  const dataset = datasets.get(id);
  if (!dataset) {
    throw new Error(`Document chunk dataset "${id}" not found in registry`);
  }
  return dataset;
}

// Register the dataset resolver for format: "dataset:document-chunk"
registerInputResolver("dataset:document-chunk", resolveDocumentChunkDatasetFromRegistry);
