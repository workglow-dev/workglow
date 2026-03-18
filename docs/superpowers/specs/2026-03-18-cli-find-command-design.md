# CLI `find` Command for MCP and Model Discovery

**Date:** 2026-03-18
**Status:** Draft
**Scope:** `workglow mcp find` and `workglow model find` commands in `examples/cli`

## Summary

Add a `find` subcommand to both `mcp` and `model` command groups. Each opens a live-search TUI that queries an external registry, lets the user browse and select a result, then pre-populates the existing `add` form with the selected entry's details for review and saving.

## Goals

- Let users discover MCP servers and HuggingFace models without leaving the CLI.
- Reduce friction: search, select, review, save in one flow.
- Reuse the existing `add` form (SchemaPromptApp) for the review/edit step.

## Non-Goals

- Offline caching of registry data.
- Authentication against either registry (both endpoints are public).

## Architecture

### New Files

| File | Purpose |
|---|---|
| `examples/cli/src/ui/SearchSelectApp.tsx` | Reusable combobox-style live-search + select Ink component |
| `examples/cli/src/ui/render.ts` | Add `renderSearchSelect` helper (lazy-imports SearchSelectApp) |

### Modified Files

| File | Change |
|---|---|
| `examples/cli/src/commands/mcp.ts` | Add `find` subcommand |
| `examples/cli/src/commands/model.ts` | Add `find` subcommand |

## SearchSelectApp Component

### Props

```ts
interface SearchSelectItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

interface SearchPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | undefined; // undefined = no more pages
}

interface SearchSelectAppProps<T extends SearchSelectItem> {
  readonly initialQuery?: string;
  readonly placeholder?: string;
  readonly onSearch: (query: string, cursor: string | undefined) => Promise<SearchPage<T>>;
  readonly onSelect: (item: T) => void;
  readonly onCancel: () => void;
  readonly renderItem?: (item: T, isFocused: boolean) => React.ReactElement;
  readonly debounceMs?: number; // default 300
  readonly pageSize?: number;  // default 20
}
```

### Layout

```
Search MCP servers: [filesystem________]

  Loading...

  ▸ io.github.user/filesystem-server          npm | stdio
    Secure filesystem access for AI agents
  ○ io.github.other/fs-tools                  pypi | stdio
    Advanced filesystem operations
  ○ io.github.another/file-manager            npm | stdio
    File management with batch ops

  ↑↓ navigate  Enter select  Esc cancel
```

### Behavior

| Aspect | Detail |
|---|---|
| **Text input** | Always active. `onChange` triggers debounced fetch (resets cursor to `undefined` for a fresh first page). |
| **Debounce** | 300ms default. Timer resets on each keystroke. Stale results stay visible while fetch is in-flight. |
| **Results list** | Rendered below input. One item highlighted at index 0 by default. Visible window shows a slice of all loaded items. |
| **Navigation** | Up/Down arrows move highlight. |
| **Infinite scroll** | When the highlight reaches the last loaded item AND `nextCursor` is non-undefined, automatically fetch the next page and append results. Show a "Loading more..." indicator at the bottom during the fetch. |
| **Selection** | Enter selects highlighted item, calls `onSelect`. |
| **Cancel** | Escape calls `onCancel` (unmounts, returns to shell). |
| **Loading** | Spinner shown during initial fetch. Replaces results area only if no previous results exist; otherwise shown inline above results. |
| **Empty state** | "No results found" when fetch returns empty with no prior results. |
| **Error state** | "Search failed: <message>" shown inline, previous results preserved. |
| **Minimum query** | No fetch if query is empty string. Show "Type to search..." placeholder. |

### Pagination State

```ts
// Internal state managed by SearchSelectApp
items: T[]                      // all loaded items (appended on each page)
nextCursor: string | undefined  // cursor for next page, undefined = exhausted
isLoadingMore: boolean          // true while fetching next page
```

When the user changes the search query, `items` is cleared and `nextCursor` is reset to `undefined` (fresh search). When the highlight reaches the bottom and `nextCursor` exists, call `onSearch(currentQuery, nextCursor)` and append the returned items.

### Key Handling

`useInput` at the component level handles Up, Down, Escape. TextInput's internal `useInput` also fires on every keypress (Ink broadcasts to all handlers), so Enter requires careful handling to avoid conflicts.

- **Up/Down** move highlight index. TextInput does not use these (single-line, no suggestions).
- **Enter** is handled via TextInput's `onSubmit` callback, NOT via the parent `useInput`. When `onSubmit` fires: if results exist, call `onSelect(items[highlightIndex])`; otherwise treat it as an explicit search trigger. This avoids the dual-fire problem where both TextInput and parent `useInput` would both process Enter.
- **Escape** calls `onCancel`. TextInput receives the Escape keypress but effectively ignores it (empty input insertion is a no-op).
- All other keys pass through to TextInput naturally.

**Important:** Do not handle `key.return` in the parent `useInput`. Delegate Enter exclusively to TextInput's `onSubmit`.

### Render Helper

```ts
// in render.ts
export async function renderSearchSelect<T extends SearchSelectItem>(
  props: Omit<SearchSelectAppProps<T>, "onSelect" | "onCancel">
): Promise<T | undefined>
```

Returns the selected item, or `undefined` if cancelled. Wraps `onSelect`/`onCancel` into a Promise, renders via `ink.render()`, unmounts on resolution.

## MCP Find Command

### CLI Signature

```
workglow mcp find [query]
  --dry-run     Validate and print result without saving
```

`query` is an optional positional argument used as the initial search term.

Requires a TTY. If `!process.stdin.isTTY`, print an error and exit (the search UI is inherently interactive).

### Registry API

```
GET https://registry.modelcontextprotocol.io/v0.1/servers
  ?search=<query>
  &limit=20
  &version=latest
  &cursor=<cursor>        // omitted for first page
```

The API returns a `metadata.nextCursor` field for pagination. Pass it back as the `cursor` parameter to fetch the next page.

Response shape (relevant fields):

```ts
interface McpRegistryResponse {
  servers: Array<{
    server: {
      name: string;           // "io.github.user/server-name"
      title?: string;
      description: string;
      version: string;
      packages?: Array<{
        registryType: string;  // "npm" | "pypi" | "oci"
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
        type: string;          // "sse" | "streamable-http"
        url: string;
      }>;
    };
  }>;
  metadata: {
    nextCursor: string | null;
    count: number;
  };
}
```

### Display Format

Each result row shows:
- **Label:** `server.title ?? server.name`
- **Description:** `server.description` (truncated to terminal width)
- **Badges:** registry type (npm/pypi/oci) + transport type (stdio/sse/streamable-http)

### Result-to-Schema Mapping

When the user selects a server, map it to a partial `McpServerRecordSchema` object:

Note: There is no `McpServerRecord` TypeScript type in the codebase — only `McpServerRecordSchema`. The mapping function returns `Record<string, unknown>`, consistent with how the rest of the MCP code operates (see `mcp.ts` line 120).

```ts
function mapMcpRegistryResult(entry: McpRegistryEntry): Record<string, unknown> {
  const server = entry.server;
  const name = server.name.split("/").pop() ?? server.name;

  // Prefer remotes (direct URL connection) over packages (local process)
  if (server.remotes && server.remotes.length > 0) {
    const remote = server.remotes[0];
    return {
      name,
      transport: remote.type as "sse" | "streamable-http",
      server_url: remote.url,
    };
  }

  // Fall back to first package
  const pkg = server.packages?.[0];
  if (!pkg) return { name };

  const transport = "stdio";
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

  // Append runtime arguments
  if (pkg.runtimeArguments) {
    for (const arg of pkg.runtimeArguments) {
      if (arg.name) args.push(arg.name);
      if (arg.value) args.push(arg.value);
    }
  }

  const result: Record<string, unknown> = { name, transport, command, args };

  // Map environment variables to env object
  if (pkg.environmentVariables && pkg.environmentVariables.length > 0) {
    const env: Record<string, string> = {};
    for (const envVar of pkg.environmentVariables) {
      env[envVar.name] = ""; // placeholder for user to fill
    }
    result.env = env;
  }

  return result;
}
```

### Post-Selection Flow

1. Map selected result to partial input.
2. Pass partial into `promptMissingInput(partial, mcpSchema)` — the existing add form appears pre-populated.
3. Run `validateInput` + transport-specific validation (same as `mcp add`).
4. If `--dry-run`, print JSON and exit. Otherwise save via `createMcpStorage().put()`.

This reuses the entire `mcp add` validation and persistence path.

## Model Find Command

### CLI Signature

```
workglow model find [query]
  --dry-run     Validate and print result without saving
```

Same TTY requirement as `mcp find`.

### HuggingFace API

```
GET https://huggingface.co/api/models
  ?search=<query>
  &limit=20
  &sort=downloads
  &direction=-1
  &skip=<offset>          // 0 for first page, 20 for second, etc.
```

HuggingFace uses offset-based pagination (`skip` parameter) rather than cursors. The `onSearch` cursor is an opaque string — the HF fetch function encodes the offset as a string (e.g. `"20"`, `"40"`). If fewer items than `limit` are returned, set `nextCursor` to `undefined` (exhausted).

Response shape (relevant fields per item):

```ts
interface HfModelEntry {
  id: string;              // "meta-llama/Llama-3.1-8B"
  modelId: string;
  pipeline_tag?: string;   // "text-generation", "feature-extraction", etc.
  library_name?: string;   // "transformers", "onnx", etc.
  likes: number;
  downloads: number;
  tags: string[];
}
```

### Display Format

Each result row shows:
- **Label:** `id` (e.g. `meta-llama/Llama-3.1-8B`)
- **Description:** pipeline tag + download count
- **Badges:** library name

### Result-to-Schema Mapping

```ts
function mapHfModelResult(entry: HfModelEntry): Record<string, unknown> {
  // Map library_name to provider when possible
  let provider = "HF_INFERENCE";
  if (entry.library_name === "onnx" || entry.tags?.includes("onnx")) {
    provider = "HF_TRANSFORMERS_ONNX";
  }

  // Sanitize model_id: slashes break FsFolderTabularStorage filenames
  const model_id = entry.id.replace(/\//g, "--");

  return {
    model_id,
    provider,
    title: entry.id.split("/").pop() ?? entry.id,
    description: [entry.pipeline_tag, `${formatDownloads(entry.downloads)} downloads`]
      .filter(Boolean)
      .join(" — "),
    tasks: entry.pipeline_tag ? [entry.pipeline_tag] : [],
    provider_config: { model_name: entry.id },
    metadata: {},
  };
}
```

### Post-Selection Flow

1. Map selected result to partial input.
2. Detect provider from partial (default `HF_INFERENCE`), select provider-specific schema.
3. Apply defaults via `applySchemaDefaults`.
4. Pass into `promptMissingInput(partial, providerSchema)` for review/edit.
5. Run `validateInput`.
6. If `--dry-run`, print JSON and exit. Otherwise save via `modelRepo.addModel()`.

## Shared Patterns

Both `find` commands follow the same structure:

```
1. renderSearchSelect(fetchFn, displayFn)  →  selected item or undefined
2. mapResult(selected)                      →  partial schema input
3. promptMissingInput(partial, schema)      →  complete input (form UI)
4. validateInput(input, schema)             →  validation
5. storage.put(input)                       →  persist
```

The only differences are the fetch URL, response mapping, and target schema/storage.

## Testing

- Unit tests for mapping functions (`mapMcpRegistryResult`, `mapHfModelResult`) with fixture data.
- SearchSelectApp can be tested with `ink-testing-library` using mocked `onSearch`.
- Integration: manual testing against live registries.

## Known Limitations

- **Model provider detection is best-effort.** `library_name` maps to `HF_TRANSFORMERS_ONNX` for onnx models; everything else defaults to `HF_INFERENCE`. Users can change the provider in the add form.
- **MCP runtime/package arguments** are appended as `--flag value` pairs. Some servers may use positional or `=` syntax; this is best-effort for v1.
