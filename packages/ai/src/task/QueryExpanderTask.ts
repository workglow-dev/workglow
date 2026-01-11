/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteContext,
  JobQueueTaskConfig,
  Task,
  TaskRegistry,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

export const QueryExpansionMethod = {
  MULTI_QUERY: "multi-query",
  HYDE: "hyde",
  SYNONYMS: "synonyms",
  PARAPHRASE: "paraphrase",
} as const;

export type QueryExpansionMethod = (typeof QueryExpansionMethod)[keyof typeof QueryExpansionMethod];

const inputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      title: "Query",
      description: "The original query to expand",
    },
    method: {
      type: "string",
      enum: Object.values(QueryExpansionMethod),
      title: "Expansion Method",
      description: "Method to use for query expansion",
      default: QueryExpansionMethod.MULTI_QUERY,
    },
    numVariations: {
      type: "number",
      title: "Number of Variations",
      description: "Number of query variations to generate",
      minimum: 1,
      maximum: 10,
      default: 3,
    },
    model: {
      type: "string",
      title: "Model",
      description: "LLM model to use for expansion (for HyDE and paraphrase methods)",
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      items: { type: "string" },
      title: "Expanded Queries",
      description: "Generated query variations",
    },
    originalQuery: {
      type: "string",
      title: "Original Query",
      description: "The original input query",
    },
    method: {
      type: "string",
      title: "Method Used",
      description: "The expansion method that was used",
    },
    count: {
      type: "number",
      title: "Count",
      description: "Number of queries generated",
    },
  },
  required: ["queries", "originalQuery", "method", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type QueryExpanderTaskInput = FromSchema<typeof inputSchema>;
export type QueryExpanderTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Task for expanding queries to improve retrieval coverage.
 * Supports multiple expansion methods including multi-query, HyDE, and paraphrasing.
 *
 * Note: HyDE and paraphrase methods require an LLM model.
 * For now, this implements simple rule-based expansion.
 */
export class QueryExpanderTask extends Task<
  QueryExpanderTaskInput,
  QueryExpanderTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "QueryExpanderTask";
  public static category = "RAG";
  public static title = "Query Expander";
  public static description = "Expand queries to improve retrieval coverage";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async execute(
    input: QueryExpanderTaskInput,
    context: IExecuteContext
  ): Promise<QueryExpanderTaskOutput> {
    const { query, method = QueryExpansionMethod.MULTI_QUERY, numVariations = 3 } = input;

    let queries: string[];

    switch (method) {
      case QueryExpansionMethod.HYDE:
        queries = this.hydeExpansion(query, numVariations);
        break;
      case QueryExpansionMethod.SYNONYMS:
        queries = this.synonymExpansion(query, numVariations);
        break;
      case QueryExpansionMethod.PARAPHRASE:
        queries = this.paraphraseExpansion(query, numVariations);
        break;
      case QueryExpansionMethod.MULTI_QUERY:
      default:
        queries = this.multiQueryExpansion(query, numVariations);
        break;
    }

    // Always include original query
    if (!queries.includes(query)) {
      queries.unshift(query);
    }

    return {
      queries,
      originalQuery: query,
      method,
      count: queries.length,
    };
  }

  /**
   * Multi-query expansion: Generate variations by rephrasing the question
   */
  private multiQueryExpansion(query: string, numVariations: number): string[] {
    const queries: string[] = [query];

    // Simple rule-based variations
    const variations: string[] = [];

    // Question word variations
    if (query.toLowerCase().startsWith("what")) {
      variations.push(query.replace(/^what/i, "Which"));
      variations.push(query.replace(/^what/i, "Can you explain"));
    } else if (query.toLowerCase().startsWith("how")) {
      variations.push(query.replace(/^how/i, "What is the method to"));
      variations.push(query.replace(/^how/i, "In what way"));
    } else if (query.toLowerCase().startsWith("why")) {
      variations.push(query.replace(/^why/i, "What is the reason"));
      variations.push(query.replace(/^why/i, "For what purpose"));
    } else if (query.toLowerCase().startsWith("where")) {
      variations.push(query.replace(/^where/i, "In which location"));
      variations.push(query.replace(/^where/i, "At what place"));
    }

    // Add "Tell me about" variation
    if (!query.toLowerCase().startsWith("tell me")) {
      variations.push(`Tell me about ${query.toLowerCase()}`);
    }

    // Add "Explain" variation
    if (!query.toLowerCase().startsWith("explain")) {
      variations.push(`Explain ${query.toLowerCase()}`);
    }

    // Take up to numVariations
    for (let i = 0; i < Math.min(numVariations - 1, variations.length); i++) {
      if (variations[i] && !queries.includes(variations[i])) {
        queries.push(variations[i]);
      }
    }

    return queries;
  }

  /**
   * HyDE (Hypothetical Document Embeddings): Generate hypothetical answers
   */
  private hydeExpansion(query: string, numVariations: number): string[] {
    // TODO: in a real implementation, this would call a model to generate hypothetical answer templates
    const queries: string[] = [query];

    const templates = [
      `The answer to "${query}" is that`,
      `Regarding ${query}, it is important to note that`,
      `${query} can be explained by the fact that`,
      `In response to ${query}, one should consider that`,
    ];

    for (let i = 0; i < Math.min(numVariations - 1, templates.length); i++) {
      queries.push(templates[i]);
    }

    return queries;
  }

  /**
   * Synonym expansion: Replace keywords with synonyms
   */
  private synonymExpansion(query: string, numVariations: number): string[] {
    const queries: string[] = [query];

    // Simple synonym dictionary (in production, use a proper thesaurus)
    const synonyms: Record<string, string[]> = {
      find: ["locate", "discover", "search for"],
      create: ["make", "build", "generate"],
      delete: ["remove", "erase", "eliminate"],
      update: ["modify", "change", "edit"],
      show: ["display", "present", "reveal"],
      explain: ["describe", "clarify", "elaborate"],
      help: ["assist", "aid", "support"],
      problem: ["issue", "challenge", "difficulty"],
      solution: ["answer", "resolution", "fix"],
      method: ["approach", "technique", "way"],
    };

    const words = query.toLowerCase().split(/\s+/);
    let variationsGenerated = 0;

    for (const [word, syns] of Object.entries(synonyms)) {
      if (variationsGenerated >= numVariations - 1) break;

      const wordIndex = words.indexOf(word);
      if (wordIndex !== -1) {
        for (const syn of syns) {
          if (variationsGenerated >= numVariations - 1) break;

          const newWords = [...words];
          newWords[wordIndex] = syn;
          const newQuery = newWords.join(" ");

          // Preserve original capitalization pattern
          const capitalizedQuery = this.preserveCapitalization(query, newQuery);
          if (!queries.includes(capitalizedQuery)) {
            queries.push(capitalizedQuery);
            variationsGenerated++;
          }
        }
      }
    }

    return queries;
  }

  /**
   * Paraphrase expansion: Rephrase the query
   * TODO: This should use an LLM for better paraphrasing
   */
  private paraphraseExpansion(query: string, numVariations: number): string[] {
    const queries: string[] = [query];

    // Simple paraphrase templates
    const paraphrases: string[] = [];

    // Add context
    paraphrases.push(`I need information about ${query.toLowerCase()}`);
    paraphrases.push(`Can you help me understand ${query.toLowerCase()}`);
    paraphrases.push(`I'm looking for details on ${query.toLowerCase()}`);

    for (let i = 0; i < Math.min(numVariations - 1, paraphrases.length); i++) {
      if (!queries.includes(paraphrases[i])) {
        queries.push(paraphrases[i]);
      }
    }

    return queries;
  }

  /**
   * Preserve capitalization pattern from original to new query
   */
  private preserveCapitalization(original: string, modified: string): string {
    if (original[0] === original[0].toUpperCase()) {
      return modified.charAt(0).toUpperCase() + modified.slice(1);
    }
    return modified;
  }
}


export const queryExpander = (input: QueryExpanderTaskInput, config?: JobQueueTaskConfig) => {
  return new QueryExpanderTask({} as QueryExpanderTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    queryExpander: CreateWorkflow<
      QueryExpanderTaskInput,
      QueryExpanderTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.queryExpander = CreateWorkflow(QueryExpanderTask);
