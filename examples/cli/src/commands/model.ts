/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelRecordSchema, type ModelRecord } from "@workglow/ai";
import {
  AnthropicModelRecordSchema,
  OpenAiModelRecordSchema,
  GeminiModelRecordSchema,
  OllamaModelRecordSchema,
  HfInferenceModelRecordSchema,
  HfTransformersOnnxModelRecordSchema,
  LlamaCppModelRecordSchema,
  TFMPModelRecordSchema,
  WebBrowserModelRecordSchema,
} from "@workglow/ai-provider";
import type { DataPortSchemaObject } from "@workglow/util";
import type { Command } from "commander";
import { loadConfig } from "../config";
import {
  parseDynamicFlags,
  generateSchemaHelpText,
  resolveInput,
  validateInput,
  applySchemaDefaults,
} from "../input";
import { createModelRepository } from "../storage";
import { formatTable } from "../util";
import type { SearchPage, SearchSelectItem } from "../ui/render";

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

async function searchHuggingFace(
  query: string,
  cursor: string | undefined
): Promise<SearchPage<HfSearchResult>> {
  const skip = cursor ? parseInt(cursor, 10) : 0;
  const params = new URLSearchParams({
    search: query,
    limit: String(HF_PAGE_SIZE),
    sort: "downloads",
    direction: "-1",
    skip: String(skip),
  });

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
}

function mapHfModelResult(entry: HfModelEntry): Record<string, unknown> {
  let provider = "HF_INFERENCE";
  if (entry.library_name === "onnx" || entry.tags?.includes("onnx")) {
    provider = "HF_TRANSFORMERS_ONNX";
  }

  const model_id = entry.id.replace(/\//g, "--");

  return {
    model_id,
    provider,
    title: entry.id.split("/").pop() ?? entry.id,
    description: [entry.pipeline_tag, `${formatDownloads(entry.downloads)} downloads`]
      .filter(Boolean)
      .join(" \u2014 "),
    tasks: entry.pipeline_tag ? [entry.pipeline_tag] : [],
    provider_config: { model_name: entry.id },
    metadata: {},
  };
}

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
    .command("remove")
    .argument("<id>", "model ID to remove")
    .description("Remove a model by ID")
    .action(async (id: string) => {
      const config = await loadConfig();
      const repo = createModelRepository(config);
      await repo.setupDatabase();

      try {
        await repo.removeModel(id);
        console.log(`Model "${id}" removed.`);
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
    .argument("[query]", "Initial search term")
    .option("--dry-run", "Validate and print result without saving")
    .description("Search HuggingFace and add a model")
    .action(async (query: string | undefined, opts: { dryRun?: boolean }) => {
      if (!process.stdin.isTTY) {
        console.error("Error: model find requires an interactive terminal.");
        process.exit(1);
      }

      const { renderSearchSelect } = await import("../ui/render");
      const selected = await renderSearchSelect<HfSearchResult>({
        initialQuery: query,
        placeholder: "Search HuggingFace models",
        onSearch: searchHuggingFace,
      });

      if (!selected) {
        return;
      }

      let input = mapHfModelResult(selected.entry);

      const provider = input.provider as string;
      const schema: DataPortSchemaObject =
        provider && PROVIDER_SCHEMAS[provider]
          ? PROVIDER_SCHEMAS[provider]
          : (ModelRecordSchema as unknown as DataPortSchemaObject);

      let withDefaults = applySchemaDefaults(input, schema);

      const { promptMissingInput } = await import("../input/prompt");
      withDefaults = await promptMissingInput(withDefaults, schema);

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
