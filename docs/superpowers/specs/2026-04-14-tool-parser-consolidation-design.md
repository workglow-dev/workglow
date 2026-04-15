# Tool Parser Consolidation & FunctionGemma Removal

**Date:** 2026-04-14
**Scope:** `packages/ai-provider/src/common/`, `packages/ai-provider/src/provider-hf-transformers/common/`, `packages/ai-provider/src/provider-llamacpp/common/`, `packages/test/src/test/ai-provider/`

## Problem

Three files contain overlapping tool-call parsing logic:

1. **`common/ToolCallParsers.ts`** — shared library with all 18+ model-family parsers, ReDoS-safe helpers, and public API. Already used by both HFT and LlamaCpp providers.
2. **`HFT_ToolParser.ts`** — 918-line stale duplicate of the same parsers as private functions. Zero imports anywhere in the codebase — fully dead code.
3. **`LlamaCpp_ToolParser.ts`** — already delegates parsing to `ToolCallParsers.ts`, but also contains FunctionGemma prompt-building logic and shared utility functions that are duplicated in `HFT_ToolCalling.ts`.

Additionally, several utility functions are duplicated across `HFT_ToolCalling.ts` and `LlamaCpp_ToolParser.ts`/`LlamaCpp_ToolCalling.ts`:

- `extractMessageText` / `extractTextFromContent` (same logic, different names)
- `forcedToolSelection` (identical in both)
- `adaptParserResult` (same concept, slightly different signatures)
- `toolChoiceForcesToolCall`, `resolveParsedToolName` (LlamaCpp-only but generic)

FunctionGemma (a 270M parameter model by Google) has dedicated prompt-building and parsing support across multiple files but has never worked reliably. It should be removed entirely.

## Changes

### 1. Delete dead file

Delete `provider-hf-transformers/common/HFT_ToolParser.ts`. It has zero imports — `HFT_ToolCalling.ts` already imports from `common/ToolCallParsers.ts`.

### 2. Remove FunctionGemma support

**From `common/ToolCallParsers.ts`:**

- Remove `parseFunctionGemma`, `parseFunctionGemmaArgs`, `parseFunctionGemmaArgumentValue`, `parseFunctionGemmaLooseObject`
- Remove `functiongemma` key from `MODEL_PARSERS`
- Update `gemma` parser chain from `[parseFunctionGemma, parseGemma, parseHermes]` to `[parseGemma, parseHermes]`
- Remove `parseFunctionGemma` from `DEFAULT_PARSER_CHAIN`
- Remove `"functiongemma"` case from `getGenerationPrefix` (function remains, returns `undefined` for all families — preserves the extension point)
- Remove FunctionGemma branches from `parseToolCallsFromText`

**From `provider-llamacpp/common/LlamaCpp_ToolParser.ts`:**

- Remove all FunctionGemma detection, declaration schema, developer prompt, conversation prompt, value serialization, raw prompt building (~200 lines: `detectFunctionGemmaModel`, `functionGemmaDeclarationSchema`, `buildFunctionGemmaDeclarations`, `buildFunctionGemmaDeveloperPrompt`, `extractMessageText`, `serializeFunctionGemmaValue`, `serializeFunctionGemmaToolCall`, `buildFunctionGemmaConversationPrompt`, `buildFunctionGemmaRawPrompt`)
- Remove `buildRawCompletionPrompt` (always returned `undefined` without FunctionGemma detection)
- Remove `supportsNativeFunctions` (always returned `true` without FunctionGemma detection)
- Remove `truncateAtTurnBoundary` (only used by raw completion path)
- Remove FunctionGemma branch from `extractToolCallsFromText`
- Remove `parseFunctionGemma`, `parseFunctionGemmaLooseObject` imports

**From `provider-llamacpp/common/LlamaCpp_ToolCalling.ts`:**

- Remove the entire raw completion code path in both `LlamaCpp_ToolCalling` (non-streaming) and `LlamaCpp_ToolCalling_Stream` (streaming): the `if (rawPrompt !== undefined)` branches with `LlamaCompletion`
- Remove `llamaCppRawCompletionOptions` function (only used by raw path)
- Remove `LlamaCompletion` from `getLlamaCppSdk()` destructuring
- Remove `buildRawCompletionPrompt`, `supportsNativeFunctions`, `truncateAtTurnBoundary` imports
- Always pass `functions` to `LlamaChat.generateResponse` (previously gated by `supportsNativeFunctions`)

**From tests:**

- `LlamaCpp_Generic.integration.test.ts`: remove `functionGemmaToolModel` definition, its `addModel()` call, and the comment referencing it
- `LlamaCpp_ChatWrapper.integration.test.ts`: remove the FunctionGemma entry from the `toolModels` array
- `LlamaCpp_NativeToolCalling.integration.test.ts`: remove the FunctionGemma entry from the `models` array
- `HFT_Generic.integration.test.ts`: remove `TOOL_MODEL_ID` constant, `toolModel` definition, and its `addModel()` call

### 3. Move shared utilities to `ToolCallParsers.ts`

Extract duplicated functions from provider-specific files into the shared library:

| Function                                                                | Source files                                                                  | Notes                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extractMessageText(content: unknown): string`                          | `HFT_ToolCalling.ts`, `LlamaCpp_ToolCalling.ts` (as `extractTextFromContent`) | Identical logic. Single export from `ToolCallParsers.ts`.                                                                                                                                      |
| `forcedToolSelection(input: ToolCallingTaskInput): string \| undefined` | `HFT_ToolCalling.ts`, `LlamaCpp_ToolParser.ts`                                | Identical logic.                                                                                                                                                                               |
| `toolChoiceForcesToolCall(toolChoice): boolean`                         | `LlamaCpp_ToolParser.ts`                                                      | Generic, not LlamaCpp-specific.                                                                                                                                                                |
| `resolveParsedToolName(name, input): string`                            | `LlamaCpp_ToolParser.ts`                                                      | Generic, not LlamaCpp-specific.                                                                                                                                                                |
| `adaptParserResult(result, input?): { text, toolCalls }`                | `HFT_ToolCalling.ts`, `LlamaCpp_ToolParser.ts`                                | Unify into one version that converts `ToolCallParserResult` to `{ text: string, toolCalls: ToolCalls }`, optionally resolving tool names via `resolveParsedToolName` when `input` is provided. |

Both `HFT_ToolCalling.ts` and `LlamaCpp_ToolCalling.ts` then import these from `ToolCallParsers.ts` and delete their local copies.

### 4. Slim down `LlamaCpp_ToolParser.ts`

After removing FunctionGemma and moving shared utilities out, this file retains only LlamaCpp-specific logic that depends on `LlamaCppModelConfig`:

- `getModelTextCandidates(model)` — extracts identifiable text from LlamaCpp model config
- `detectQwenToolCallingVariation(model)` — detects Qwen 3 vs 3.5 format from model config
- `hasToolCallMarkers(text)` — quick presence check for tool-call markup
- `extractToolCallsFromText(text, input)` — orchestrates the parser chain for LlamaCpp, using shared parsers and `adaptParserResult` from `ToolCallParsers.ts`

Estimated ~80 lines after cleanup.

## Resulting file structure

```
ai-provider/src/
├── common/
│   └── ToolCallParsers.ts          # All parsers + shared utilities
├── provider-hf-transformers/
│   └── common/
│       ├── HFT_ToolCalling.ts      # Imports shared utils, no local duplicates
│       ├── HFT_ToolMarkup.ts       # Unchanged (streaming markup filter)
│       └── ...
├── provider-llamacpp/
│   └── common/
│       ├── LlamaCpp_ToolParser.ts   # ~80 lines, LlamaCpp-specific only
│       ├── LlamaCpp_ToolCalling.ts  # Simplified: LlamaChat path only, no raw completion
│       └── ...
└── ...

DELETED: provider-hf-transformers/common/HFT_ToolParser.ts
```

## What is NOT changing

- `ToolCallParsers.ts` parser implementations (Llama, Mistral, Hermes, Cohere, DeepSeek, Phi, InternLM, ChatGLM, Functionary, Gorilla, NexusRaven, xLAM, FireFunction, Granite, Gemma, Liquid, Jamba, Qwen 3.5 XML) — these stay as-is
- `HFT_ToolMarkup.ts` — streaming markup filter, unchanged
- `parseToolCallsFromText` public API shape — still returns `{ text, toolCalls }`, just without FunctionGemma branches
- `ToolCallingTask.integration.test.ts` — no FunctionGemma-specific tests exist here
- Other provider implementations (OpenAI, Anthropic, Gemini, Ollama, etc.) — unaffected

## Verification

- Run `bun scripts/test.ts ai-provider vitest` to verify parser tests pass
- Build with `bun run build:packages` to catch any broken imports
