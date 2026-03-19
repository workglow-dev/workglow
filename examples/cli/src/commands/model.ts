/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelRecordSchema, type ModelRecord } from "@workglow/ai";
import {
  AnthropicModelRecordSchema,
  GeminiModelRecordSchema,
  HfInferenceModelRecordSchema,
  HfTransformersOnnxModelRecordSchema,
  LlamaCppModelRecordSchema,
  OllamaModelRecordSchema,
  OpenAiModelRecordSchema,
  TFMPModelRecordSchema,
  WebBrowserModelRecordSchema,
} from "@workglow/ai-provider";
import type { DataPortSchemaObject } from "@workglow/util";
import type { Command } from "commander";
import { loadConfig } from "../config";
import {
  applySchemaDefaults,
  generateSchemaHelpText,
  parseDynamicFlags,
  resolveInput,
  validateInput,
} from "../input";
import { createModelRepository } from "../storage";
import { pipelineToTaskTypes } from "../taskToPipeline";
import type { SearchPage, SearchSelectItem } from "../ui/render";
import { formatTable } from "../util";

const PROVIDER_SCHEMAS: Record<string, DataPortSchemaObject> = {
  ANTHROPIC: AnthropicModelRecordSchema as unknown as DataPortSchemaObject,
  OPENAI: OpenAiModelRecordSchema as unknown as DataPortSchemaObject,
  GOOGLE_GEMINI: GeminiModelRecordSchema as unknown as DataPortSchemaObject,
  OLLAMA: OllamaModelRecordSchema as unknown as DataPortSchemaObject,
  HF_INFERENCE: HfInferenceModelRecordSchema as unknown as DataPortSchemaObject,
  HF_TRANSFORMERS_ONNX: HfTransformersOnnxModelRecordSchema as unknown as DataPortSchemaObject,
  LOCAL_LLAMACPP: LlamaCppModelRecordSchema as unknown as DataPortSchemaObject,
  TENSORFLOW_MEDIAPIPE: TFMPModelRecordSchema as unknown as DataPortSchemaObject,
  WEB_BROWSER: WebBrowserModelRecordSchema as unknown as DataPortSchemaObject,
};

const AVAILABLE_PROVIDERS = Object.keys(PROVIDER_SCHEMAS);

function detectProviderFromArgv(argv: string[]): string | undefined {
  for (const arg of argv) {
    const match = arg.match(/^-provider[=\s](.+)/);
    if (match) return match[1];
    if (arg === "-provider") {
      const idx = argv.indexOf(arg);
      if (idx + 1 < argv.length) return argv[idx + 1];
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// HuggingFace search (used by HF_INFERENCE, HF_TRANSFORMERS_ONNX, LOCAL_LLAMACPP)
// ---------------------------------------------------------------------------

interface HfModelEntry {
  id: string;
  modelId: string;
  pipeline_tag?: string;
  library_name?: string;
  likes: number;
  downloads: number;
  tags?: string[];
}

interface HfSearchResult extends SearchSelectItem {
  readonly entry: HfModelEntry;
}

const HF_API_BASE = "https://huggingface.co/api";
const HF_PAGE_SIZE = 20;

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function createHfSearchFn(
  extraParams?: Record<string, string>
): (query: string, cursor: string | undefined) => Promise<SearchPage<HfSearchResult>> {
  return async (query, cursor) => {
    const skip = cursor ? parseInt(cursor, 10) : 0;
    const params = new URLSearchParams({
      search: query,
      limit: String(HF_PAGE_SIZE),
      sort: "downloads",
      direction: "-1",
      skip: String(skip),
      "expand[]": "pipeline_tag",
      ...extraParams,
    });
    console.log(`${HF_API_BASE}/models?${params}`);
    const res = await fetch(`${HF_API_BASE}/models?${params}`);
    if (!res.ok) throw new Error(`HuggingFace API returned ${res.status}`);

    const data: HfModelEntry[] = await res.json();

    const items: HfSearchResult[] = data.map((entry) => {
      const badges = [entry.pipeline_tag, entry.library_name].filter(Boolean).join(" | ");
      return {
        id: entry.id,
        label: `${entry.id}${badges ? `  ${badges}` : ""}`,
        description: `${formatDownloads(entry.downloads)} downloads`,
        entry,
      };
    });

    return {
      items,
      nextCursor: data.length >= HF_PAGE_SIZE ? String(skip + HF_PAGE_SIZE) : undefined,
    };
  };
}

function mapHfProviderConfig(entry: HfModelEntry, provider: string): Record<string, unknown> {
  switch (provider) {
    case "HF_TRANSFORMERS_ONNX":
      return {
        model_path: entry.id,
        ...(entry.pipeline_tag ? { pipeline: entry.pipeline_tag } : {}),
      };
    case "LOCAL_LLAMACPP":
      return { model_path: entry.id };
    default:
      return { model_name: entry.id };
  }
}

function mapHfModelResult(entry: HfModelEntry, provider: string): Record<string, unknown> {
  return {
    model_id: entry.id,
    provider,
    title: entry.id.split("/").pop() ?? entry.id,
    description: [entry.pipeline_tag, `${formatDownloads(entry.downloads)} downloads`]
      .filter(Boolean)
      .join(" \u2014 "),
    tasks: entry.pipeline_tag ? pipelineToTaskTypes(entry.pipeline_tag) : [],
    provider_config: mapHfProviderConfig(entry, provider),
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// SDK-based model listing (Anthropic, OpenAI, Ollama)
// ---------------------------------------------------------------------------

async function listAnthropicModels(): Promise<Array<{ label: string; value: string }>> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const models: Array<{ label: string; value: string }> = [];
  for await (const m of client.beta.models.list()) {
    models.push({ label: `${m.id}  ${m.display_name}`, value: m.id });
  }
  return models;
}

async function listOpenAiModels(): Promise<Array<{ label: string; value: string }>> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  const models: Array<{ label: string; value: string }> = [];
  for await (const m of client.models.list()) {
    models.push({ label: `${m.id}  ${m.owned_by}`, value: m.id });
  }
  // Sort: gpt/o1 models first, then by name
  models.sort((a, b) => {
    const aGpt = a.value.startsWith("gpt") || a.value.startsWith("o1") ? 0 : 1;
    const bGpt = b.value.startsWith("gpt") || b.value.startsWith("o1") ? 0 : 1;
    if (aGpt !== bGpt) return aGpt - bGpt;
    return a.value.localeCompare(b.value);
  });
  return models;
}

async function listOllamaModels(): Promise<Array<{ label: string; value: string }>> {
  const { Ollama } = await import("ollama");
  const client = new Ollama();
  const response = await client.list();
  return response.models.map((m) => ({
    label: `${m.name}  ${m.details.parameter_size}  ${m.details.quantization_level}`,
    value: m.name,
  }));
}

// ---------------------------------------------------------------------------
// Static/fallback model lists
// ---------------------------------------------------------------------------

const ANTHROPIC_FALLBACK: Array<{ label: string; value: string }> = [
  { label: "claude-opus-4-20250514", value: "claude-opus-4-20250514" },
  { label: "claude-sonnet-4-20250514", value: "claude-sonnet-4-20250514" },
  { label: "claude-haiku-4-5-20251001", value: "claude-haiku-4-5-20251001" },
  { label: "claude-3-5-sonnet-20241022", value: "claude-3-5-sonnet-20241022" },
  { label: "claude-3-5-haiku-20241022", value: "claude-3-5-haiku-20241022" },
];

const OPENAI_FALLBACK: Array<{ label: string; value: string }> = [
  { label: "gpt-5.4", value: "gpt-5.4" },
  { label: "gpt-5", value: "gpt-5" },
  { label: "gpt-5-mini", value: "gpt-5-mini" },
  { label: "gpt-4o-mini", value: "gpt-4o-mini" },
  { label: "gpt-4-turbo", value: "gpt-4-turbo" },
  { label: "o3", value: "o3" },
  { label: "o3-mini", value: "o3-mini" },
  { label: "o1", value: "o1" },
  { label: "o1-mini", value: "o1-mini" },
];

const GEMINI_MODELS: Array<{ label: string; value: string }> = [
  { label: "gemini-3.1-flash", value: "gemini-3.1-flash" },
  { label: "gemini-3.1-pro", value: "gemini-3.1-pro" },
  { label: "gemini-2.5-flash", value: "gemini-2.5-flash" },
  { label: "gemini-2.5-pro", value: "gemini-2.5-pro" },
  { label: "gemini-2.0-flash", value: "gemini-2.0-flash" },
  { label: "gemini-1.5-pro", value: "gemini-1.5-pro" },
  { label: "gemini-1.5-flash", value: "gemini-1.5-flash" },
];

const TFMP_MODELS: Array<{ label: string; value: string }> = [
  { label: "text-embedder  Universal Sentence Encoder", value: "text-embedder" },
];

const WEB_BROWSER_MODELS: Array<{ label: string; value: string }> = [
  { label: "webgpu  WebGPU inference", value: "webgpu" },
  { label: "wasm  WASM inference", value: "wasm" },
];

// ---------------------------------------------------------------------------
// Provider search dispatch
// ---------------------------------------------------------------------------

type FindResult =
  | { type: "hf"; entry: HfModelEntry; provider: string }
  | { type: "id"; modelId: string; provider: string };

const HF_PROVIDERS: Record<string, { placeholder: string; extra?: Record<string, string> }> = {
  HF_INFERENCE: { placeholder: "Search HuggingFace models" },
  HF_TRANSFORMERS_ONNX: { placeholder: "Search ONNX models", extra: { filter: "onnx" } },
  LOCAL_LLAMACPP: { placeholder: "Search GGUF models", extra: { filter: "gguf" } },
};

/** True when the runtime exposes WebGPU (e.g. browser with WebGPU, Node with --experimental-webgpu). */
function isWebGPUAvailable(): boolean {
  try {
    const nav = typeof navigator !== "undefined" ? (navigator as { gpu?: unknown }) : undefined;
    return !!nav?.gpu;
  } catch {
    return false;
  }
}

/**
 * When WebGPU is not available, avoid sending device "webgpu" to transformers.js.
 * Normalize HF_TRANSFORMERS_ONNX provider_config.device so we persist "wasm" instead of "webgpu".
 */
function normalizeHfTransformersOnnxDevice(record: Record<string, unknown>): void {
  if (record.provider !== "HF_TRANSFORMERS_ONNX") return;
  const pc = record.provider_config as Record<string, unknown> | undefined;
  if (!pc || typeof pc !== "object") return;
  const device = pc.device as string | undefined;
  if ((device === "webgpu" || device === undefined) && !isWebGPUAvailable()) {
    pc.device = "wasm";
  }
}

async function findModelForProvider(provider: string): Promise<FindResult | undefined> {
  const hfConfig = HF_PROVIDERS[provider];
  if (hfConfig) {
    const { renderSearchSelect } = await import("../ui/render");
    const searchFn = createHfSearchFn(hfConfig.extra);
    const selected = await renderSearchSelect<HfSearchResult>({
      placeholder: hfConfig.placeholder,
      onSearch: searchFn,
    });
    if (!selected) return undefined;
    return { type: "hf", entry: selected.entry, provider };
  }

  // SDK or static list providers
  let options: Array<{ label: string; value: string }> | undefined;

  switch (provider) {
    case "ANTHROPIC":
      try {
        options = await listAnthropicModels();
      } catch {
        options = ANTHROPIC_FALLBACK;
      }
      break;
    case "OPENAI":
      try {
        options = await listOpenAiModels();
      } catch {
        options = OPENAI_FALLBACK;
      }
      break;
    case "OLLAMA":
      try {
        options = await listOllamaModels();
      } catch (e: unknown) {
        console.error(`Could not connect to Ollama: ${(e as Error).message}`);
        console.error("Make sure Ollama is running (ollama serve).");
        return undefined;
      }
      break;
    case "GOOGLE_GEMINI":
      options = GEMINI_MODELS;
      break;
    case "TENSORFLOW_MEDIAPIPE":
      options = TFMP_MODELS;
      break;
    case "WEB_BROWSER":
      options = WEB_BROWSER_MODELS;
      break;
  }

  if (!options || options.length === 0) {
    console.log("No models available for this provider.");
    return undefined;
  }

  const { renderSelectPrompt } = await import("../ui/render");
  const selected = await renderSelectPrompt(options, `Select ${provider} model:`);
  if (!selected) return undefined;
  return { type: "id", modelId: selected, provider };
}

function mapIdProviderConfig(modelId: string, provider: string): Record<string, unknown> {
  switch (provider) {
    case "TENSORFLOW_MEDIAPIPE":
      return { model_path: modelId };
    case "WEB_BROWSER":
      return {};
    default:
      return { model_name: modelId };
  }
}

function mapFindResult(result: FindResult): Record<string, unknown> {
  if (result.type === "hf") {
    return mapHfModelResult(result.entry, result.provider);
  }

  return {
    model_id: result.modelId,
    provider: result.provider,
    title: result.modelId,
    description: "",
    tasks: [],
    provider_config: mapIdProviderConfig(result.modelId, result.provider),
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerModelCommand(program: Command): void {
  const model = program.command("model").description("Manage models");

  model
    .command("list")
    .description("List all registered models")
    .action(async () => {
      const config = await loadConfig();
      const repo = createModelRepository(config);
      await repo.setupDatabase();

      const models = await repo.enumerateAllModels();
      if (!models || models.length === 0) {
        console.log("No models found.");
        return;
      }

      const rows = models.map((m) => ({
        model_id: m.model_id,
        provider: m.provider,
        title: m.title ?? "",
        description: m.description ?? "",
      }));
      console.log(formatTable(rows, ["model_id", "provider", "title", "description"]));
    });

  model
    .command("detail")
    .argument("[id]", "model ID to show")
    .description("Show full details of a model")
    .action(async (id: string | undefined) => {
      const config = await loadConfig();
      const repo = createModelRepository(config);
      await repo.setupDatabase();

      let targetId = id;
      if (!targetId) {
        if (!process.stdin.isTTY) {
          console.error("Error: specify an id or run interactively.");
          process.exit(1);
        }
        const models = await repo.enumerateAllModels();
        if (!models || models.length === 0) {
          console.log("No models found.");
          return;
        }
        const { renderSelectPrompt } = await import("../ui/render");
        const options = models.map((m) => ({
          label: `${m.model_id}  ${m.provider}  ${m.title ?? ""}`,
          value: m.model_id,
        }));
        const selected = await renderSelectPrompt(options, "Select model:");
        if (!selected) return;
        targetId = selected;
      }

      const model = await repo.findByName(targetId);
      if (!model) {
        console.error(`Model "${targetId}" not found.`);
        process.exit(1);
      }

      console.log(JSON.stringify(model, null, 2));
    });

  model
    .command("remove")
    .argument("[id]", "model ID to remove")
    .description("Remove a model by ID")
    .action(async (id: string | undefined) => {
      const config = await loadConfig();
      const repo = createModelRepository(config);
      await repo.setupDatabase();

      let targetId = id;
      if (!targetId) {
        if (!process.stdin.isTTY) {
          console.error("Error: specify an id or run interactively.");
          process.exit(1);
        }
        const models = await repo.enumerateAllModels();
        if (!models || models.length === 0) {
          console.log("No models to remove.");
          return;
        }
        const { renderSelectPrompt } = await import("../ui/render");
        const options = models.map((m) => ({
          label: `${m.model_id}  ${m.provider}  ${m.title ?? ""}`,
          value: m.model_id,
        }));
        const selected = await renderSelectPrompt(options, "Select model to remove:");
        if (!selected) return;
        targetId = selected;
      }

      try {
        await repo.removeModel(targetId);
        console.log(`Model "${targetId}" removed.`);
      } catch (e: unknown) {
        console.error((e as Error).message);
        process.exit(1);
      }
    });

  const add = model
    .command("add")
    .description("Add a new model")
    .allowUnknownOption()
    .allowExcessArguments(true)
    .helpOption(false)
    .option("--input-json <json>", "Input as JSON string")
    .option("--input-json-file <path>", "Input from JSON file")
    .option("--dry-run", "Validate input without saving")
    .option("--help", "Show help (provider-aware if -provider given)")
    .action(async (opts: Record<string, string | boolean | undefined>) => {
      const provider = detectProviderFromArgv(process.argv);
      const schema: DataPortSchemaObject =
        provider && PROVIDER_SCHEMAS[provider]
          ? PROVIDER_SCHEMAS[provider]
          : (ModelRecordSchema as unknown as DataPortSchemaObject);

      if (opts.help) {
        add.outputHelp();
        console.log("\nInput flags (from model schema):");
        console.log(generateSchemaHelpText(schema));
        console.log(`\nAvailable providers: ${AVAILABLE_PROVIDERS.join(", ")}`);
        process.exit(0);
      }

      const dynamicFlags = parseDynamicFlags(process.argv, schema);
      const input = await resolveInput({
        inputJson: opts.inputJson as string | undefined,
        inputJsonFile: opts.inputJsonFile as string | undefined,
        dynamicFlags,
        schema,
      });

      let withDefaults = applySchemaDefaults(input, schema);

      if (process.stdin.isTTY) {
        const { promptMissingInput } = await import("../input/prompt");
        withDefaults = await promptMissingInput(withDefaults, schema);
      }

      normalizeHfTransformersOnnxDevice(withDefaults as Record<string, unknown>);

      const validation = validateInput(withDefaults, schema);
      if (!validation.valid) {
        console.error("Input validation failed:");
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }

      if (opts.dryRun) {
        console.log(JSON.stringify(withDefaults, null, 2));
        process.exit(0);
      }

      const config = await loadConfig();
      const repo = createModelRepository(config);
      await repo.setupDatabase();

      await repo.addModel(withDefaults as unknown as ModelRecord);
      console.log(`Model "${withDefaults.model_id}" added.`);
    });

  model
    .command("find")
    .argument("[query]", "Initial search term (HuggingFace providers only)")
    .option("--dry-run", "Validate and print result without saving")
    .description("Search for a model and add it")
    .action(async (query: string | undefined, opts: { dryRun?: boolean }) => {
      if (!process.stdin.isTTY) {
        console.error("Error: model find requires an interactive terminal.");
        process.exit(1);
      }

      // Step 1: Pick provider
      const { renderSelectPrompt } = await import("../ui/render");
      const providerOptions = AVAILABLE_PROVIDERS.map((p) => ({ label: p, value: p }));
      const selectedProvider = await renderSelectPrompt(providerOptions, "Select provider:");
      if (!selectedProvider) return;

      // Step 2: Find model for that provider
      const result = await findModelForProvider(selectedProvider);
      if (!result) return;

      // Step 3: Map to partial input and run add form
      let input = mapFindResult(result);

      const schema: DataPortSchemaObject =
        PROVIDER_SCHEMAS[selectedProvider] ??
        (ModelRecordSchema as unknown as DataPortSchemaObject);

      let withDefaults = applySchemaDefaults(input, schema);

      // Present the full editable form pre-populated with found data
      const { promptEditableInput } = await import("../input/prompt");
      withDefaults = await promptEditableInput(withDefaults, schema);

      normalizeHfTransformersOnnxDevice(withDefaults as Record<string, unknown>);

      const validation = validateInput(withDefaults, schema);
      if (!validation.valid) {
        console.error("Input validation failed:");
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }

      if (opts.dryRun) {
        console.log(JSON.stringify(withDefaults, null, 2));
        process.exit(0);
      }

      const config = await loadConfig();
      const repo = createModelRepository(config);
      await repo.setupDatabase();

      await repo.addModel(withDefaults as unknown as ModelRecord);
      console.log(`Model "${withDefaults.model_id}" added.`);
    });
}
