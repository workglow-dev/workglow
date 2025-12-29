# @workglow/ai-provider

AI provider implementations for Workglow AI task pipelines.

## Overview

The `@workglow/ai-provider` package provides concrete implementations of AI providers that can be used with Workglow's task execution system. It includes support for various AI services and local model execution frameworks.

## Features

- **HuggingFace Transformers**: Support for ONNX models via HuggingFace Transformers.js
- **TensorFlow MediaPipe**: Integration with Google's MediaPipe for text processing tasks
- [FUTURE] **OpenAI Integration**: Support for OpenAI API services
- [FUTURE] **GGML Support**: Local model execution with GGML format models
- **Multi-Platform**: Works in browser, Node.js, and Bun environments
- **Worker Support**: Offload AI computation to web workers for better performance
- **Type Safety**: Full TypeScript support with comprehensive type definitions

## Installation

```bash
npm install @workglow/ai-provider
# or
bun add @workglow/ai-provider
```

## Peer Dependencies

Depending on which providers you use, you may need to install additional peer dependencies:

```bash
# For HuggingFace Transformers support
npm install @sroussey/transformers

# For MediaPipe support
npm install @mediapipe/tasks-text @mediapipe/tasks-vision @mediapipe/tasks-audio @mediapipe/tasks-genai
```

## Quick Start

### 1. Basic Setup

```typescript
import { register_HFT_InlineJobFns, register_TFMP_InlineJobFns } from "@workglow/ai-provider";

// Register AI providers
await register_HFT_InlineJobFns();
await register_TFMP_InlineJobFns();
```

### 2. Using AI Tasks in Workflows

```typescript
import {
  TextGenerationTask,
  TextEmbeddingTask,
  TextTranslationTask,
  TextSummaryTask,
} from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";

const workflow = new Workflow();

// Add AI tasks to your workflow
const result = await workflow
  .add(
    new TextGenerationTask({
      model: "Xenova/gpt2",
      prompt: "The future of AI is",
    })
  )
  .add(
    new TextEmbeddingTask({
      model: "Xenova/all-MiniLM-L6-v2",
      text: "Hello world",
    })
  )
  .run();
```

## Available Providers

### HuggingFace Transformers (`HF_TRANSFORMERS_ONNX`)

Supports ONNX models from HuggingFace Hub with the following task types:

#### Supported Tasks

- **DownloadModelTask**: Pre-download and cache models
- **UnloadModelTask**: Unload models from memory
- **TextGenerationTask**: Generate text from prompts
- **TextEmbeddingTask**: Generate vector embeddings for text
- **TextTranslationTask**: Translate text between languages
- **TextSummaryTask**: Summarize long text
- **TextRewriterTask**: Rewrite text with a given prompt
- **TextQuestionAnswerTask**: Answer questions based on context
- **TextLanguageDetectionTask**: Detect the language of text
- **TextClassificationTask**: Classify text into categories
- **TextFillMaskTask**: Fill in masked text
- **TextNamedEntityRecognitionTask**: Recognize named entities in text
- **TextRewriterTask**: Rewrite text with a given prompt
- **ImageSegmentationTask**: Segment images into regions
- **ImageToTextTask**: Convert images to text
- **BackgroundRemovalTask**: Remove background from images
- **ImageEmbeddingTask**: Generate vector embeddings for images
- **ImageClassificationTask**: Classify images into categories
- **ObjectDetectionTask**: Detect objects in images

#### Task Examples

**Text Generation:**

```typescript
import { TextGenerationTask } from "@workglow/ai";

const task = new TextGenerationTask({
  model: "Xenova/gpt2",
  prompt: "Once upon a time",
  maxTokens: 50,
  temperature: 0.7,
  topP: 0.9,
  frequencyPenalty: 0,
  presencePenalty: 0,
});

const result = await task.execute();
// result.text: string - Generated text
```

**Text Embedding:**

```typescript
import { TextEmbeddingTask } from "@workglow/ai";

const task = new TextEmbeddingTask({
  model: "Xenova/all-MiniLM-L6-v2",
  text: "This is a sample text for embedding",
});

const result = await task.execute();
// result.vector: TypedArray - Vector embedding
```

**Text Translation:**

```typescript
import { TextTranslationTask } from "@workglow/ai";

const task = new TextTranslationTask({
  model: "Xenova/t5-small",
  text: "Hello world",
  source_lang: "en",
  target_lang: "fr",
});

const result = await task.execute();
// result.text: string - Translated text
// result.target_lang: string - Target language
```

**Text Summary:**

```typescript
import { TextSummaryTask } from "@workglow/ai";

const task = new TextSummaryTask({
  model: "Xenova/distilbart-cnn-6-6",
  text: "Long text to summarize...",
});

const result = await task.execute();
// result.text: string - Summary text
```

**Text Rewriter:**

```typescript
import { TextRewriterTask } from "@workglow/ai";

const task = new TextRewriterTask({
  model: "Xenova/gpt2",
  text: "The weather is nice today",
  prompt: "Rewrite this as a pirate would say it",
});

const result = await task.execute();
// result.text: string - Rewritten text
```

**Question Answering:**

```typescript
import { TextQuestionAnswerTask } from "@workglow/ai";

const task = new TextQuestionAnswerTask({
  model: "Xenova/distilbert-base-uncased-distilled-squad",
  context: "The capital of France is Paris. It is known for the Eiffel Tower.",
  question: "What is the capital of France?",
});

const result = await task.execute();
// result.text: string - Answer text
```

### TensorFlow MediaPipe (`TENSORFLOW_MEDIAPIPE`)

Optimized for performance using Google's MediaPipe framework.

#### Supported Tasks

- **TextEmbeddingTask**: Generate vector embeddings for text
- **DownloadModelTask**: Pre-download and cache models

#### Example

```typescript
import { TextEmbeddingTask } from "@workglow/ai";

const task = new TextEmbeddingTask({
  model: "path/to/mediapipe/model.tflite",
  text: "Text to embed",
});

const result = await task.execute();
// result.vector: Float32Array - Vector embedding
```

## Advanced Usage

### Worker Setup

For better performance, especially in browser environments, run AI inference in web workers:

#### Main Thread Setup

```typescript
import { register_HFT_ClientJobFns, register_TFMP_ClientJobFns } from "@workglow/ai-provider";

// Register HuggingFace Transformers with worker
register_HFT_ClientJobFns(
  new Worker(new URL("./hft-worker.ts", import.meta.url), { type: "module" })
);

// Register MediaPipe with worker
register_TFMP_ClientJobFns(
  new Worker(new URL("./tfmp-worker.ts", import.meta.url), { type: "module" })
);
```

#### Worker Setup Files

**hft-worker.ts:**

```typescript
import { register_HFT_WorkerJobFns } from "@workglow/ai-provider";

// Register HuggingFace Transformers worker functions
register_HFT_WorkerJobFns();
```

**tfmp-worker.ts:**

```typescript
import { register_TFMP_WorkerJobFns } from "@workglow/ai-provider";

// Register MediaPipe worker functions
register_TFMP_WorkerJobFns();
```

### Model Management

```typescript
import { getGlobalModelRepository } from "@workglow/ai";
import { DownloadModelTask } from "@workglow/ai";

// Pre-download models
const downloadTask = new DownloadModelTask({
  model: "Xenova/all-MiniLM-L6-v2",
});

await downloadTask.execute();

// Models are automatically cached for subsequent use
```

### Custom Job Queue Configuration

```typescript
import {
  JobQueueClient,
  JobQueueServer,
  ConcurrencyLimiter,
  DelayLimiter,
} from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import { register_HFT_InlineJobFns, HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider";

// Configure queue with custom limits
const customQueue = new JobQueueServer(HF_TRANSFORMERS_ONNX, AiJob, {
  storage: new InMemoryQueueStorage(HF_TRANSFORMERS_ONNX),
  queueName: HF_TRANSFORMERS_ONNX,
  limiter: new ConcurrencyLimiter(2, 1000), // 2 concurrent jobs, 1000ms timeout
});

const client = new JobQueueClient({
  storage: new InMemoryQueueStorage(HF_TRANSFORMERS_ONNX),
  queueName: HF_TRANSFORMERS_ONNX,
});

client.attach(customQueue);
// Register AI providers
await register_HFT_InlineJobFns(client);
```

### Error Handling

```typescript
import { PermanentJobError, AbortSignalJobError } from "@workglow/job-queue";

try {
  const task = new TextGenerationTask({
    model: "invalid-model",
    prompt: "Test",
  });

  await task.execute();
} catch (error) {
  if (error instanceof PermanentJobError) {
    console.error("Permanent error:", error.message);
  } else if (error instanceof AbortSignalJobError) {
    console.error("Task was aborted");
  }
}
```

### Progress Tracking

```typescript
const task = new TextGenerationTask({
  model: "Xenova/gpt2",
  prompt: "Generate text...",
});

// Listen for progress updates
task.on("progress", (progress, message, details) => {
  console.log(`Progress: ${progress}% - ${message}`, details);
});

await task.execute();
```

## Complete Working Example

```typescript
import { HF_TRANSFORMERS_ONNX, register_HFT_InlineJobFns } from "@workglow/ai-provider";
import { TextGenerationTask, TextEmbeddingTask, AiJob } from "@workglow/ai";
import { Workflow, getTaskQueueRegistry } from "@workglow/task-graph";

async function main() {
  // 1. Register the AI provider
  await register_HFT_InlineJobFns();

  // 2. Create and run workflow
  const workflow = new Workflow();

  const result = await workflow
    .add(
      new TextGenerationTask({
        model: "Xenova/gpt2",
        prompt: "The benefits of AI include",
        maxTokens: 50,
      })
    )
    .add(
      new TextEmbeddingTask({
        model: "Xenova/all-MiniLM-L6-v2",
        text: "AI is transforming the world",
      })
    )
    .run();

  console.log("Generated text:", result.outputs[0].text);
  console.log("Embedding dimensions:", result.outputs[1].vector.length);
}

main().catch(console.error);
```

## Task Input/Output Schemas

### Common Types

```typescript
// Model reference (string)
model: string

// Text input/output
text: string

// Vector embedding (typed array)
vector: Float32Array | Float64Array | Int32Array | etc.

// Language codes (ISO 639-1)
source_lang: string  // e.g., "en", "fr", "es"
target_lang: string
```

### Task Schemas Summary

| Task                       | Input                                                                                     | Output                  |
| -------------------------- | ----------------------------------------------------------------------------------------- | ----------------------- |
| **TextGenerationTask**     | `{ model, prompt, maxTokens?, temperature?, topP?, frequencyPenalty?, presencePenalty? }` | `{ text }`              |
| **TextEmbeddingTask**      | `{ model, text }`                                                                         | `{ vector }`            |
| **TextTranslationTask**    | `{ model, text, source_lang, target_lang }`                                               | `{ text, target_lang }` |
| **TextSummaryTask**        | `{ model, text }`                                                                         | `{ text }`              |
| **TextRewriterTask**       | `{ model, text, prompt }`                                                                 | `{ text }`              |
| **TextQuestionAnswerTask** | `{ model, context, question }`                                                            | `{ text }`              |
| **DownloadModelTask**      | `{ model }`                                                                               | `{ model }`             |

## Popular Models

### HuggingFace Transformers Models

**Text Generation:**

- `Xenova/gpt2` - GPT-2 text generation
- `Xenova/distilgpt2` - Smaller GPT-2 variant

**Text Embedding:**

- `Xenova/all-MiniLM-L6-v2` - General purpose embeddings
- `Xenova/all-mpnet-base-v2` - High quality embeddings

**Translation:**

- `Xenova/t5-small` - Multilingual translation
- `Xenova/marian-mt-en-fr` - English to French

**Summarization:**

- `Xenova/distilbart-cnn-6-6` - News summarization
- `Xenova/t5-small` - General summarization

**Question Answering:**

- `Xenova/distilbert-base-uncased-distilled-squad` - SQuAD trained

## Dependencies

This package depends on:

- `@workglow/ai` - Core AI abstractions
- `@workglow/job-queue` - Job queue system
- `@workglow/storage` - Storage abstractions
- `@workglow/task-graph` - Task graph system
- `@workglow/util` - Utility functions

## License

Apache 2.0 - See [LICENSE](./LICENSE) for details.
