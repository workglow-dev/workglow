# Tool Parser Consolidation & FunctionGemma Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicated tool-call parsing code across HFT and LlamaCpp providers, remove dead FunctionGemma support, and consolidate shared utilities into `ToolCallParsers.ts`.

**Architecture:** Three-phase cleanup: (1) delete dead code and FunctionGemma, (2) extract shared utilities into `ToolCallParsers.ts`, (3) update consumers to import from the shared location. Each phase is independently committable.

**Tech Stack:** TypeScript, bun test, vitest

**Spec:** `docs/superpowers/specs/2026-04-14-tool-parser-consolidation-design.md`

---

### Task 1: Delete dead `HFT_ToolParser.ts`

**Files:**

- Delete: `packages/ai-provider/src/provider-hf-transformers/common/HFT_ToolParser.ts`

- [ ] **Step 1: Verify no imports exist**

Run: `cd /workspaces/workglow/libs && grep -r "HFT_ToolParser" packages/`
Expected: No matches (file is dead code)

- [ ] **Step 2: Delete the file**

```bash
rm packages/ai-provider/src/provider-hf-transformers/common/HFT_ToolParser.ts
```

- [ ] **Step 3: Verify build**

Run: `bun run build:packages`
Expected: Clean build, no errors

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(ai-provider): delete dead HFT_ToolParser.ts

This file has zero imports — HFT_ToolCalling.ts already imports from
common/ToolCallParsers.ts."
```

---

### Task 2: Remove FunctionGemma from `ToolCallParsers.ts`

**Files:**

- Modify: `packages/ai-provider/src/common/ToolCallParsers.ts`

- [ ] **Step 1: Remove FunctionGemma helper functions**

Delete these functions entirely (lines 188-245):

- `parseFunctionGemmaArgumentValue` (lines 193-218)
- `parseFunctionGemmaLooseObject` (lines 224-245)

- [ ] **Step 2: Remove FunctionGemma parser internals**

Delete these functions entirely (lines 787-864):

- `parseFunctionGemmaArgs` (lines 792-824)
- `parseFunctionGemma` (lines 832-864)

- [ ] **Step 3: Update `MODEL_PARSERS`**

In the `MODEL_PARSERS` object (around line 1115), remove the `functiongemma` entry and update the `gemma` entry:

```typescript
// DELETE this line:
  functiongemma: [parseFunctionGemma, parseGemma, parseHermes],
// CHANGE this line:
  gemma: [parseFunctionGemma, parseGemma, parseHermes],
// TO:
  gemma: [parseGemma, parseHermes],
```

- [ ] **Step 4: Update `DEFAULT_PARSER_CHAIN`**

In the `DEFAULT_PARSER_CHAIN` array (around line 1151), remove the `parseFunctionGemma` entry:

```typescript
// DELETE this line from the array:
  parseFunctionGemma,
```

- [ ] **Step 5: Simplify `getGenerationPrefix`**

Remove the `"functiongemma"` case from the switch statement (around line 1287). The function body becomes:

```typescript
export function getGenerationPrefix(
  family: string | null,
  forcedToolName: string | undefined
): string | undefined {
  if (!family) return undefined;

  switch (family) {
    default:
      return undefined;
  }
}
```

- [ ] **Step 6: Remove FunctionGemma branches from `parseToolCallsFromText`**

In `parseToolCallsFromText` (around line 1320), delete the two FunctionGemma blocks (lines 1324-1344):

```typescript
// DELETE: lines 1324-1335 (FunctionGemma first-try block)
// Try FunctionGemma first
const functionGemmaResult = parseFunctionGemma(responseText);
if (functionGemmaResult && functionGemmaResult.tool_calls.length > 0) {
  return {
    text: functionGemmaResult.content,
    toolCalls: functionGemmaResult.tool_calls.map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.name,
      input: call.arguments,
    })),
  };
}

// DELETE: lines 1337-1344 (FunctionGemma loose-object fallback)
// FunctionGemma loose-object fallback (no tool name context available)
const looseObject = parseFunctionGemmaLooseObject(responseText);
if (looseObject) {
  return {
    text: "",
    toolCalls: [{ id: "call_0", name: "", input: looseObject }],
  };
}
```

Update the JSDoc for `parseToolCallsFromText` to remove the FunctionGemma reference. Change:

```typescript
/**
 * Parse tool calls from model-generated text, returning the workglow `ToolCalls`
 * type directly (with `input` field instead of `arguments`).
 *
 * Tries, in order:
 * 1. FunctionGemma `call:func{...}` syntax
 * 2. `<tool_call>JSON</tool_call>` tags (Qwen/Hermes)
 * 3. Bare JSON objects with `name` + `arguments`/`parameters` keys
 * 4. `{"function": {"name": ..., "arguments": ...}}` format
```

To:

```typescript
/**
 * Parse tool calls from model-generated text, returning the workglow `ToolCalls`
 * type directly (with `input` field instead of `arguments`).
 *
 * Tries, in order:
 * 1. `<tool_call>JSON</tool_call>` tags (Qwen/Hermes)
 * 2. Bare JSON objects with `name` + `arguments`/`parameters` keys
 * 3. `{"function": {"name": ..., "arguments": ...}}` format
```

- [ ] **Step 7: Verify build**

Run: `bun run build:packages`
Expected: Clean build, no errors

- [ ] **Step 8: Commit**

```bash
git add packages/ai-provider/src/common/ToolCallParsers.ts
git commit -m "refactor(ai-provider): remove FunctionGemma from ToolCallParsers

Remove parseFunctionGemma, parseFunctionGemmaArgs,
parseFunctionGemmaArgumentValue, parseFunctionGemmaLooseObject, and all
references in MODEL_PARSERS, DEFAULT_PARSER_CHAIN, getGenerationPrefix,
and parseToolCallsFromText."
```

---

### Task 3: Remove FunctionGemma from `LlamaCpp_ToolParser.ts`

**Files:**

- Modify: `packages/ai-provider/src/provider-llamacpp/common/LlamaCpp_ToolParser.ts`

- [ ] **Step 1: Remove FunctionGemma imports**

At the top of the file (lines 9-10), remove the FunctionGemma imports:

```typescript
// DELETE these two imports from the import block:
  parseFunctionGemma,
  parseFunctionGemmaLooseObject,
```

- [ ] **Step 2: Remove FunctionGemma detection and prompt building**

Delete all FunctionGemma-related code (lines 77-287):

- The section header comment `// FunctionGemma detection & prompt building` (line 77)
- `detectFunctionGemmaModel` (lines 80-82)
- `functionGemmaDeclarationSchema` (lines 84-114)
- `buildFunctionGemmaDeclarations` (lines 116-127)
- `buildFunctionGemmaDeveloperPrompt` (lines 129-142)
- `extractMessageText` (lines 144-157)
- `serializeFunctionGemmaValue` (lines 159-173)
- `serializeFunctionGemmaToolCall` (lines 175-180)
- `buildFunctionGemmaConversationPrompt` (lines 182-247)
- `buildFunctionGemmaRawPrompt` (lines 249-271)
- `buildRawCompletionPrompt` (lines 278-287)

- [ ] **Step 3: Remove `supportsNativeFunctions`**

Delete the `supportsNativeFunctions` function (lines 293-298):

```typescript
// DELETE entirely:
export function supportsNativeFunctions(
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig
): boolean {
  return input.toolChoice !== "none" && !detectFunctionGemmaModel(model);
}
```

- [ ] **Step 4: Remove `truncateAtTurnBoundary`**

Delete the `truncateAtTurnBoundary` function (lines 317-327):

```typescript
// DELETE entirely:
export function truncateAtTurnBoundary(text: string): string {
  const markers = ["\nuser\n", "\ndeveloper\n"];
  let truncateAt = text.length;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx !== -1 && idx < truncateAt) {
      truncateAt = idx;
    }
  }
  return text.slice(0, truncateAt).trim();
}
```

- [ ] **Step 5: Remove FunctionGemma branch from `extractToolCallsFromText`**

In `extractToolCallsFromText` (around line 365), delete the FunctionGemma block (lines 370-383):

```typescript
// DELETE this entire block:
// FunctionGemma models: try dedicated parser first
if (detectFunctionGemmaModel(model)) {
  const functionGemmaResult = parseFunctionGemma(text);
  if (functionGemmaResult && functionGemmaResult.tool_calls.length > 0) {
    return adaptParserResult(functionGemmaResult, input);
  }

  // FunctionGemma loose-object fallback (requires forced tool name)
  const forcedToolName = forcedToolSelection(input);
  const looseObject = forcedToolName ? parseFunctionGemmaLooseObject(text) : undefined;
  if (forcedToolName && looseObject) {
    return [{ id: "call_0", name: forcedToolName, input: looseObject }];
  }
}
```

- [ ] **Step 6: Remove unused imports**

Remove `ToolDefinition` from the import on line 7 (it was only used by `buildFunctionGemmaDeclarations`):

```typescript
// CHANGE:
import type { ToolCallingTaskInput, ToolCalls, ToolDefinition } from "@workglow/ai";
// TO:
import type { ToolCallingTaskInput, ToolCalls } from "@workglow/ai";
```

- [ ] **Step 7: Verify build**

Run: `bun run build:packages`
Expected: Clean build, no errors

- [ ] **Step 8: Commit**

```bash
git add packages/ai-provider/src/provider-llamacpp/common/LlamaCpp_ToolParser.ts
git commit -m "refactor(ai-provider): remove FunctionGemma from LlamaCpp_ToolParser

Remove detection, prompt building, raw completion support,
truncateAtTurnBoundary, and supportsNativeFunctions. The file now
contains only LlamaCpp-specific parser orchestration."
```

---

### Task 4: Remove FunctionGemma raw completion path from `LlamaCpp_ToolCalling.ts`

**Files:**

- Modify: `packages/ai-provider/src/provider-llamacpp/common/LlamaCpp_ToolCalling.ts`

- [ ] **Step 1: Update imports**

Change the import from `LlamaCpp_ToolParser` (lines 18-24) to remove the deleted exports:

```typescript
// CHANGE:
import {
  buildRawCompletionPrompt,
  extractToolCallsFromText,
  supportsNativeFunctions,
  toolChoiceForcesToolCall,
  truncateAtTurnBoundary,
} from "./LlamaCpp_ToolParser";
// TO:
import { extractToolCallsFromText, toolChoiceForcesToolCall } from "./LlamaCpp_ToolParser";
```

- [ ] **Step 2: Remove `llamaCppRawCompletionOptions`**

Delete the `llamaCppRawCompletionOptions` function (lines 183-204):

```typescript
// DELETE entirely (including the JSDoc):
/**
 * Sampling options for {@link LlamaCompletion.generateCompletion} (FunctionGemma raw path).
 * ...
 */
function llamaCppRawCompletionOptions(
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig
): Record<string, unknown> {
  ...
}
```

- [ ] **Step 3: Simplify non-streaming `LlamaCpp_ToolCalling`**

In the non-streaming function (starting around line 247):

Remove `LlamaCompletion` from the SDK destructuring (line 261):

```typescript
// CHANGE:
const { LlamaChat, LlamaCompletion } = getLlamaCppSdk();
// TO:
const { LlamaChat } = getLlamaCppSdk();
```

Delete the entire FunctionGemma raw completion block (lines 264-290):

```typescript
// DELETE this entire block:
// ---- FunctionGemma raw completion path (unchanged) ----
const rawPrompt = buildRawCompletionPrompt(input, model, systemPrompt);

getLogger().debug("LlamaCpp_ToolCalling", { rawPrompt, systemPrompt });

if (rawPrompt !== undefined) {
  const completion = new LlamaCompletion({ contextSequence: sequence });
  try {
    const rawText = await completion.generateCompletion(rawPrompt, {
      signal,
      ...llamaCppRawCompletionOptions(input, model),
    });

    const text = truncateAtTurnBoundary(rawText);
    getLogger().debug("LlamaCpp_ToolCalling LlamaCompletion", { rawText, text });
    const toolCalls = filterValidToolCalls(extractToolCallsFromText(text, input), input.tools);
    getLogger().debug("LlamaCpp_ToolCalling LlamaCompletion", { toolCalls });
    update_progress(100, "Tool calling complete");
    return { text, toolCalls };
  } finally {
    completion.dispose({ disposeSequence: false });
    sequence.dispose();
  }
}
```

Replace the `supportsNativeFunctions` conditional with direct function building (around line 301):

```typescript
// CHANGE:
const functions = supportsNativeFunctions(input, model)
  ? buildChatModelFunctions(input.tools)
  : undefined;
// TO:
const functions = buildChatModelFunctions(input.tools);
```

Update the `generateResponse` call to always pass functions (around line 308). Change:

```typescript
      ...(functions && {
        functions,
        ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
      }),
```

To:

```typescript
      functions,
      ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
```

- [ ] **Step 4: Simplify streaming `LlamaCpp_ToolCalling_Stream`**

In the streaming function (starting around line 413):

Remove `LlamaCompletion` from the SDK destructuring (line 425):

```typescript
// CHANGE:
const { LlamaChat, LlamaCompletion } = getLlamaCppSdk();
// TO:
const { LlamaChat } = getLlamaCppSdk();
```

Delete the entire FunctionGemma raw completion block (lines 428-463):

```typescript
  // DELETE this entire block:
  // ---- FunctionGemma raw completion path ----
  const rawPrompt = buildRawCompletionPrompt(input, model, systemPrompt);

  if (rawPrompt !== undefined) {
    const completion = new LlamaCompletion({ contextSequence: sequence });

    const { text: rawText } = yield* streamTextChunks(
      (onTextChunk) =>
        completion.generateCompletion(rawPrompt, {
          signal,
          ...llamaCppRawCompletionOptions(input, model),
          onTextChunk,
        }),
      signal,
      () => {
        completion.dispose({ disposeSequence: false });
        sequence.dispose();
      }
    );

    const text = truncateAtTurnBoundary(rawText);
    const validToolCalls = filterValidToolCalls(
      extractToolCallsFromText(text, input),
      input.tools
    );

    if (validToolCalls.length > 0) {
      yield { type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] };
    }

    yield {
      type: "finish",
      data: { text, toolCalls: validToolCalls } as ToolCallingTaskOutput,
    };
    return;
  }
```

Replace the `supportsNativeFunctions` conditional with direct function building (around line 474):

```typescript
// CHANGE:
const functions = supportsNativeFunctions(input, model)
  ? buildChatModelFunctions(input.tools)
  : undefined;
// TO:
const functions = buildChatModelFunctions(input.tools);
```

Update the `generateResponse` call to always pass functions (around line 480). Same change as the non-streaming path:

```typescript
// CHANGE:
        ...(functions && {
          functions,
          ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
        }),
// TO:
        functions,
        ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
```

- [ ] **Step 5: Verify build**

Run: `bun run build:packages`
Expected: Clean build, no errors

- [ ] **Step 6: Commit**

```bash
git add packages/ai-provider/src/provider-llamacpp/common/LlamaCpp_ToolCalling.ts
git commit -m "refactor(ai-provider): remove FunctionGemma raw completion path from LlamaCpp_ToolCalling

Remove LlamaCompletion code path, llamaCppRawCompletionOptions, and
supportsNativeFunctions conditional. LlamaChat is now the only path."
```

---

### Task 5: Remove FunctionGemma from tests

**Files:**

- Modify: `packages/test/src/test/ai-provider/LlamaCpp_Generic.integration.test.ts`
- Modify: `packages/test/src/test/ai-provider/LlamaCpp_ChatWrapper.integration.test.ts`
- Modify: `packages/test/src/test/ai-provider/LlamaCpp_NativeToolCalling.integration.test.ts`
- Modify: `packages/test/src/test/ai-provider/HFT_Generic.integration.test.ts`

- [ ] **Step 1: Clean up `LlamaCpp_Generic.integration.test.ts`**

Delete the `functionGemmaToolModel` definition (lines 41-63):

```typescript
// DELETE entirely:
const functionGemmaToolModel: LlamaCppModelRecord = {
  model_id: "llamacpp:unsloth/functiongemma-270m-it-GGUF:Q8_0",
  ...
};
```

Remove `functionGemmaToolModel` from the `toolModelId` comment (line 130):

```typescript
// CHANGE:
const toolModelId = qwen25CoderToolModel.model_id; // or qwen25CoderToolModel.model_id or lfm2ToolModel.model_id or functionGemmaToolModel.model_id or llmModel.model_id or llama3d21bToolModel.model_id
// TO:
const toolModelId = qwen25CoderToolModel.model_id; // or lfm2ToolModel.model_id or llmModel.model_id or llama3d21bToolModel.model_id
```

Delete the `addModel` call for `functionGemmaToolModel` (line 143):

```typescript
// DELETE this line:
await getGlobalModelRepository().addModel(functionGemmaToolModel);
```

- [ ] **Step 2: Clean up `LlamaCpp_ChatWrapper.integration.test.ts`**

Delete the FunctionGemma entry from the `toolModels` array (lines 34-48):

```typescript
// DELETE this object from the array:
  {
    model_id: "llamacpp:unsloth/functiongemma-270m-it-GGUF:Q8_0",
    title: "FunctionGemma 270M IT",
    description: "A 270M parameter instruction-following model with tool calling support",
    tasks: ["DownloadModelTask", "ToolCallingTask"],
    provider: LOCAL_LLAMACPP,
    provider_config: {
      model_path: "./models/hf_unslothfunctiongemma-270m-it-GGUF.Q8_0.gguf",
      model_url: "hf:unsloth/functiongemma-270m-it-GGUF:Q8_0",
      models_dir: "./models",
      flash_attention: true,
      seed: 42,
    },
    metadata: {},
  },
```

- [ ] **Step 3: Clean up `LlamaCpp_NativeToolCalling.integration.test.ts`**

Delete the FunctionGemma entry from the `models` array (line 18):

```typescript
// DELETE this line:
  { label: "FunctionGemma 270M", url: "hf:unsloth/functiongemma-270m-it-GGUF:Q8_0" },
```

- [ ] **Step 4: Clean up `HFT_Generic.integration.test.ts`**

Delete the `TOOL_MODEL_ID` constant (line 27):

```typescript
// DELETE:
const TOOL_MODEL_ID = "onnx:onnx-community/functiongemma-270m-it-ONNX:q4f16";
```

Delete the `toolModel` definition (lines 46-59):

```typescript
// DELETE entirely:
const toolModel: HfTransformersOnnxModelRecord = {
  model_id: TOOL_MODEL_ID,
  title: "FunctionGemma 270M IT ONNX",
  ...
};
```

Delete the `addModel` call for `toolModel` (line 103):

```typescript
// DELETE this line:
await getGlobalModelRepository().addModel(toolModel);
```

- [ ] **Step 5: Verify tests compile**

Run: `bun run build:packages`
Expected: Clean build, no errors

- [ ] **Step 6: Commit**

```bash
git add packages/test/src/test/ai-provider/
git commit -m "test(ai-provider): remove FunctionGemma model definitions from tests"
```

---

### Task 6: Move shared utilities to `ToolCallParsers.ts`

**Files:**

- Modify: `packages/ai-provider/src/common/ToolCallParsers.ts`

- [ ] **Step 1: Add `ToolCallingTaskInput` import**

Update the import at the top of `ToolCallParsers.ts` (line 7):

```typescript
// CHANGE:
import type { ToolCalls } from "@workglow/ai";
// TO:
import type { ToolCallingTaskInput, ToolCalls } from "@workglow/ai";
```

- [ ] **Step 2: Add `extractMessageText`**

Add this function after the `stripModelArtifacts` function (after line 60), in the "Text cleanup" section:

```typescript
/**
 * Extract text from a content block that may be a string, array of content
 * blocks, or other structure.
 */
export function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return String(content ?? "");
  }
  return content
    .filter(
      (block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text"
    )
    .map((block) => String((block as { text?: unknown }).text ?? ""))
    .join("");
}
```

- [ ] **Step 3: Add tool choice utilities**

Add these functions after the shared helpers section (after `tryParseJson`), in a new section:

```typescript
// ============================================================================
// Tool choice utilities
// ============================================================================

export function toolChoiceForcesToolCall(toolChoice: ToolCallingTaskInput["toolChoice"]): boolean {
  return (
    toolChoice === "required" ||
    (toolChoice !== undefined && toolChoice !== "auto" && toolChoice !== "none")
  );
}

export function forcedToolSelection(input: ToolCallingTaskInput): string | undefined {
  if (
    typeof input.toolChoice === "string" &&
    input.toolChoice !== "auto" &&
    input.toolChoice !== "none"
  ) {
    if (input.toolChoice !== "required") {
      return input.toolChoice;
    }
  }
  if (input.toolChoice === "required" && input.tools.length === 1) {
    return input.tools[0]?.name;
  }
  return undefined;
}

export function resolveParsedToolName(name: string, input: ToolCallingTaskInput): string {
  if (input.tools.some((tool) => tool.name === name)) {
    return name;
  }
  return forcedToolSelection(input) ?? name;
}
```

- [ ] **Step 4: Add `adaptParserResult`**

Add this function after the tool choice utilities:

```typescript
/**
 * Convert a low-level parser result to the workglow `ToolCalls` type.
 * When `input` is provided, tool names are resolved against the available
 * tools list (and forced selection is applied for unrecognized names).
 */
export function adaptParserResult(
  result: ToolCallParserResult,
  input?: ToolCallingTaskInput
): { text: string; toolCalls: ToolCalls } {
  return {
    text: stripModelArtifacts(result.content),
    toolCalls: result.tool_calls.map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: input ? resolveParsedToolName(call.name, input) : call.name,
      input: call.arguments,
    })),
  };
}
```

- [ ] **Step 5: Verify build**

Run: `bun run build:packages`
Expected: Clean build, no errors

- [ ] **Step 6: Commit**

```bash
git add packages/ai-provider/src/common/ToolCallParsers.ts
git commit -m "refactor(ai-provider): add shared tool choice utilities to ToolCallParsers

Move extractMessageText, toolChoiceForcesToolCall, forcedToolSelection,
resolveParsedToolName, and adaptParserResult into the shared library."
```

---

### Task 7: Update `HFT_ToolCalling.ts` to use shared utilities

**Files:**

- Modify: `packages/ai-provider/src/provider-hf-transformers/common/HFT_ToolCalling.ts`

- [ ] **Step 1: Update imports from `ToolCallParsers.ts`**

Update the import block (lines 30-35) to include the shared utilities:

```typescript
// CHANGE:
import {
  getAvailableParsers,
  getGenerationPrefix,
  parseToolCalls,
  stripModelArtifacts,
} from "../../common/ToolCallParsers";
// TO:
import {
  adaptParserResult,
  extractMessageText,
  forcedToolSelection,
  getAvailableParsers,
  getGenerationPrefix,
  parseToolCalls,
} from "../../common/ToolCallParsers";
```

- [ ] **Step 2: Remove local `adaptParserResult`**

Delete the local `adaptParserResult` function (lines 72-84):

```typescript
// DELETE entirely:
/**
 * Convert a parser result (using `arguments` field) to the workglow `ToolCalls`
 * type (using `input` field).
 */
function adaptParserResult(result: ReturnType<typeof parseToolCalls>): {
  text: string;
  toolCalls: ToolCalls;
} {
  return {
    text: stripModelArtifacts(result.content),
    toolCalls: result.tool_calls.map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.name,
      input: call.arguments as Record<string, unknown>,
    })),
  };
}
```

- [ ] **Step 3: Remove local `forcedToolSelection`**

Delete the local `forcedToolSelection` function (lines 86-100):

```typescript
// DELETE entirely:
function forcedToolSelection(input: ToolCallingTaskInput): string | undefined {
  if (
    typeof input.toolChoice === "string" &&
    input.toolChoice !== "auto" &&
    input.toolChoice !== "none"
  ) {
    if (input.toolChoice !== "required") {
      return input.toolChoice;
    }
  }
  if (input.toolChoice === "required" && input.tools.length === 1) {
    return input.tools[0]?.name;
  }
  return undefined;
}
```

- [ ] **Step 4: Remove local `extractMessageText`**

Delete the local `extractMessageText` function (lines 173-186):

```typescript
// DELETE entirely:
/**
 * Extract text from a content block that may be a string, array of content
 * blocks, or other structure.
 */
function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return String(content ?? "");
  }
  return content
    .filter(
      (block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text"
    )
    .map((block) => String((block as { text?: unknown }).text ?? ""))
    .join("");
}
```

- [ ] **Step 5: Update `adaptParserResult` call sites**

The shared `adaptParserResult` returns `{ text, toolCalls }` — the same shape as the local version. The two call sites (in `HFT_ToolCalling` and `HFT_ToolCalling_Stream`) use `adaptParserResult(parseToolCalls(...))`. The shared version takes a `ToolCallParserResult` as first arg — `parseToolCalls` returns `ToolCallParserResult`, so these calls work unchanged.

Verify no compilation errors — no code change needed here, just verify.

- [ ] **Step 6: Verify build**

Run: `bun run build:packages`
Expected: Clean build, no errors

- [ ] **Step 7: Run tests**

Run: `bun scripts/test.ts ai-provider vitest`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/ai-provider/src/provider-hf-transformers/common/HFT_ToolCalling.ts
git commit -m "refactor(ai-provider): use shared utilities in HFT_ToolCalling

Import adaptParserResult, extractMessageText, forcedToolSelection from
ToolCallParsers.ts instead of maintaining local copies."
```

---

### Task 8: Update `LlamaCpp_ToolParser.ts` and `LlamaCpp_ToolCalling.ts` to use shared utilities

**Files:**

- Modify: `packages/ai-provider/src/provider-llamacpp/common/LlamaCpp_ToolParser.ts`
- Modify: `packages/ai-provider/src/provider-llamacpp/common/LlamaCpp_ToolCalling.ts`

- [ ] **Step 1: Update `LlamaCpp_ToolParser.ts` imports and remove moved functions**

Update the import from `ToolCallParsers` (around lines 8-16) to include the shared utilities and remove parsers that no longer exist:

```typescript
// CHANGE:
import {
  parseFunctionGemma,
  parseFunctionGemmaLooseObject,
  parseHermes,
  parseLlama,
  parseLiquid,
  parseQwen35Xml,
} from "../../common/ToolCallParsers";
import type { ToolCallParserResult } from "../../common/ToolCallParsers";
// TO:
import {
  adaptParserResult,
  parseHermes,
  parseLlama,
  parseLiquid,
  parseQwen35Xml,
} from "../../common/ToolCallParsers";
```

Remove the local `adaptParserResult` function (around line 357):

```typescript
// DELETE entirely:
function adaptParserResult(result: ToolCallParserResult, input: ToolCallingTaskInput): ToolCalls {
  return result.tool_calls.map((call, index) => ({
    id: call.id ?? `call_${index}`,
    name: resolveParsedToolName(call.name, input),
    input: call.arguments,
  }));
}
```

Remove the local tool choice utilities (lines 39-74) — these are now in the shared library:

```typescript
// DELETE: toolChoiceForcesToolCall (lines 39-44)
// DELETE: forcedToolChoiceName (lines 46-56)
// DELETE: forcedToolSelection (lines 58-67)
// DELETE: resolveParsedToolName (lines 69-74)
```

- [ ] **Step 2: Update `LlamaCpp_ToolCalling.ts` imports**

Update the import from `LlamaCpp_ToolParser` (around lines 18-24, already modified in Task 4):

```typescript
// CHANGE (from Task 4 state):
import { extractToolCallsFromText, toolChoiceForcesToolCall } from "./LlamaCpp_ToolParser";
// TO:
import { extractToolCallsFromText } from "./LlamaCpp_ToolParser";
```

Add `toolChoiceForcesToolCall` and `extractMessageText` to a new import from the shared library. Add after the existing imports:

```typescript
import { extractMessageText, toolChoiceForcesToolCall } from "../../common/ToolCallParsers";
```

- [ ] **Step 3: Remove local `extractTextFromContent` from `LlamaCpp_ToolCalling.ts`**

Delete the `extractTextFromContent` function (lines 52-58):

```typescript
// DELETE entirely:
function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .filter((block: any) => block?.type === "text")
    .map((block: any) => String(block.text ?? ""))
    .join("");
}
```

Update the two call sites that use `extractTextFromContent` to use `extractMessageText` instead:

Line ~299 (non-streaming):

```typescript
// CHANGE:
const promptText =
  typeof input.prompt === "string" ? input.prompt : extractTextFromContent(input.prompt);
// TO:
const promptText =
  typeof input.prompt === "string" ? input.prompt : extractMessageText(input.prompt);
```

Line ~472 (streaming):

```typescript
// CHANGE:
const promptText =
  typeof input.prompt === "string" ? input.prompt : extractTextFromContent(input.prompt);
// TO:
const promptText =
  typeof input.prompt === "string" ? input.prompt : extractMessageText(input.prompt);
```

- [ ] **Step 4: Update `extractToolCallsFromText` in `LlamaCpp_ToolParser.ts`**

The `adaptParserResult` call site now uses the shared version which returns `{ text, toolCalls }` instead of just `ToolCalls`. Update `extractToolCallsFromText` to use `.toolCalls` from the shared result:

```typescript
export function extractToolCallsFromText(text: string, input: ToolCallingTaskInput): ToolCalls {
  // Try Liquid/LFM format
  const liquidResult = parseLiquid(text);
  if (liquidResult && liquidResult.tool_calls.length > 0) {
    return adaptParserResult(liquidResult, input).toolCalls;
  }

  // Try Hermes/JSON format
  const hermesResult = parseHermes(text);
  if (hermesResult && hermesResult.tool_calls.length > 0) {
    return adaptParserResult(hermesResult, input).toolCalls;
  }

  // Try Qwen 3.5 XML format
  const qwen35Result = parseQwen35Xml(text);
  if (qwen35Result && qwen35Result.tool_calls.length > 0) {
    return adaptParserResult(qwen35Result, input).toolCalls;
  }

  // Try Llama/bare JSON format
  const llamaResult = parseLlama(text);
  if (llamaResult && llamaResult.tool_calls.length > 0) {
    return adaptParserResult(llamaResult, input).toolCalls;
  }

  return [];
}
```

- [ ] **Step 5: Remove the `ToolCalls` import from `LlamaCpp_ToolParser.ts`**

After the changes, check if `ToolCalls` is still used directly. `extractToolCallsFromText` returns `ToolCalls` so it's still needed in the return type. Keep it.

Actually, review the imports — after removing `forcedToolSelection`, `resolveParsedToolName` locally, we no longer need `ToolCallingTaskInput` imported locally if it's only used by the shared functions. But `extractToolCallsFromText` still takes `input: ToolCallingTaskInput` as a parameter, so keep the import.

Final import block for `LlamaCpp_ToolParser.ts`:

```typescript
import type { ToolCallingTaskInput, ToolCalls } from "@workglow/ai";
import {
  adaptParserResult,
  parseHermes,
  parseLlama,
  parseLiquid,
  parseQwen35Xml,
} from "../../common/ToolCallParsers";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
```

Note: `resolveParsedToolName` is NOT imported here — it's used internally by the shared `adaptParserResult`.

- [ ] **Step 6: Verify build**

Run: `bun run build:packages`
Expected: Clean build, no errors

- [ ] **Step 7: Run tests**

Run: `bun scripts/test.ts ai-provider vitest`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/ai-provider/src/provider-llamacpp/common/LlamaCpp_ToolParser.ts packages/ai-provider/src/provider-llamacpp/common/LlamaCpp_ToolCalling.ts
git commit -m "refactor(ai-provider): use shared utilities in LlamaCpp provider

Import adaptParserResult, extractMessageText, toolChoiceForcesToolCall,
resolveParsedToolName from ToolCallParsers.ts. Remove local duplicates."
```

---

### Task 9: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Full build**

Run: `bun run build:packages`
Expected: Clean build, no errors

- [ ] **Step 2: Run all ai-provider tests**

Run: `bun scripts/test.ts ai-provider vitest`
Expected: All tests pass

- [ ] **Step 3: Verify no remaining FunctionGemma references in source**

Run: `grep -ri "functiongemma\|FunctionGemma" packages/ai-provider/src/`
Expected: No matches

- [ ] **Step 4: Verify no remaining FunctionGemma references in tests**

Run: `grep -ri "functiongemma\|FunctionGemma" packages/test/src/`
Expected: No matches

- [ ] **Step 5: Verify `HFT_ToolParser` is gone**

Run: `find packages/ -name "HFT_ToolParser*"`
Expected: No matches
