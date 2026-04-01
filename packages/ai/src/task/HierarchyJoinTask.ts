/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ChunkRecordArraySchema,
  TypeKnowledgeBase,
  type ChunkRecord,
  type KnowledgeBase,
} from "@workglow/knowledge-base";
import { CreateWorkflow, IExecuteContext, TaskConfig, Task, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {
    knowledgeBase: TypeKnowledgeBase({
      title: "Knowledge Base",
      description: "The knowledge base to query for hierarchy",
    }),
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Chunks",
      description: "Retrieved text chunks",
    },
    chunk_ids: {
      type: "array",
      items: { type: "string" },
      title: "Chunk IDs",
      description: "IDs of retrieved chunks",
    },
    metadata: ChunkRecordArraySchema,
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
  required: ["knowledgeBase", "chunks", "chunk_ids", "metadata", "scores"],
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
    chunk_ids: {
      type: "array",
      items: { type: "string" },
      title: "Chunk IDs",
      description: "IDs of retrieved chunks",
    },
    metadata: ChunkRecordArraySchema,
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
  required: ["chunks", "chunk_ids", "metadata", "scores", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HierarchyJoinTaskInput = FromSchema<typeof inputSchema>;
export type HierarchyJoinTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Task for enriching search results with hierarchy information
 * Joins chunk IDs back to knowledge base to get parent summaries and entities
 */
export class HierarchyJoinTask extends Task<
  HierarchyJoinTaskInput,
  HierarchyJoinTaskOutput,
  TaskConfig
> {
  public static override type = "HierarchyJoinTask";
  public static override category = "RAG";
  public static override title = "Hierarchy Join";
  public static override description = "Enrich search results with document hierarchy context";
  public static override cacheable = false; // Has external dependency

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: HierarchyJoinTaskInput,
    context: IExecuteContext
  ): Promise<HierarchyJoinTaskOutput> {
    const {
      knowledgeBase,
      chunks,
      chunk_ids,
      metadata,
      scores,
      includeParentSummaries = true,
      includeEntities = true,
    } = input;

    const kb = knowledgeBase as KnowledgeBase;
    const enrichedMetadata: ChunkRecord[] = [];

    for (let i = 0; i < chunk_ids.length; i++) {
      const chunkId = chunk_ids[i];
      const originalMetadata: ChunkRecord | undefined = metadata[i] as ChunkRecord | undefined;

      if (!originalMetadata) {
        enrichedMetadata.push({} as ChunkRecord);
        continue;
      }

      const doc_id = originalMetadata.doc_id;
      const leafNodeId = originalMetadata.leafNodeId;

      if (!doc_id || !leafNodeId) {
        enrichedMetadata.push(originalMetadata);
        continue;
      }

      try {
        const ancestors = await kb.getAncestors(doc_id, leafNodeId);

        const enriched: ChunkRecord = { ...originalMetadata };

        if (includeParentSummaries && ancestors.length > 0) {
          const parentSummaries: string[] = [];
          const sectionTitles: string[] = [];

          for (const ancestor of ancestors) {
            if (ancestor.enrichment?.summary) {
              parentSummaries.push(ancestor.enrichment.summary);
            }
            if (ancestor.kind === "section" && "title" in ancestor) {
              sectionTitles.push(ancestor.title as string);
            }
          }

          if (parentSummaries.length > 0) {
            enriched.parentSummaries = parentSummaries;
          }
          if (sectionTitles.length > 0) {
            enriched.sectionTitles = sectionTitles;
          }
        }

        if (includeEntities && ancestors.length > 0) {
          const allEntities: Array<{ text: string; type: string; score: number }> = [];

          for (const ancestor of ancestors) {
            if (ancestor.enrichment?.entities) {
              allEntities.push(...ancestor.enrichment.entities);
            }
          }

          const uniqueEntities = new Map<string, { text: string; type: string; score: number }>();
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
        console.error(`Failed to join hierarchy for chunk ${chunkId}:`, error);
        enrichedMetadata.push(originalMetadata);
      }
    }

    return {
      chunks,
      chunk_ids,
      metadata: enrichedMetadata,
      scores,
      count: chunks.length,
    };
  }
}

export const hierarchyJoin = (input: HierarchyJoinTaskInput, config?: TaskConfig) => {
  return new HierarchyJoinTask({} as HierarchyJoinTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    hierarchyJoin: CreateWorkflow<HierarchyJoinTaskInput, HierarchyJoinTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.hierarchyJoin = CreateWorkflow(HierarchyJoinTask);
