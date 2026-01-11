/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DocumentRepository } from "@workglow/storage";
import {
  type ChunkMetadata,
  ChunkMetadataArraySchema,
  EnrichedChunkMetadataArraySchema,
} from "@workglow/storage";
import {
  CreateWorkflow,
  IExecuteContext,
  JobQueueTaskConfig,
  Task,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    documentRepository: {
      title: "Document Repository",
      description: "The document repository to query for hierarchy",
    },
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Chunks",
      description: "Retrieved text chunks",
    },
    ids: {
      type: "array",
      items: { type: "string" },
      title: "Chunk IDs",
      description: "IDs of retrieved chunks",
    },
    metadata: ChunkMetadataArraySchema,
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Scores",
      description: "Similarity scores for each result",
    },
    includeParentSummaries: {
      type: "boolean",
      title: "Include Parent Summaries",
      description: "Whether to include summaries from parent nodes",
      default: true,
    },
    includeEntities: {
      type: "boolean",
      title: "Include Entities",
      description: "Whether to include entities from the node hierarchy",
      default: true,
    },
  },
  required: ["documentRepository", "chunks", "ids", "metadata", "scores"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Chunks",
      description: "Retrieved text chunks",
    },
    ids: {
      type: "array",
      items: { type: "string" },
      title: "Chunk IDs",
      description: "IDs of retrieved chunks",
    },
    metadata: EnrichedChunkMetadataArraySchema,
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Scores",
      description: "Similarity scores",
    },
    count: {
      type: "number",
      title: "Count",
      description: "Number of results",
    },
  },
  required: ["chunks", "ids", "metadata", "scores", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HierarchyJoinTaskInput = FromSchema<typeof inputSchema>;
export type HierarchyJoinTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Task for enriching search results with hierarchy information
 * Joins chunk IDs back to document repository to get parent summaries and entities
 */
export class HierarchyJoinTask extends Task<
  HierarchyJoinTaskInput,
  HierarchyJoinTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "HierarchyJoinTask";
  public static category = "RAG";
  public static title = "Hierarchy Join";
  public static description = "Enrich search results with document hierarchy context";
  public static cacheable = false; // Has external dependency

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async execute(
    input: HierarchyJoinTaskInput,
    context: IExecuteContext
  ): Promise<HierarchyJoinTaskOutput> {
    const {
      documentRepository,
      chunks,
      ids,
      metadata,
      scores,
      includeParentSummaries = true,
      includeEntities = true,
    } = input;

    const repo = documentRepository as DocumentRepository;
    const enrichedMetadata: any[] = [];

    for (let i = 0; i < ids.length; i++) {
      const chunkId = ids[i];
      const originalMetadata: ChunkMetadata | undefined = metadata[i];

      if (!originalMetadata) {
        // Skip if metadata is missing
        enrichedMetadata.push({} as ChunkMetadata);
        continue;
      }

      // Extract doc_id and nodeId from metadata
      const doc_id = originalMetadata.doc_id;
      const leafNodeId = originalMetadata.leafNodeId;

      if (!doc_id || !leafNodeId) {
        // Can't enrich without IDs
        enrichedMetadata.push(originalMetadata);
        continue;
      }

      try {
        // Get ancestors from document repository
        const ancestors = await repo.getAncestors(doc_id, leafNodeId);

        const enriched: any = { ...originalMetadata };

        // Add parent summaries
        if (includeParentSummaries && ancestors.length > 0) {
          const parentSummaries: string[] = [];
          const sectionTitles: string[] = [];

          for (const ancestor of ancestors) {
            if (ancestor.enrichment?.summary) {
              parentSummaries.push(ancestor.enrichment.summary);
            }
            if (ancestor.kind === "section" && (ancestor as any).title) {
              sectionTitles.push((ancestor as any).title);
            }
          }

          if (parentSummaries.length > 0) {
            enriched.parentSummaries = parentSummaries;
          }
          if (sectionTitles.length > 0) {
            enriched.sectionTitles = sectionTitles;
          }
        }

        // Add entities (rolled up from ancestors)
        if (includeEntities && ancestors.length > 0) {
          const allEntities: any[] = [];

          for (const ancestor of ancestors) {
            if (ancestor.enrichment?.entities) {
              allEntities.push(...ancestor.enrichment.entities);
            }
          }

          // Deduplicate entities
          const uniqueEntities = new Map<string, any>();
          for (const entity of allEntities) {
            const existing = uniqueEntities.get(entity.text);
            if (!existing || entity.score > existing.score) {
              uniqueEntities.set(entity.text, entity);
            }
          }

          if (uniqueEntities.size > 0) {
            enriched.entities = Array.from(uniqueEntities.values());
          }
        }

        enrichedMetadata.push(enriched);
      } catch (error) {
        // If join fails, keep original metadata
        console.error(`Failed to join hierarchy for chunk ${chunkId}:`, error);
        enrichedMetadata.push(originalMetadata);
      }
    }

    return {
      chunks,
      ids,
      metadata: enrichedMetadata,
      scores,
      count: chunks.length,
    };
  }
}

export const hierarchyJoin = (input: HierarchyJoinTaskInput, config?: JobQueueTaskConfig) => {
  return new HierarchyJoinTask({} as HierarchyJoinTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    hierarchyJoin: CreateWorkflow<
      HierarchyJoinTaskInput,
      HierarchyJoinTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.hierarchyJoin = CreateWorkflow(HierarchyJoinTask);
