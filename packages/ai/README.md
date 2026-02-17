# @workglow/ai

Core AI abstractions and functionality for Workglow AI task pipelines.

## Overview

The `@workglow/ai` package provides the core AI abstractions, job definitions, and task implementations that form the foundation of Workglow's AI task execution system. It defines the interfaces and base classes that AI providers implement, along with a comprehensive set of AI tasks ready for use.

## Features

- **Built-in AI Tasks**: Pre-implemented tasks for common AI operations
- **Provider Interface**: Standard interface for AI service providers
- **Model Management**: Complete system for managing AI models and their associations with tasks, and can persist with multiple storage backends
- **Multi-Platform Support**: Works in browser, Node.js, and Bun environments
- **Type Safety**: Full TypeScript support with comprehensive type definitions

## Installation

```bash
bun add @workglow/ai
```

## Quick Start

Here's a complete example of setting up and using the AI package with the Hugging Face Transformers ONNX provider from `@workglow/ai-provider`:

```typescript
import {
  TextGenerationTask,
  TextEmbeddingTask,
  getGlobalModelRepository,
  setGlobalModelRepository,
  InMemoryModelRepository,
  AiJob,
  AiJobInput,
} from "@workglow/ai";
import { Workflow, getTaskQueueRegistry, TaskInput, TaskOutput } from "@workglow/task-graph";
import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import { HFT_TASKS, HF_TRANSFORMERS_ONNX, HuggingFaceTransformersProvider } from "@workglow/ai-provider";

// 1. Set up a model repository
const modelRepo = new InMemoryModelRepository();
setGlobalModelRepository(modelRepo);

// 2. Add a local ONNX model (Hugging Face Transformers)
await modelRepo.addModel({
  model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
  tasks: ["TextGenerationTask","TextRewriterTask"],
  title: "LaMini-Flan-T5-783M",
  description: "LaMini-Flan-T5-783M quantized to 8bit",
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text2text-generation",
    model_path: "Xenova/LaMini-Flan-T5-783M"
});

// 3. Register provider (inline mode requires HFT_TASKS via constructor, creates queue automatically)
await new HuggingFaceTransformersProvider(HFT_TASKS).register({ mode: "inline" });

// 4. Or manually set up job queue (when queue.autoCreate: false)
const queueName = HF_TRANSFORMERS_ONNX;
const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(queueName);

const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(AiJob, {
  storage,
  queueName,
  limiter: new ConcurrencyLimiter(1),
});

const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
  storage,
  queueName,
});

client.attach(server);
getTaskQueueRegistry().registerQueue({ server, client, storage });
await server.start();

// 6. Create and run a workflow
const workflow = new Workflow();

const result = await workflow
  .TextGenerationTask({
    model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
    prompt: "Write a short story about a robot learning to paint.",
    maxTokens: 200,
    temperature: 0.8,
  })
  .run();

console.log(result.text);
```

## Available AI Tasks

### Text Processing Tasks

#### TextGenerationTask

Generates text based on prompts using language models.

```typescript
import { TextGenerationTask } from "@workglow/ai";

const task = new TextGenerationTask({
  model: "onnx:Xenova/gpt2:q8",
  prompt: "Explain quantum computing in simple terms",
});

const result = await task.run();
// Output: { text: "Quantum computing is..." }
```

#### TextEmbeddingTask

Generates vector embeddings for text using embedding models.

```typescript
import { TextEmbeddingTask } from "@workglow/ai";

const task = new TextEmbeddingTask({
  model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
  text: "This is a sample text for embedding",
});

const result = await task.run();
// Output: { vector: [0.1, -0.2, 0.3, ...] }
```

#### TextTranslationTask

Translates text between different languages.

```typescript
import { TextTranslationTask } from "@workglow/ai";

const task = new TextTranslationTask({
  model: "translation-model",
  text: "Hello, how are you?",
  source_lang: "en",
  target_lang: "es",
});

const result = await task.run();
// Output: { translatedText: "Hola, ¿cómo estás?" }
```

#### TextSummaryTask

Generates summaries of longer text content.

```typescript
import { TextSummaryTask } from "@workglow/ai";

const task = new TextSummaryTask({
  model: "onnx:Falconsai/text_summarization:fp32",
  text: "Long article content here...",
  maxLength: 100,
});

const result = await task.run();
// Output: { summary: "Brief summary of the article..." }
```

#### TextRewriterTask

Rewrites text in different styles or tones.

```typescript
import { TextRewriterTask } from "@workglow/ai";

const task = new TextRewriterTask({
  model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
  text: "This is a formal business proposal.",
  style: "casual",
});

const result = await task.run();
// Output: { rewrittenText: "This is a casual business idea..." }
```

#### TextQuestionAnswerTask

Answers questions based on provided context.

```typescript
import { TextQuestionAnswerTask } from "@workglow/ai";

const task = new TextQuestionAnswerTask({
  model: "onnx:Xenova/distilbert-base-uncased-distilled-squad:q8",
  context: "The capital of France is Paris. It has a population of about 2.1 million.",
  question: "What is the population of Paris?",
});

const result = await task.run();
// Output: { answer: "About 2.1 million" }
```

### Analysis Tasks

#### VectorSimilarityTask

Computes similarity between texts or embeddings.

```typescript
import { VectorSimilarityTask } from "@workglow/ai";

const task = new VectorSimilarityTask({
  model: "onnx:Supabase/gte-small:q8",
  text1: "I love programming",
  text2: "Coding is my passion",
});

const result = await task.run();
// Output: { similarity: 0.85 }
```

### Model Management Tasks

#### DownloadModelTask

Downloads and prepares AI models for use.

```typescript
import { DownloadModelTask } from "@workglow/ai";

import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider";

const task = new DownloadModelTask({
  modelName: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
  modelUrl: "Xenova/LaMini-Flan-T5-783M",
  provider: HF_TRANSFORMERS_ONNX,
});

const result = await task.run();
// Output: { status: "downloaded", path: "/models/..." }
```

## Model Management

### Setting Up Models

Models are managed through the `ModelRepository` system. You can use different storage backends:

#### In-Memory Repository (Development)

```typescript
import { InMemoryModelRepository, setGlobalModelRepository } from "@workglow/ai";

const modelRepo = new InMemoryModelRepository();
setGlobalModelRepository(modelRepo);
```

#### IndexedDB Repository (Browser)

```typescript
import { IndexedDbModelRepository, setGlobalModelRepository } from "@workglow/ai";

const modelRepo = new IndexedDbModelRepository("models", "task2models");
setGlobalModelRepository(modelRepo);
```

#### SQLite Repository (Server)

```typescript
import { SqliteModelRepository, setGlobalModelRepository } from "@workglow/ai";

const modelRepo = new SqliteModelRepository("./models.db");
setGlobalModelRepository(modelRepo);
```

#### PostgreSQL Repository (Production)

```typescript
import { PostgresModelRepository, setGlobalModelRepository } from "@workglow/ai";
import { Pool } from "pg";

const pool = new Pool({
  user: "username",
  host: "localhost",
  database: "mydb",
  password: "password",
  port: 5432,
});

const modelRepo = new PostgresModelRepository(pool);
setGlobalModelRepository(modelRepo);
```

### Adding Models

```typescript
import { getGlobalModelRepository } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider";

const modelRepo = getGlobalModelRepository();

// Add an ONNX model from Hugging Face
await modelRepo.addModel({
  name: "onnx:Xenova/gpt2:q8",
  url: "Xenova/gpt2",
  provider: HF_TRANSFORMERS_ONNX,
  availableOnBrowser: true,
  availableOnServer: true,
  contextWindow: 8192,
});

// Connect model to specific tasks
await modelRepo.connectTaskToModel("TextGenerationTask", "onnx:Xenova/gpt2:q8");

// Find models for a specific task
const textGenModels = await modelRepo.findModelsByTask("TextGenerationTask");
```

## Provider Setup

AI providers handle the actual execution of AI tasks. You need to register provider functions for each model provider and task type combination.

### Basic Provider Registration

```typescript
import { HFT_TASKS, HuggingFaceTransformersProvider } from "@workglow/ai-provider";

// Registers run functions for all supported AI tasks on the current thread (inline mode requires HFT_TASKS)
await new HuggingFaceTransformersProvider(HFT_TASKS).register({ mode: "inline" });
```

### Worker-Based Provider Registration

For compute-intensive tasks that should run in workers:

```typescript
import { HuggingFaceTransformersProvider } from "@workglow/ai-provider";

await new HuggingFaceTransformersProvider().register({
  mode: "worker",
  worker: new Worker(new URL("./worker_hft.ts", import.meta.url), { type: "module" }),
});
// Worker file must call HFT_WORKER_JOBRUN_REGISTER() from @workglow/ai-provider
```

### Job Queue Setup

Each provider needs a job queue for task execution:

```typescript
import { getTaskQueueRegistry, TaskInput, TaskOutput } from "@workglow/task-graph";
import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import { AiJob, AiJobInput } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider";

const queueName = HF_TRANSFORMERS_ONNX;
const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(queueName);

const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(AiJob, {
  storage,
  queueName,
  limiter: new ConcurrencyLimiter(1),
});

const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
  storage,
  queueName,
});

client.attach(server);
getTaskQueueRegistry().registerQueue({ server, client, storage });
await server.start();
```

## Workflow Integration

AI tasks integrate seamlessly with Workglow workflows:

```typescript
import { Workflow } from "@workglow/task-graph";
import { TextGenerationTask, TextEmbeddingTask, VectorSimilarityTask } from "@workglow/ai";

const workflow = new Workflow();

// Chain AI tasks together
const result = await workflow
  .textGeneration({
    model: "onnx:Xenova/gpt2:q8",
    prompt: "Write about artificial intelligence",
  })
  .textEmbedding({
    model: "onnx:Supabase/gte-small:q8",
    text: workflow.previous().text, // Use previous task output
  })
  .similarity({
    model: "onnx:Supabase/gte-small:q8",
    text1: "artificial intelligence",
    embedding2: workflow.previous().vector, // Use embedding from previous task
  })
  .run();

console.log("Final similarity score:", result.similarity);
```

## RAG (Retrieval-Augmented Generation) Pipelines

The AI package provides a comprehensive set of tasks for building RAG pipelines. These tasks chain together in workflows without requiring external loops.

### Document Processing Tasks

| Task                      | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `StructuralParserTask`    | Parses markdown/text into hierarchical document trees |
| `TextChunkerTask`         | Splits text into chunks with configurable strategies  |
| `HierarchicalChunkerTask` | Token-aware chunking that respects document structure |
| `TopicSegmenterTask`      | Segments text by topic using heuristics or embeddings |
| `DocumentEnricherTask`    | Adds summaries and entities to document nodes         |

### Vector and Storage Tasks

| Task                    | Description                              |
| ----------------------- | ---------------------------------------- |
| `ChunkToVectorTask`     | Transforms chunks to vector store format |
| `ChunkVectorUpsertTask` | Stores vectors in a repository           |
| `ChunkVectorSearchTask` | Searches vectors by similarity           |
| `VectorQuantizeTask`    | Quantizes vectors for storage efficiency |

### Retrieval and Generation Tasks

| Task                          | Description                                   |
| ----------------------------- | --------------------------------------------- |
| `QueryExpanderTask`           | Expands queries for better retrieval coverage |
| `ChunkVectorHybridSearchTask` | Combines vector and full-text search          |
| `RerankerTask`                | Reranks search results for relevance          |
| `HierarchyJoinTask`           | Enriches results with parent context          |
| `ContextBuilderTask`          | Builds context for LLM prompts                |
| `ChunkRetrievalTask`          | Orchestrates end-to-end retrieval             |

### Complete RAG Workflow Example

```typescript
import { Workflow } from "@workglow/task-graph";
import { InMemoryVectorRepository } from "@workglow/storage";

const vectorRepo = new InMemoryVectorRepository();
await vectorRepo.setupDatabase();

// Document ingestion - fully chainable, no loops required
await new Workflow()
  .structuralParser({
    text: markdownContent,
    title: "Documentation",
    format: "markdown",
  })
  .documentEnricher({
    generateSummaries: true,
    extractEntities: true,
  })
  .hierarchicalChunker({
    maxTokens: 512,
    overlap: 50,
    strategy: "hierarchical",
  })
  .textEmbedding({
    model: "Xenova/all-MiniLM-L6-v2",
  })
  .chunkToVector()
  .vectorStoreUpsert({
    repository: vectorRepo,
  })
  .run();

// Query pipeline
const answer = await new Workflow()
  .queryExpander({
    query: "What is transfer learning?",
    method: "multi-query",
    numVariations: 3,
  })
  .textEmbedding({
    model: "Xenova/all-MiniLM-L6-v2",
  })
  .vectorStoreSearch({
    repository: vectorRepo,
    topK: 10,
    scoreThreshold: 0.5,
  })
  .reranker({
    query: "What is transfer learning?",
    topK: 5,
  })
  .contextBuilder({
    format: "markdown",
    maxLength: 2000,
  })
  .textQuestionAnswer({
    question: "What is transfer learning?",
    model: "Xenova/LaMini-Flan-T5-783M",
  })
  .run();
```

### Hierarchical Document Structure

Documents are represented as trees with typed nodes:

```typescript
type DocumentNode =
  | DocumentRootNode // Root of document
  | SectionNode // Headers, structural sections
  | ParagraphNode // Text blocks
  | SentenceNode // Fine-grained (optional)
  | TopicNode; // Detected topic segments
```

Each node contains:

- `nodeId` - Deterministic content-based ID
- `range` - Source character offsets
- `text` - Content
- `enrichment` - Summaries, entities, keywords (optional)
- `children` - Child nodes (for parent nodes)

### Task Data Flow

Each task passes through what the next task needs:

| Task                  | Passes Through           | Adds                                  |
| --------------------- | ------------------------ | ------------------------------------- |
| `structuralParser`    | -                        | `doc_id`, `documentTree`, `nodeCount` |
| `documentEnricher`    | `doc_id`, `documentTree` | `summaryCount`, `entityCount`         |
| `hierarchicalChunker` | `doc_id`                 | `chunks`, `text[]`, `count`           |
| `textEmbedding`       | (implicit)               | `vector[]`                            |
| `chunkToVector`       | -                        | `ids[]`, `vectors[]`, `metadata[]`    |
| `vectorStoreUpsert`   | -                        | `count`, `ids`                        |

This design eliminates the need for external loops - the entire pipeline chains together naturally.

## Error Handling

AI tasks include comprehensive error handling:

```typescript
import { TaskConfigurationError } from "@workglow/task-graph";

try {
  const task = new TextGenerationTask({
    model: "nonexistent-model",
    prompt: "Test prompt",
  });

  const result = await task.run();
} catch (error) {
  if (error instanceof TaskConfigurationError) {
    console.error("Configuration error:", error.message);
    // Handle missing model, invalid parameters, etc.
  } else {
    console.error("Runtime error:", error.message);
    // Handle API failures, network issues, etc.
  }
}
```

## Advanced Configuration

### Model Input Resolution

AI tasks accept model inputs as either string identifiers or direct `ModelConfig` objects. When a string is provided, the TaskRunner automatically resolves it to a `ModelConfig` before task execution using the `ModelRepository`.

```typescript
import { TextGenerationTask } from "@workglow/ai";

// Using a model ID (resolved from ModelRepository)
const task1 = new TextGenerationTask({
  model: "onnx:Xenova/gpt2:q8",
  prompt: "Generate text",
});

// Using a direct ModelConfig object
const task2 = new TextGenerationTask({
  model: {
    model_id: "onnx:Xenova/gpt2:q8",
    provider: "hf-transformers-onnx",
    tasks: ["TextGenerationTask"],
    title: "GPT-2",
    provider_config: { pipeline: "text-generation" },
  },
  prompt: "Generate text",
});

// Both approaches work identically
```

This resolution is handled by the input resolver system, which inspects schema `format` annotations (like `"model"` or `"model:TextGenerationTask"`) to determine how string values should be resolved.

### Supported Format Annotations

| Format                            | Description                              | Resolver                   |
| --------------------------------- | ---------------------------------------- | -------------------------- |
| `model`                           | Any AI model configuration               | ModelRepository            |
| `model:TaskName`                  | Model compatible with specific task type | ModelRepository            |
| `repository:tabular`              | Tabular data repository                  | TabularStorageRegistry     |
| `repository:document-node-vector` | Vector storage repository                | VectorRepositoryRegistry   |
| `repository:document`             | Document repository                      | DocumentRepositoryRegistry |

### Custom Model Validation

Tasks automatically validate that specified models exist and are compatible:

```typescript
// Models are validated before task execution
const task = new TextGenerationTask({
  model: "onnx:Xenova/gpt2:q8", // Must exist in ModelRepository and be connected to TextGenerationTask
  prompt: "Generate text",
});

// Validation happens during task.run()
```

### Progress Tracking

Monitor AI task progress:

```typescript
const task = new TextGenerationTask({
  model: "onnx:Xenova/gpt2:q8",
  prompt: "Long generation task...",
});

task.on("progress", (progress, message, details) => {
  console.log(`Progress: ${progress}% - ${message}`);
});

const result = await task.run();
```

### Task Cancellation

All AI tasks support cancellation via AbortSignal:

```typescript
const controller = new AbortController();

const task = new TextGenerationTask({
  model: "onnx:Xenova/gpt2:q8",
  prompt: "Generate text...",
});

// Cancel after 10 seconds
setTimeout(() => controller.abort(), 10000);

try {
  const result = await task.run({ signal: controller.signal });
} catch (error) {
  if (error.name === "AbortError") {
    console.log("Task was cancelled");
  }
}
```

## Environment-Specific Usage

### Browser Usage

```typescript
import { IndexedDbModelRepository } from "@workglow/ai";

// Use IndexedDB for persistent storage in browser
const modelRepo = new IndexedDbModelRepository();
```

### Node.js Usage

```typescript
import { SqliteModelRepository } from "@workglow/ai";

// Use SQLite for server-side storage
const modelRepo = new SqliteModelRepository("./models.db");
```

### Bun Usage

```typescript
import { InMemoryModelRepository } from "@workglow/ai";

// Direct imports work with Bun via conditional exports
const modelRepo = new InMemoryModelRepository();
```

## Dependencies

This package depends on:

- `@workglow/job-queue` - Job queue system for task execution
- `@workglow/storage` - Storage abstractions for model and data persistence
- `@workglow/task-graph` - Task graph system for workflow management
- `@workglow/util` - Utility functions and shared components, including JSON Schema types and utilities

## License

Apache 2.0 - See [LICENSE](./LICENSE) for details.
