# OpenAI Provider

The OpenAI provider enables text generation using OpenAI's GPT models through the Chat Completions API.

## Features

- **Automatic Token Parameter Selection**: The provider automatically uses the correct token parameter based on the model:
  - `max_tokens` for older models (GPT-3.5, GPT-4, GPT-4 Turbo, etc.)
  - `max_completion_tokens` for newer models (o1-preview, o1-mini, and future o1 models)
- **Flexible Configuration**: Supports temperature, top-p, frequency penalty, and presence penalty
- **Error Handling**: Clear error messages for API issues and missing credentials

## Usage

### Basic Setup

```typescript
import { OpenAIProvider, OPENAI_TASKS } from "@workglow/ai-provider";

// Register the provider in inline mode
await new OpenAIProvider(OPENAI_TASKS).register({ mode: "inline" });
```

### Configuration

The provider can be configured using environment variables or model config:

**Environment Variables:**
- `OPENAI_API_KEY`: Your OpenAI API key (required)

**Model Config:**
```typescript
const model: OpenAIModelConfig = {
  provider: "OPENAI",
  provider_config: {
    model: "gpt-4",
    api_key: "your-api-key", // Optional, overrides env var
    base_url: "https://api.openai.com/v1", // Optional, defaults to OpenAI
  },
};
```

### Text Generation Example

```typescript
import { textGeneration } from "@workglow/ai";

const result = await textGeneration({
  model: {
    provider: "OPENAI",
    provider_config: {
      model: "gpt-4",
    },
  },
  prompt: "Write a short story about AI",
  maxTokens: 500,
  temperature: 0.7,
  topP: 0.9,
});

console.log(result.text);
```

## Supported Models

The provider works with all OpenAI Chat Completion models, including:

### Standard Models (use `max_tokens`)
- GPT-3.5 Turbo
- GPT-4
- GPT-4 Turbo
- GPT-4 Vision

### O1 Series Models (use `max_completion_tokens`)
- o1-preview
- o1-mini
- Future o1 models

## Supported Tasks

- `DownloadModelTask`: Verifies API credentials (no-op for cloud models)
- `TextGenerationTask`: Generates text using Chat Completions API

## Token Parameter Handling

The provider automatically detects which token parameter to use based on the model name:

```typescript
// For GPT-4: uses max_tokens
{
  model: "gpt-4",
  messages: [...],
  max_tokens: 100
}

// For o1-preview: uses max_completion_tokens
{
  model: "o1-preview", 
  messages: [...],
  max_completion_tokens: 100
}
```

This ensures compatibility with both legacy and newer OpenAI models without manual configuration.

## Error Handling

The provider includes comprehensive error handling:

- **Missing API Key**: Clear error message if OPENAI_API_KEY is not set
- **API Errors**: Detailed error messages including status code and response body
- **Network Issues**: Propagates fetch errors with context

## Future Enhancements

Potential additions for future versions:
- Support for streaming responses
- Support for function calling
- Support for vision models
- Support for embeddings endpoint
- Retry logic with exponential backoff
