/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema, FromSchema, JsonSchema } from "@workglow/util";

/**
 * Node kind discriminator for hierarchical document structure
 */
export const NodeKind = {
  DOCUMENT: "document",
  SECTION: "section",
  PARAGRAPH: "paragraph",
  SENTENCE: "sentence",
  TOPIC: "topic",
} as const;

export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

// =============================================================================
// Schema Definitions
// =============================================================================

/**
 * Schema for source range of a node (character offsets)
 */
export const NodeRangeSchema = {
  type: "object",
  properties: {
    startOffset: {
      type: "integer",
      title: "Start Offset",
      description: "Starting character offset",
    },
    endOffset: {
      type: "integer",
      title: "End Offset",
      description: "Ending character offset",
    },
  },
  required: ["startOffset", "endOffset"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type NodeRange = FromSchema<typeof NodeRangeSchema>;

/**
 * Schema for named entity extracted from text
 */
export const EntitySchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Entity text",
    },
    type: {
      type: "string",
      title: "Type",
      description: "Entity type (e.g., PERSON, ORG, LOC)",
    },
    score: {
      type: "number",
      title: "Score",
      description: "Confidence score",
    },
  },
  required: ["text", "type", "score"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type Entity = FromSchema<typeof EntitySchema>;

/**
 * Schema for enrichment data attached to a node
 */
export const NodeEnrichmentSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      title: "Summary",
      description: "Summary of the node content",
    },
    entities: {
      type: "array",
      items: EntitySchema,
      title: "Entities",
      description: "Named entities extracted from the node",
    },
    keywords: {
      type: "array",
      items: { type: "string" },
      title: "Keywords",
      description: "Keywords associated with the node",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type NodeEnrichment = FromSchema<typeof NodeEnrichmentSchema>;

/**
 * Schema for base document node fields (used for runtime validation)
 * Note: Individual node types and DocumentNode union are defined as interfaces
 * below because FromSchema cannot properly infer recursive discriminated unions.
 */
export const DocumentNodeBaseSchema = {
  type: "object",
  properties: {
    nodeId: {
      type: "string",
      title: "Node ID",
      description: "Unique identifier for this node",
    },
    kind: {
      type: "string",
      enum: Object.values(NodeKind),
      title: "Kind",
      description: "Node type discriminator",
    },
    range: NodeRangeSchema,
    text: {
      type: "string",
      title: "Text",
      description: "Text content of the node",
    },
    enrichment: NodeEnrichmentSchema,
  },
  required: ["nodeId", "kind", "range", "text"],
  additionalProperties: true,
} as const satisfies DataPortSchema;

/**
 * Schema for document node (generic, for runtime validation)
 * This is a simplified schema for task input/output validation.
 * The actual TypeScript types use a proper discriminated union.
 */
export const DocumentNodeSchema = {
  type: "object",
  title: "Document Node",
  description: "A node in the hierarchical document tree",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    level: {
      type: "integer",
      title: "Level",
      description: "Header level for section nodes",
    },
    title: {
      type: "string",
      title: "Title",
      description: "Section title",
    },
    children: {
      type: "array",
      title: "Children",
      description: "Child nodes",
    },
  },
  required: [...DocumentNodeBaseSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Schema for paragraph node
 */
export const ParagraphNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.PARAGRAPH,
      title: "Kind",
      description: "Node type discriminator",
    },
  },
  required: [...DocumentNodeBaseSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Schema for sentence node
 */
export const SentenceNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.SENTENCE,
      title: "Kind",
      description: "Node type discriminator",
    },
  },
  required: [...DocumentNodeBaseSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Schema for section node
 */
export const SectionNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.SECTION,
      title: "Kind",
      description: "Node type discriminator",
    },
    level: {
      type: "integer",
      minimum: 1,
      maximum: 6,
      title: "Level",
      description: "Header level (1-6 for markdown)",
    },
    title: {
      type: "string",
      title: "Title",
      description: "Section title",
    },
    children: {
      type: "array",
      items: DocumentNodeSchema,
      title: "Children",
      description: "Child nodes",
    },
  },
  required: [...DocumentNodeBaseSchema.required, "level", "title", "children"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Schema for topic node
 */
export const TopicNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.TOPIC,
      title: "Kind",
      description: "Node type discriminator",
    },
    children: {
      type: "array",
      items: DocumentNodeSchema,
      title: "Children",
      description: "Child nodes",
    },
  },
  required: [...DocumentNodeBaseSchema.required, "children"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Schema for document root node
 */
export const DocumentRootNodeSchema = {
  type: "object",
  properties: {
    ...DocumentNodeBaseSchema.properties,
    kind: {
      type: "string",
      const: NodeKind.DOCUMENT,
      title: "Kind",
      description: "Node type discriminator",
    },
    title: {
      type: "string",
      title: "Title",
      description: "Document title",
    },
    children: {
      type: "array",
      items: DocumentNodeSchema,
      title: "Children",
      description: "Child nodes",
    },
  },
  required: [...DocumentNodeBaseSchema.required, "title", "children"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

// =============================================================================
// Manually-defined interfaces for recursive discriminated union types
// These provide better TypeScript inference than FromSchema for recursive types
// =============================================================================

/**
 * Base document node fields
 */
interface DocumentNodeBase {
  readonly nodeId: string;
  readonly kind: NodeKind;
  readonly range: NodeRange;
  readonly text: string;
  readonly enrichment?: NodeEnrichment;
}

/**
 * Document root node
 */
export interface DocumentRootNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.DOCUMENT;
  readonly title: string;
  readonly children: DocumentNode[];
}

/**
 * Section node (from markdown headers or structural divisions)
 */
export interface SectionNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.SECTION;
  readonly level: number;
  readonly title: string;
  readonly children: DocumentNode[];
}

/**
 * Paragraph node
 */
export interface ParagraphNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.PARAGRAPH;
}

/**
 * Sentence node (optional fine-grained segmentation)
 */
export interface SentenceNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.SENTENCE;
}

/**
 * Topic segment node (from TopicSegmenter)
 */
export interface TopicNode extends DocumentNodeBase {
  readonly kind: typeof NodeKind.TOPIC;
  readonly children: DocumentNode[];
}

/**
 * Discriminated union of all document node types
 */
export type DocumentNode =
  | DocumentRootNode
  | SectionNode
  | ParagraphNode
  | SentenceNode
  | TopicNode;

// =============================================================================
// Token Budget and Chunk Schemas
// =============================================================================

/**
 * Schema for token budget configuration
 */
export const TokenBudgetSchema = {
  type: "object",
  properties: {
    maxTokensPerChunk: {
      type: "integer",
      title: "Max Tokens Per Chunk",
      description: "Maximum tokens allowed per chunk",
    },
    overlapTokens: {
      type: "integer",
      title: "Overlap Tokens",
      description: "Number of tokens to overlap between chunks",
    },
    reservedTokens: {
      type: "integer",
      title: "Reserved Tokens",
      description: "Tokens reserved for metadata or context",
    },
  },
  required: ["maxTokensPerChunk", "overlapTokens", "reservedTokens"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TokenBudget = FromSchema<typeof TokenBudgetSchema>;

/**
 * Schema for chunk enrichment
 */
export const ChunkEnrichmentSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      title: "Summary",
      description: "Summary of the chunk content",
    },
    entities: {
      type: "array",
      items: EntitySchema,
      title: "Entities",
      description: "Named entities extracted from the chunk",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ChunkEnrichment = FromSchema<typeof ChunkEnrichmentSchema>;

/**
 * Schema for chunk node (output of HierarchicalChunker)
 */
export const ChunkNodeSchema = () =>
  ({
    type: "object",
    properties: {
      chunkId: {
        type: "string",
        title: "Chunk ID",
        description: "Unique identifier for this chunk",
      },
      docId: {
        type: "string",
        title: "Master Document ID",
        description: "ID of the parent master document",
      },
      text: {
        type: "string",
        title: "Text",
        description: "Text content of the chunk",
      },
      nodePath: {
        type: "array",
        items: { type: "string" },
        title: "Node Path",
        description: "Node IDs from root to leaf",
      },
      depth: {
        type: "integer",
        title: "Depth",
        description: "Depth in the document tree",
      },
      enrichment: ChunkEnrichmentSchema,
    },
    required: ["chunkId", "docId", "text", "nodePath", "depth"],
    additionalProperties: false,
  }) as const satisfies DataPortSchema;

export type ChunkNode = FromSchema<ReturnType<typeof ChunkNodeSchema>>;

// =============================================================================
// Chunk Metadata Schemas (for vector store)
// =============================================================================

/**
 * Schema for chunk metadata stored in vector database
 * This is the metadata output from ChunkToVectorTask
 */
export const ChunkMetadataSchema = {
  type: "object",
  properties: {
    docId: {
      type: "string",
      title: "Master Document ID",
      description: "ID of the parent master document",
    },
    chunkId: {
      type: "string",
      title: "Chunk ID",
      description: "Unique identifier for this chunk",
    },
    leafNodeId: {
      type: "string",
      title: "Leaf Node ID",
      description: "ID of the leaf node this chunk belongs to",
    },
    depth: {
      type: "integer",
      title: "Depth",
      description: "Depth in the document tree",
    },
    text: {
      type: "string",
      title: "Text",
      description: "Text content of the chunk",
    },
    nodePath: {
      type: "array",
      items: { type: "string" },
      title: "Node Path",
      description: "Node IDs from root to leaf",
    },
    summary: {
      type: "string",
      title: "Summary",
      description: "Summary of the chunk content",
    },
    entities: {
      type: "array",
      items: EntitySchema,
      title: "Entities",
      description: "Named entities extracted from the chunk",
    },
  },
  required: ["docId", "chunkId", "leafNodeId", "depth", "text", "nodePath"],
  additionalProperties: true,
} as const satisfies DataPortSchema;

export type ChunkMetadata = FromSchema<typeof ChunkMetadataSchema>;

/**
 * Schema for chunk metadata array (for use in task schemas)
 */
export const ChunkMetadataArraySchema = {
  type: "array",
  items: ChunkMetadataSchema,
  title: "Chunk Metadata",
  description: "Metadata for each chunk",
} as const satisfies JsonSchema;

/**
 * Schema for enriched chunk metadata (after HierarchyJoinTask)
 * Extends ChunkMetadata with hierarchy information from document repository
 */
export const EnrichedChunkMetadataSchema = {
  type: "object",
  properties: {
    docId: {
      type: "string",
      title: "Master Document ID",
      description: "ID of the parent master document",
    },
    chunkId: {
      type: "string",
      title: "Chunk ID",
      description: "Unique identifier for this chunk",
    },
    leafNodeId: {
      type: "string",
      title: "Leaf Node ID",
      description: "ID of the leaf node this chunk belongs to",
    },
    depth: {
      type: "integer",
      title: "Depth",
      description: "Depth in the document tree",
    },
    text: {
      type: "string",
      title: "Text",
      description: "Text content of the chunk",
    },
    nodePath: {
      type: "array",
      items: { type: "string" },
      title: "Node Path",
      description: "Node IDs from root to leaf",
    },
    summary: {
      type: "string",
      title: "Summary",
      description: "Summary of the chunk content",
    },
    entities: {
      type: "array",
      items: EntitySchema,
      title: "Entities",
      description: "Named entities (rolled up from hierarchy)",
    },
    parentSummaries: {
      type: "array",
      items: { type: "string" },
      title: "Parent Summaries",
      description: "Summaries from ancestor nodes",
    },
    sectionTitles: {
      type: "array",
      items: { type: "string" },
      title: "Section Titles",
      description: "Titles of ancestor section nodes",
    },
  },
  required: ["docId", "chunkId", "leafNodeId", "depth", "text", "nodePath"],
  additionalProperties: true,
} as const satisfies DataPortSchema;

export type EnrichedChunkMetadata = FromSchema<typeof EnrichedChunkMetadataSchema>;

/**
 * Schema for enriched chunk metadata array (for use in task schemas)
 */
export const EnrichedChunkMetadataArraySchema = {
  type: "array",
  items: EnrichedChunkMetadataSchema,
  title: "Enriched Metadata",
  description: "Metadata enriched with hierarchy information",
} as const satisfies JsonSchema;

// =============================================================================
// Master Document Schemas
// =============================================================================

/**
 * Schema for document metadata
 */
export const DocumentMetadataSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      title: "Title",
      description: "Document title",
    },
    sourceUri: {
      type: "string",
      title: "Source URI",
      description: "Original source URI of the document",
    },
    createdAt: {
      type: "string",
      title: "Created At",
      description: "ISO timestamp of creation",
    },
  },
  required: ["title"],
  additionalProperties: true,
} as const satisfies DataPortSchema;

export type DocumentMetadata = FromSchema<typeof DocumentMetadataSchema>;
