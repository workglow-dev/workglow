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
import type { DocumentDataset } from "./DocumentDataset";

/**
 * Service token for the document dataset registry
 * Maps dataset IDs to DocumentDataset instances
 */
export const DOCUMENT_DATASETS =
  createServiceToken<Map<string, DocumentDataset>>("dataset.documents");

// Register default factory if not already registered
if (!globalServiceRegistry.has(DOCUMENT_DATASETS)) {
  globalServiceRegistry.register(
    DOCUMENT_DATASETS,
    (): Map<string, DocumentDataset> => new Map(),
    true
  );
}

/**
 * Gets the global document dataset registry
 * @returns Map of document dataset ID to instance
 */
export function getGlobalDocumentDatasets(): Map<string, DocumentDataset> {
  return globalServiceRegistry.get(DOCUMENT_DATASETS);
}

/**
 * Registers a document dataset globally by ID
 * @param id The unique identifier for this dataset
 * @param dataset The dataset instance to register
 */
export function registerDocumentDataset(id: string, dataset: DocumentDataset): void {
  const datasets = getGlobalDocumentDatasets();
  datasets.set(id, dataset);
}

/**
 * Gets a document dataset by ID from the global registry
 * @param id The dataset identifier
 * @returns The dataset instance or undefined if not found
 */
export function getDocumentDataset(id: string): DocumentDataset | undefined {
  return getGlobalDocumentDatasets().get(id);
}

/**
 * Resolves a dataset ID to a DocumentDataset from the registry.
 * Used by the input resolver system.
 */
async function resolveDocumentDatasetFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<DocumentDataset> {
  const datasets = registry.has(DOCUMENT_DATASETS)
    ? registry.get<Map<string, DocumentDataset>>(DOCUMENT_DATASETS)
    : getGlobalDocumentDatasets();

  const dataset = datasets.get(id);
  if (!dataset) {
    throw new Error(`Document dataset "${id}" not found in registry`);
  }
  return dataset;
}

// Register the dataset resolver for format: "dataset:document"
registerInputResolver("dataset:document", resolveDocumentDatasetFromRegistry);
