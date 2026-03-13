# Knowledge Base Library UI

## Problem

The builder has a full Model Library page for managing AI models (list, add, delete, edit), but no equivalent for knowledge bases. Knowledge base property/input editors exist but are broken — they don't detect `format: "knowledge-base"` schemas, which is what `TypeKnowledgeBase()` produces. Users have no way to manage KBs or create them outside of code.

KB management must be **project-scoped** (like models, workflows, agents). The builder needs a `BuilderKnowledgeBaseRepository` that extends the base with `user_id`/`project_id`, backed by persistent storage (IndexedDB / Supabase), following the same pattern as `BuilderModelRepository`.

**Important:** The builder must NOT rely on global registries (`getGlobalKnowledgeBaseRepository()`, `getGlobalKnowledgeBases()`, `setGlobalModelRepository()`, etc.). All access should go through React context or explicit dependency injection. Global registries should eventually be set to null in the builder to flush out any hidden dependencies.

## Scope

Five changes:

1. **Builder KB Repository** — project-scoped schema, repository, persistent storage, React context
2. **Knowledge Base Library page** — standalone management UI mirroring the Model Library pattern
3. **Fix format detection** — editors exist but fail to match `format: "knowledge-base"`
4. **Inline create** — "Create New" action in KB property/input editor popovers
5. **Runtime KB hydration** — ensure project KBs are in a ServiceRegistry passed to workflow execution

## 1. Builder KB Repository (project-scoped persistence)

### Pattern: follow BuilderModelRepository but with proper context

The builder extends base library schemas/repositories with `user_id`/`project_id` for project scoping and uses persistent storage (IndexedDB or Supabase) with an in-memory cache layer.

**Reference implementation:**
- `components/model/BuilderModelSchema.ts` — extends `ModelRecordSchema` with `user_id`, `project_id`
- `components/model/BuilderModelRepository.ts` — extends `ModelRepository`, takes `BuilderModelTabularStorage`
- `lib/create-repositories.ts` — creates durable + cache + cached storage stack

### BuilderKnowledgeBaseSchema

File: `components/knowledge-base/BuilderKnowledgeBaseSchema.ts`

```ts
import { KnowledgeBaseRecordSchema } from "@workglow/knowledge-base";
import { type DataPortSchemaObject, type FromSchema } from "@workglow/util";

export const BuilderKnowledgeBaseRecordSchema = {
  type: "object",
  properties: {
    ...KnowledgeBaseRecordSchema.properties,
    user_id: { type: "string" },
    project_id: { type: "string" },
  },
  required: [...KnowledgeBaseRecordSchema.required, "user_id", "project_id"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type BuilderKnowledgeBaseRecord = FromSchema<typeof BuilderKnowledgeBaseRecordSchema>;
export const BuilderKnowledgeBaseRecordSchemaPrimaryKeys = ["kb_id"] as const;
export const BuilderKnowledgeBaseRecordSchemaSecondaryKeys = [["user_id", "project_id"]] as const;
```

### BuilderKnowledgeBaseRepository

File: `components/knowledge-base/BuilderKnowledgeBaseRepository.ts`

**Note:** `KnowledgeBaseRepository` accepts `BaseTabularStorage` (not `ITabularStorage` like `ModelRepository`). Change the base class to accept `ITabularStorage` for consistency.

```ts
import { KnowledgeBaseRepository } from "@workglow/knowledge-base";
import { ITabularStorage } from "@workglow/storage";
import type {
  BuilderKnowledgeBaseRecord,
  BuilderKnowledgeBaseRecordSchema,
  BuilderKnowledgeBaseRecordSchemaPrimaryKeys,
} from "./BuilderKnowledgeBaseSchema";

type BuilderKnowledgeBaseTabularStorage = ITabularStorage<
  typeof BuilderKnowledgeBaseRecordSchema,
  typeof BuilderKnowledgeBaseRecordSchemaPrimaryKeys,
  BuilderKnowledgeBaseRecord
>;

export class BuilderKnowledgeBaseRepository extends KnowledgeBaseRepository {
  constructor(storage: BuilderKnowledgeBaseTabularStorage) {
    super(storage);
  }
}
```

### Storage initialization in create-repositories.ts

Add to both `createSupabaseRepositories()` and `createIndexedDbRepositories()`, following the model storage pattern:

**Supabase mode:**
```ts
const kbDurableStorage = new SupabaseTabularStorage<...>(
  supabase, "knowledge_bases", BuilderKnowledgeBaseRecordSchema,
  BuilderKnowledgeBaseRecordSchemaPrimaryKeys, BuilderKnowledgeBaseRecordSchemaSecondaryKeys
);
const kbCacheStorage = new InMemoryTabularStorage<...>(...);
const kbStorage = new CachedTabularStorage<...>(kbDurableStorage, kbCacheStorage, ...);
const knowledgeBaseRepository = new BuilderKnowledgeBaseRepository(kbStorage);
```

**IndexedDB mode:**
```ts
const kbDurableStorage = new IndexedDbTabularStorage<...>(
  "knowledge_bases", BuilderKnowledgeBaseRecordSchema,
  BuilderKnowledgeBaseRecordSchemaPrimaryKeys, BuilderKnowledgeBaseRecordSchemaSecondaryKeys
);
const kbCacheStorage = new InMemoryTabularStorage<...>(...);
const kbStorage = new CachedTabularStorage<...>(...);
const knowledgeBaseRepository = new BuilderKnowledgeBaseRepository(kbStorage);
```

In initialization sequence: `await kbStorage.setupDatabase()` + `await kbStorage.refreshCache()`.

Add `knowledgeBaseRepository` to the `Repositories` interface and return it from both factory functions.

**Do NOT call `setGlobalKnowledgeBaseRepository()`.**

### React context integration

Unlike the current model pattern (which incorrectly uses `setGlobalModelRepository()`/`getGlobalModelRepository()`), the KB repository should be accessed through React context:

- Add `knowledgeBaseRepository: BuilderKnowledgeBaseRepository` to `UserRepositoryContextValue` in `UserRepositoryContext.tsx`
- Pass through in `UserRepositoryProvider.tsx`
- Add `useKnowledgeBaseRepository()` hook in `useUserRepositories.ts`

Components use `useKnowledgeBaseRepository()` instead of calling any global getter.

**Future cleanup:** Models should be migrated to the same context-based pattern, and `setGlobalModelRepository()` calls removed from the builder. This is out of scope for this spec but noted as follow-up work.

### Supabase migration

A `knowledge_bases` table needs to exist in Supabase with columns matching `BuilderKnowledgeBaseRecordSchema` (kb_id, title, description, vector_dimensions, document_table, chunk_table, created_at, updated_at, user_id, project_id). This is a database migration item.

## 2. Knowledge Base Library Page

### Route

New file: `routes/_authenticated/project/$project_id/knowledge-bases.tsx`

- Path: `/project/{projectId}/knowledge-bases`
- Renders heading + `<KnowledgeBaseLibrary />`
- Mirrors `models.tsx` structure exactly

### Navigation

In `routes/_authenticated/route.tsx`, add `Database` to the lucide-react import (line 8) and add entry after "Models":

```ts
{
  id: "knowledge-bases",
  label: "Knowledge Bases",
  icon: Database,  // from lucide-react
  to: `/project/${projectId}/knowledge-bases`,
}
```

### KnowledgeBaseLibrary component

File: `components/knowledge-base/KnowledgeBaseLibrary.tsx`

**Layout:**
- Search bar + "Create Knowledge Base" button (top row)
- Stats line: `N knowledge bases`
- Responsive card grid (1/2/3 columns)
- Empty state with icon and prompt
- Delete confirmation AlertDialog

**Data loading:**
- Uses `useKnowledgeBaseRepository()` to access the repository
- Calls `repository.enumerateAll()` for persisted records (CachedTabularStorage is pre-loaded via `refreshCache()`)
- For live stats, looks up each KB's live instance if available, calls `kb.chunkCount()` (async) and `kb.listDocuments().then(d => d.length)` for document count. Show loading/placeholder state while stats are fetched.
- Follows Model Library's reload-after-mutation pattern (call `loadKnowledgeBases()` after create/delete)

**Search:** Filters by title, kb_id, description (case-insensitive).

**Delete:** Calls `repository.removeKnowledgeBase(kb_id)` and removes from the live instances map. Confirmation dialog before delete.

### KnowledgeBaseCard component

File: `components/knowledge-base/KnowledgeBaseCard.tsx`

Displays:
- **Title** (bold heading)
- **KB ID** (monospace, muted — like model path display)
- **Description** (truncated, if present)
- **Stats row**: vector dimensions, document count, chunk count (icons from lucide: `Layers`, `FileText`, `Hash`)
- **Created date** (formatted)
- **Actions**: overflow menu (MoreVertical) with "Delete" option

Uses `memo()` for performance, same pattern as `ModelCard`.

### AddKnowledgeBaseDialog component

File: `components/knowledge-base/AddKnowledgeBaseDialog.tsx`

Trigger: Button with `Plus` icon, text "Create Knowledge Base".

**Form fields:**
- **Name / ID** — required text input, used as registry key. Validated: no spaces, alphanumeric + hyphens/underscores.
- **Title** — required text input, human-readable display name
- **Description** — optional textarea
- **Vector Dimensions** — required number input, default `384`

**Validation:**
- Name/ID (used as `kb_id`) must be alphanumeric + hyphens/underscores, no spaces
- Check for duplicate via `repository.getKnowledgeBase(kb_id)` — show error if exists

**On submit:**
1. Get `user_id` from `useAuth()` and `project_id` from `useProjectId()` (same hooks `AddModelDialog` uses)
2. Build a `BuilderKnowledgeBaseRecord` with `user_id`, `project_id`, `kb_id` from the Name field, computed `document_table`/`chunk_table` from `knowledgeBaseTableNames(kb_id)`, timestamps
3. Call `repository.addKnowledgeBase(record)` to persist
4. Create a live `KnowledgeBase` instance (using in-memory storage for documents/chunks) and store it so it's available to workflows within this session

**Note:** The document/chunk storage for live KB instances is in-memory. The metadata record persists across sessions. When the app restarts, metadata is loaded from the repository; live KB instances with their document/chunk storage are recreated before workflow runs (see Section 5).

**Reusable:** Uses `open`/`onOpenChange`/`onCreated` props (matching `AddModelDialog` API pattern) so it works both standalone and inline from editors.

## 3. Fix Format Detection

### Bug

`hasKnowledgeBaseFormat()` checks for `dataset:*` and `storage:tabular` but not `knowledge-base`. The `TypeKnowledgeBase()` helper produces `format: "knowledge-base"`, so KB editors never match.

### Fix

Two files, same change — add `format === "knowledge-base"` to the condition:

**File 1:** `components/workflow/nodes/task-node/property-editors/KnowledgeBasePropertyEditor.tsx` (line 28)

```ts
// Before
return format.startsWith("dataset:") || format === "storage:tabular";

// After
return format === "knowledge-base" || format.startsWith("dataset:") || format === "storage:tabular";
```

**File 2:** `components/shared/input-editors/types.ts` (line 464)

Same change to the exported `hasKnowledgeBaseFormat()`.

The `getKnowledgeBaseEntries()` functions in both editors already handle `format === "knowledge-base"` correctly for data retrieval — only the detection is broken.

**Note:** The `getKnowledgeBaseEntries()` functions currently call `getGlobalKnowledgeBases()`. These should be updated to receive the KB map as a parameter or from context, consistent with the no-globals approach.

## 4. Inline Create from Editors

### Property Editor

In `KnowledgeBasePropertyEditor.tsx`, add a footer section below the command list (when popover is open). Use state to control the dialog externally (`open`/`onOpenChange`) rather than embedding a trigger inside the popover (avoids Radix Popover + Dialog portal conflicts):

```tsx
{/* Footer with Create New button */}
<div className="border-t p-2">
  <Button variant="ghost" size="sm" className="w-full h-7 text-xs" onClick={() => { setOpen(false); setCreateDialogOpen(true); }}>
    <Plus size={12} className="mr-1" /> Create New
  </Button>
</div>

{/* Dialog rendered outside the popover */}
<AddKnowledgeBaseDialog
  open={createDialogOpen}
  onOpenChange={setCreateDialogOpen}
  onCreated={(kbId) => { handleSelect(kbId); }}
/>
```

After creation, auto-select the new KB.

### Input Editor

Same pattern in `KnowledgeBaseInputEditor.tsx` — add "Create New" footer button that opens `AddKnowledgeBaseDialog`.

## 5. Runtime KB Hydration for Workflow Execution

### Problem

When a workflow runs, tasks with `format: "knowledge-base"` inputs have their string IDs resolved via `resolveKnowledgeBaseFromRegistry()` which looks up a `ServiceRegistry` for the `KNOWLEDGE_BASES` token. If no live `KnowledgeBase` instance exists for that ID, the resolver throws.

The repository persists KB metadata records, but live `KnowledgeBase` instances (with document/chunk storage) only exist if they were created during the current session.

### Solution

`taskGraph.run(input, config)` accepts a `TaskGraphRunConfig` with an optional `registry: ServiceRegistry`. The `TaskGraphRunner` uses this registry for input resolution (`resolveSchemaInputs` passes `config.registry` to resolvers). The `resolveKnowledgeBaseFromRegistry` resolver checks `registry.has(KNOWLEDGE_BASES)` first before falling back to global.

Before workflow execution, build a `ServiceRegistry` populated with the project's live KB instances and pass it to `taskGraph.run()`.

### Implementation

Add a `buildProjectServiceRegistry()` utility function:

File: `lib/build-project-registry.ts`

```ts
import { KNOWLEDGE_BASES, createKnowledgeBase } from "@workglow/knowledge-base";
import type { BuilderKnowledgeBaseRepository } from "@/components/knowledge-base/BuilderKnowledgeBaseRepository";
import { ServiceRegistry } from "@workglow/util";

/**
 * Builds a ServiceRegistry populated with live KnowledgeBase instances
 * for all KBs in the given repository. Used as the `registry` config
 * when running task graphs.
 */
export async function buildProjectServiceRegistry(
  knowledgeBaseRepository: BuilderKnowledgeBaseRepository
): Promise<ServiceRegistry> {
  const registry = new ServiceRegistry();
  const kbMap = new Map<string, KnowledgeBase>();

  const records = await knowledgeBaseRepository.enumerateAll();
  for (const record of records) {
    // Create live instance with in-memory document/chunk storage
    const kb = await createKnowledgeBase({
      name: record.kb_id,
      vectorDimensions: record.vector_dimensions,
      title: record.title,
      description: record.description,
      register: false, // do NOT register globally
    });
    kbMap.set(record.kb_id, kb);
  }

  registry.registerInstance(KNOWLEDGE_BASES, kbMap);
  return registry;
}
```

### Call sites

Pass the built registry to `taskGraph.run()` in both execution paths:

1. **`WorkflowViewer.tsx` `executeRun()`** — build registry before `taskGraph.run(inputs)`
2. **`run-workflow.ts` `runWorkflow()`** — accept registry in `RunWorkflowContext`, pass to `taskGraph.run(inputs, { registry })`

```ts
const registry = await buildProjectServiceRegistry(knowledgeBaseRepository);
const result = await taskGraph.run(inputs, {
  outputCache: taskOutputCacheRepository,
  registry,
});
```

The `RunWorkflowContext` interface should add `knowledgeBaseRepository: BuilderKnowledgeBaseRepository`.

### Editor access to live KBs

The property/input editors also need KB instances for their dropdowns. Instead of calling `getGlobalKnowledgeBases()`, they should receive the KB entries via context or props. Options:

- (a) The `KnowledgeBaseLibrary` page and editors maintain a React context/state with the current project's KB records (from the repository). They don't need live instances — just the `KnowledgeBaseRecord` metadata (kb_id, title, description) for display/selection.
- (b) For now, editors can call `knowledgeBaseRepository.enumerateAll()` to get records for the dropdown, rather than relying on the global map.

Option (b) is simpler and sufficient — the editors only need IDs and titles for selection, not live instances.

## Files Summary

### New files (in builder)

| File | Purpose |
|------|---------|
| `components/knowledge-base/BuilderKnowledgeBaseSchema.ts` | Extended schema with user_id/project_id |
| `components/knowledge-base/BuilderKnowledgeBaseRepository.ts` | Project-scoped repository |
| `lib/build-project-registry.ts` | Build ServiceRegistry with live KB instances for workflow runs |
| `routes/_authenticated/project/$project_id/knowledge-bases.tsx` | Route |
| `components/knowledge-base/KnowledgeBaseLibrary.tsx` | Library page |
| `components/knowledge-base/KnowledgeBaseCard.tsx` | Card component |
| `components/knowledge-base/AddKnowledgeBaseDialog.tsx` | Create dialog |

### Modified files (in builder)

| File | Change |
|------|--------|
| `lib/create-repositories.ts` | Add KB storage stack + repository for both Supabase and IndexedDB; add to `Repositories` interface; do NOT call `setGlobalKnowledgeBaseRepository()` |
| `lib/run-workflow.ts` | Accept `knowledgeBaseRepository` in context, build registry, pass to `taskGraph.run()` |
| `components/workflow/WorkflowViewer.tsx` | Build registry before `taskGraph.run()` |
| `contexts/UserRepositoryContext.tsx` | Add `knowledgeBaseRepository` to context |
| `contexts/UserRepositoryProvider.tsx` | Pass through KB repository |
| `contexts/useUserRepositories.ts` | Add `useKnowledgeBaseRepository()` hook |
| `routes/_authenticated/route.tsx` | Add nav entry + Database icon import |
| `property-editors/KnowledgeBasePropertyEditor.tsx` | Fix format detection + add "Create New"; update `getKnowledgeBaseEntries()` to use repository instead of global map |
| `shared/input-editors/types.ts` | Fix `hasKnowledgeBaseFormat()` |
| `shared/input-editors/KnowledgeBaseInputEditor.tsx` | Add "Create New"; update `getKnowledgeBaseEntries()` to use repository instead of global map |

### Modified files (in libs)

| File | Change |
|------|--------|
| `packages/knowledge-base/src/knowledge-base/KnowledgeBaseRepository.ts` | Change `BaseTabularStorage` to `ITabularStorage` for consistency with `ModelRepository` |

## Dependencies

All KB library imports come from `@workglow/knowledge-base` which is already a dependency of the builder. Storage types (`CachedTabularStorage`, `IndexedDbTabularStorage`, `InMemoryTabularStorage`, `SupabaseTabularStorage`) are already imported in `create-repositories.ts`.

UI components used: Button, AlertDialog, Command/Combobox, Popover, DropdownMenu, Dialog — all already exist in the builder's UI library.

## Follow-up work (out of scope)

- Migrate models from `setGlobalModelRepository()`/`getGlobalModelRepository()` to React context
- Set all global registries to null in the builder to flush out hidden dependencies
- Consider moving the `ServiceRegistry` building to a shared utility that also handles model resolution for full consistency
