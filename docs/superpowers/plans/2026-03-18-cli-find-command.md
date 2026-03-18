# CLI `find` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `workglow mcp find` and `workglow model find` commands that live-search external registries, let users select a result, then pre-populate the existing `add` form for review and saving.

**Architecture:** A shared `SearchSelectApp` Ink component handles the live-search TUI (debounced typeahead, infinite scroll, keyboard navigation). Each `find` command provides its own fetch function and result-to-schema mapping. After selection, the existing `promptMissingInput` + `validateInput` + storage path is reused.

**Tech Stack:** React + Ink + @inkjs/ui (TextInput, Spinner), commander, MCP Registry API, HuggingFace API.

**Spec:** `docs/superpowers/specs/2026-03-18-cli-find-command-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `examples/cli/src/ui/SearchSelectApp.tsx` | Create | Reusable combobox-style live-search + select Ink component |
| `examples/cli/src/ui/render.ts` | Modify | Add `renderSearchSelect` helper |
| `examples/cli/src/commands/mcp.ts` | Modify | Add `find` subcommand with MCP registry fetch + mapping |
| `examples/cli/src/commands/model.ts` | Modify | Add `find` subcommand with HuggingFace fetch + mapping |

---

### Task 1: Create SearchSelectApp Component

**Files:**
- Create: `examples/cli/src/ui/SearchSelectApp.tsx`

This is the core reusable component. It handles: TextInput for search queries, debounced fetching, result list rendering with highlight, Up/Down navigation, infinite scroll (fetch next page when highlight reaches bottom), Enter to select, Escape to cancel.

- [ ] **Step 1: Create SearchSelectApp.tsx with types and component skeleton**

Create `examples/cli/src/ui/SearchSelectApp.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput, Spinner } from "@inkjs/ui";

export interface SearchSelectItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface SearchPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | undefined;
}

export interface SearchSelectAppProps<T extends SearchSelectItem> {
  readonly initialQuery?: string;
  readonly placeholder?: string;
  readonly onSearch: (query: string, cursor: string | undefined) => Promise<SearchPage<T>>;
  readonly onSelect: (item: T) => void;
  readonly onCancel: () => void;
  readonly renderItem?: (item: T, isFocused: boolean) => React.ReactElement;
  readonly debounceMs?: number;
  readonly pageSize?: number;
}

const VISIBLE_ITEMS = 10;

export function SearchSelectApp<T extends SearchSelectItem>({
  initialQuery,
  placeholder,
  onSearch,
  onSelect,
  onCancel,
  renderItem,
  debounceMs = 300,
}: SearchSelectAppProps<T>): React.ReactElement {
  const [items, setItems] = useState<T[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [hasSearched, setHasSearched] = useState(false);

  const queryRef = useRef(initialQuery ?? "");
  const nextCursorRef = useRef<string | undefined>(undefined);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fetchIdRef = useRef(0); // prevent stale fetch responses
  const isLoadingMoreRef = useRef(false); // ref to avoid stale closures in useInput

  const doSearch = useCallback(
    async (query: string, cursor: string | undefined) => {
      if (!query) {
        setItems([]);
        setHasSearched(false);
        nextCursorRef.current = undefined;
        return;
      }

      const isFirstPage = cursor === undefined;
      if (isFirstPage) {
        setIsLoading(true);
      } else {
        isLoadingMoreRef.current = true;
      }

      const fetchId = ++fetchIdRef.current;

      try {
        const page = await onSearch(query, cursor);

        // Discard if a newer search has started
        if (fetchId !== fetchIdRef.current) return;

        if (isFirstPage) {
          setItems([...page.items] as T[]);
          setHighlightIndex(0);
        } else {
          setItems((prev) => [...prev, ...(page.items as T[])]);
        }

        nextCursorRef.current = page.nextCursor;
        setHasSearched(true);
        setError(undefined);
      } catch (e: unknown) {
        if (fetchId !== fetchIdRef.current) return;
        setError((e as Error).message ?? "Search failed");
      } finally {
        if (fetchId === fetchIdRef.current) {
          setIsLoading(false);
          isLoadingMoreRef.current = false;
        }
      }
    },
    [onSearch]
  );

  // Trigger initial search if initialQuery is provided
  useEffect(() => {
    if (initialQuery) {
      doSearch(initialQuery, undefined);
    }
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQueryChange = useCallback(
    (value: string) => {
      queryRef.current = value;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        nextCursorRef.current = undefined;
        doSearch(value, undefined);
      }, debounceMs);
    },
    [debounceMs, doSearch]
  );

  // Enter: select highlighted item or trigger explicit search
  // Delegated from TextInput onSubmit to avoid dual-fire with useInput
  const handleSubmit = useCallback(() => {
    if (items.length > 0 && highlightIndex < items.length) {
      onSelect(items[highlightIndex]);
    } else if (queryRef.current) {
      // No results yet — treat Enter as explicit search trigger
      doSearch(queryRef.current, undefined);
    }
  }, [items, highlightIndex, onSelect, doSearch]);

  // Up/Down navigation + Escape cancel + infinite scroll trigger
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.downArrow && items.length > 0) {
      setHighlightIndex((prev) => {
        const next = Math.min(prev + 1, items.length - 1);

        // Infinite scroll: fetch next page when reaching the bottom
        if (next === items.length - 1 && nextCursorRef.current && !isLoadingMoreRef.current) {
          doSearch(queryRef.current, nextCursorRef.current);
        }

        return next;
      });
      return;
    }

    if (key.upArrow && items.length > 0) {
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
  });

  const defaultRenderItem = (item: T, isFocused: boolean): React.ReactElement => (
    <Box key={item.id} flexDirection="column">
      <Box>
        <Text color={isFocused ? "cyan" : "gray"}>
          {isFocused ? "\u25B8 " : "  "}
        </Text>
        <Text bold={isFocused}>{item.label}</Text>
      </Box>
      {item.description && (
        <Box marginLeft={4}>
          <Text dimColor>{item.description}</Text>
        </Box>
      )}
    </Box>
  );

  const itemRenderer = renderItem ?? defaultRenderItem;

  // Viewport windowing: only render VISIBLE_ITEMS around the highlight
  const windowStart = Math.max(0, Math.min(highlightIndex - Math.floor(VISIBLE_ITEMS / 2), items.length - VISIBLE_ITEMS));
  const windowEnd = Math.min(items.length, windowStart + VISIBLE_ITEMS);
  const visibleItems = items.slice(windowStart, windowEnd);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">
          {placeholder ?? "Search"}: </Text>
        <TextInput
          defaultValue={initialQuery}
          onChange={handleQueryChange}
          onSubmit={handleSubmit}
        />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {isLoading && items.length === 0 && (
          <Spinner label="Searching..." />
        )}

        {error && (
          <Text color="red">  Search failed: {error}</Text>
        )}

        {!isLoading && hasSearched && items.length === 0 && !error && (
          <Text dimColor>  No results found.</Text>
        )}

        {!hasSearched && !isLoading && (
          <Text dimColor>  Type to search...</Text>
        )}

        {windowStart > 0 && (
          <Text dimColor>  {"\u2191"} {windowStart} more above</Text>
        )}

        {visibleItems.map((item, i) =>
          itemRenderer(item, windowStart + i === highlightIndex)
        )}

        {windowEnd < items.length && (
          <Text dimColor>  {"\u2193"} {items.length - windowEnd} more below</Text>
        )}

        {isLoadingMoreRef.current && (
          <Spinner label="Loading more..." />
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {"\u2191\u2193"} navigate  Enter select  Esc cancel
        </Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /workspaces/workglow/libs/examples/cli && npx tsc --noEmit`
Expected: clean (no errors)

- [ ] **Step 3: Commit**

```bash
git add examples/cli/src/ui/SearchSelectApp.tsx
git commit -m "feat(cli): add SearchSelectApp component for live-search TUI"
```

---

### Task 2: Add renderSearchSelect Helper to render.ts

**Files:**
- Modify: `examples/cli/src/ui/render.ts`

Add a `renderSearchSelect` function that wraps `SearchSelectApp` into a Promise (same pattern as `renderSchemaPrompt`).

- [ ] **Step 1: Add the renderSearchSelect function**

In `examples/cli/src/ui/render.ts`, add the type imports at the top of the file (after the existing imports) and the function at the end:

At the top, alongside existing imports:
```ts
import type { SearchSelectItem, SearchSelectAppProps } from "./SearchSelectApp";
export type { SearchSelectItem, SearchPage } from "./SearchSelectApp";
```

At the end of the file:
```ts
export async function renderSearchSelect<T extends SearchSelectItem>(
  props: Omit<SearchSelectAppProps<T>, "onSelect" | "onCancel">
): Promise<T | undefined> {
  const React = await import("react");
  const { render } = await import("ink");
  const { SearchSelectApp } = await import("./SearchSelectApp");

  return new Promise<T | undefined>((resolve) => {
    const onSelect = (item: T) => {
      instance.unmount();
      resolve(item);
    };

    const onCancel = () => {
      instance.unmount();
      resolve(undefined);
    };

    const instance = render(
      React.createElement(SearchSelectApp, {
        ...props,
        onSelect,
        onCancel,
      } as SearchSelectAppProps<T>)
    );
  });
}
```

Note: Use dynamic `import()` for React, ink, and SearchSelectApp to match the lazy-loading pattern of the existing `renderSchemaPrompt` / `renderTaskRun` functions. The static `import type` at the top is type-only and has no runtime cost.

- [ ] **Step 2: Verify it compiles**

Run: `cd /workspaces/workglow/libs/examples/cli && npx tsc --noEmit`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add examples/cli/src/ui/render.ts
git commit -m "feat(cli): add renderSearchSelect helper in render.ts"
```

---

### Task 3: Add `mcp find` Command

**Files:**
- Modify: `examples/cli/src/commands/mcp.ts`

Add the `find` subcommand that: searches the MCP registry API, displays results in SearchSelectApp, maps the selection to McpServerRecordSchema, then runs the same add form + validation + save flow as `mcp add`.

- [ ] **Step 1: Add MCP registry types and fetch function**

At the top of `examples/cli/src/commands/mcp.ts`, after the existing imports, add:

```ts
import type { SearchPage, SearchSelectItem } from "../ui/render";
```

Then add these types and functions before `registerMcpCommand`:

```ts
interface McpRegistryServer {
  name: string;
  title?: string;
  description: string;
  version: string;
  packages?: Array<{
    registryType: string;
    identifier: string;
    transport: { type: string };
    environmentVariables?: Array<{
      name: string;
      description?: string;
      isRequired?: boolean;
    }>;
    runtimeArguments?: Array<{
      type: string;
      name: string;
      value?: string;
      isRequired?: boolean;
      description?: string;
    }>;
    packageArguments?: Array<{
      type: string;
      name: string;
      value?: string;
      isRequired?: boolean;
      description?: string;
    }>;
  }>;
  remotes?: Array<{
    type: string;
    url: string;
  }>;
}

interface McpSearchResult extends SearchSelectItem {
  readonly server: McpRegistryServer;
}

const MCP_REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0.1";

async function searchMcpRegistry(
  query: string,
  cursor: string | undefined
): Promise<SearchPage<McpSearchResult>> {
  const params = new URLSearchParams({
    search: query,
    limit: "20",
    version: "latest",
  });
  if (cursor) params.set("cursor", cursor);

  const res = await fetch(`${MCP_REGISTRY_BASE}/servers?${params}`);
  if (!res.ok) throw new Error(`Registry returned ${res.status}`);

  const data = await res.json();
  const items: McpSearchResult[] = (data.servers ?? []).map(
    (entry: { server: McpRegistryServer }) => {
      const s = entry.server;
      const pkg = s.packages?.[0];
      const remote = s.remotes?.[0];
      const badges = [
        pkg?.registryType,
        pkg?.transport?.type ?? remote?.type,
      ]
        .filter(Boolean)
        .join(" | ");

      return {
        id: `${s.name}:${s.version}`,
        label: `${s.title ?? s.name}${badges ? `  ${badges}` : ""}`,
        description: s.description,
        server: s,
      };
    }
  );

  return {
    items,
    nextCursor: data.metadata?.nextCursor ?? undefined,
  };
}

function mapMcpRegistryResult(server: McpRegistryServer): Record<string, unknown> {
  const name = server.name.split("/").pop() ?? server.name;

  // Prefer remotes (direct URL connection)
  if (server.remotes && server.remotes.length > 0) {
    const remote = server.remotes[0];
    return {
      name,
      transport: remote.type,
      server_url: remote.url,
    };
  }

  // Fall back to first package (stdio)
  const pkg = server.packages?.[0];
  if (!pkg) return { name };

  let command: string;
  let args: string[];

  switch (pkg.registryType) {
    case "npm":
      command = "npx";
      args = ["-y", pkg.identifier];
      break;
    case "pypi":
      command = "uvx";
      args = [pkg.identifier];
      break;
    case "oci":
      command = "docker";
      args = ["run", "-i", "--rm", pkg.identifier];
      break;
    default:
      command = pkg.identifier;
      args = [];
  }

  if (pkg.runtimeArguments) {
    for (const arg of pkg.runtimeArguments) {
      if (arg.name) args.push(arg.name);
      if (arg.value) args.push(arg.value);
    }
  }

  const result: Record<string, unknown> = {
    name,
    transport: "stdio",
    command,
    args,
  };

  if (pkg.environmentVariables && pkg.environmentVariables.length > 0) {
    const env: Record<string, string> = {};
    for (const envVar of pkg.environmentVariables) {
      env[envVar.name] = "";
    }
    result.env = env;
  }

  return result;
}
```

- [ ] **Step 2: Add the `find` subcommand inside `registerMcpCommand`**

Inside the `registerMcpCommand` function, after the `add` command block and before the closing brace, add:

```ts
  mcp
    .command("find")
    .argument("[query]", "Initial search term")
    .option("--dry-run", "Validate and print result without saving")
    .description("Search the MCP registry and add a server")
    .action(async (query: string | undefined, opts: { dryRun?: boolean }) => {
      if (!process.stdin.isTTY) {
        console.error("Error: mcp find requires an interactive terminal.");
        process.exit(1);
      }

      const { renderSearchSelect } = await import("../ui/render");
      const selected = await renderSearchSelect<McpSearchResult>({
        initialQuery: query,
        placeholder: "Search MCP servers",
        onSearch: searchMcpRegistry,
      });

      if (!selected) {
        return;
      }

      let input = mapMcpRegistryResult(selected.server);

      const { promptMissingInput } = await import("../input/prompt");
      input = await promptMissingInput(input, mcpSchema);

      const validation = validateInput(input, mcpSchema);
      if (!validation.valid) {
        console.error("Input validation failed:");
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }

      const transport = input.transport as string;
      if (transport === "stdio" && !input.command) {
        console.error('Transport "stdio" requires -command.');
        process.exit(1);
      }
      if ((transport === "sse" || transport === "streamable-http") && !input.server_url) {
        console.error(`Transport "${transport}" requires -server_url.`);
        process.exit(1);
      }

      if (opts.dryRun) {
        console.log(JSON.stringify(input, null, 2));
        process.exit(0);
      }

      const config = await loadConfig();
      const storage = createMcpStorage(config);
      await storage.setupDirectory();

      await storage.put(input as Record<string, unknown>);
      console.log(`MCP server "${input.name}" added.`);
    });
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /workspaces/workglow/libs/examples/cli && npx tsc --noEmit`
Expected: clean

- [ ] **Step 4: Manual smoke test**

Run: `cd /workspaces/workglow/libs && bun run examples/cli/src/workglow.ts mcp find filesystem`

Expected: live search TUI appears, shows MCP servers matching "filesystem" from the registry. Arrow keys navigate, Enter selects, Escape cancels. On select, the add form appears pre-populated.

- [ ] **Step 5: Commit**

```bash
git add examples/cli/src/commands/mcp.ts
git commit -m "feat(cli): add mcp find command with MCP registry search"
```

---

### Task 4: Add `model find` Command

**Files:**
- Modify: `examples/cli/src/commands/model.ts`

Add the `find` subcommand that: searches the HuggingFace models API, displays results in SearchSelectApp, maps the selection to ModelRecord, then runs the same add form + validation + save flow as `model add`.

- [ ] **Step 1: Add HuggingFace types and fetch function**

At the top of `examples/cli/src/commands/model.ts`, after the existing imports, add:

```ts
import type { SearchPage, SearchSelectItem } from "../ui/render";
```

Then add these types and functions before `registerModelCommand`:

```ts
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
```

- [ ] **Step 2: Add the `find` subcommand inside `registerModelCommand`**

Inside the `registerModelCommand` function, after the `add` command block and before the closing brace, add:

```ts
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

      // Select provider-specific schema
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
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /workspaces/workglow/libs/examples/cli && npx tsc --noEmit`
Expected: clean

- [ ] **Step 4: Manual smoke test**

Run: `cd /workspaces/workglow/libs && bun run examples/cli/src/workglow.ts model find llama`

Expected: live search TUI appears, shows HuggingFace models matching "llama" sorted by downloads. Arrow keys navigate, scrolling down loads more results. Enter selects, Escape cancels. On select, the model add form appears pre-populated with model_id, provider, title, description, tasks, provider_config.model_name.

- [ ] **Step 5: Commit**

```bash
git add examples/cli/src/commands/model.ts
git commit -m "feat(cli): add model find command with HuggingFace search"
```
