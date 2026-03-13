# Knowledge Base Library UI

## Problem

The builder has a full Model Library page for managing AI models (list, add, delete, edit), but no equivalent for knowledge bases. Knowledge base property/input editors exist but are broken — they don't detect `format: "knowledge-base"` schemas, which is what `TypeKnowledgeBase()` produces. Users have no way to manage KBs or create them outside of code.

Additionally, KB management must be **project-scoped** (like models, workflows, agents), not global. The current `getGlobalKnowledgeBaseRepository()` returns a global repository — but the builder needs a `BuilderKnowledgeBaseRepository` that extends the base with `user_id`/`project_id`, backed by persistent storage (IndexedDB / Supabase), following the same pattern as `BuilderModelRepository`.

## Scope

Four changes:

1. **Builder KB Repository** — project-scoped schema, repository, persistent storage (matching model pattern)
2. **Knowledge Base Library page** — standalone management UI mirroring the Model Library pattern
3. **Fix format detection** — editors exist but fail to match `format: "knowledge-base"`
4. **Inline create** — "Create New" action in KB property/input editor popovers

## 1. Builder KB Repository (project-scoped persistence)

### Pattern: follow BuilderModelRepository exactly

The builder extends base library schemas/repositories with `user_id`/`project_id` for project scoping and uses persistent storage (IndexedDB or Supabase) with an in-memory cache layer.

**Reference implementation:**
- `components/model/BuilderModelSchema.ts` — extends `ModelRecordSchema` with `user_id`, `project_id`
- `components/model/BuilderModelRepository.ts` — extends `ModelRepository`, takes `BuilderModelTabularStorage`
- `lib/create-repositories.ts` — creates durable + cache + cached storage stack, registers globally

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
// Durable storage (Supabase)
const kbDurableStorage = new SupabaseTabularStorage<...>(
  supabase, "knowledge_bases", BuilderKnowledgeBaseRecordSchema,
  BuilderKnowledgeBaseRecordSchemaPrimaryKeys, BuilderKnowledgeBaseRecordSchemaSecondaryKeys
);
// In-memory cache layer
const kbCacheStorage = new InMemoryTabularStorage<...>(...);
// Combined cached storage
const kbStorage = new CachedTabularStorage<...>(kbDurableStorage, kbCacheStorage, ...);
const knowledgeBaseRepository = new BuilderKnowledgeBaseRepository(kbStorage);
setGlobalKnowledgeBaseRepository(knowledgeBaseRepository);
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
setGlobalKnowledgeBaseRepository(knowledgeBaseRepository);
```

In initialization sequence: `await kbStorage.setupDatabase()` + `await kbStorage.refreshCache()`.

### Context integration

Add `knowledgeBaseRepository` to:
- `Repositories` interface in `create-repositories.ts`
- `UserRepositoryContextValue` in `UserRepositoryContext.tsx`
- `UserRepositoryProvider`
- Add `useKnowledgeBaseRepository()` hook in `useUserRepositories.ts`

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
- Uses `useKnowledgeBaseRepository()` hook to get the project-scoped repository
- Calls `repository.enumerateAll()` for persisted records, then filters by current `user_id` + `project_id`
- For live stats, looks up each KB from `getGlobalKnowledgeBases()` map if the live instance is available, calls `kb.chunkCount()` (async) and `kb.listDocuments().then(d => d.length)` for document count
- Follows Model Library's reload-after-mutation pattern (call `loadKnowledgeBases()` after create/delete)

**Search:** Filters by title, kb_id, description (case-insensitive).

**Delete:** Calls `repository.removeKnowledgeBase(kb_id)` and removes from the live `getGlobalKnowledgeBases()` map. Confirmation dialog before delete.

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
- Name/ID must be alphanumeric + hyphens/underscores, no spaces
- Check for duplicate via `repository.getKnowledgeBase(name)` — show error if exists

**On submit:**
1. Build a `BuilderKnowledgeBaseRecord` with `user_id`, `project_id`, computed `document_table`/`chunk_table` from `knowledgeBaseTableNames(name)`, timestamps
2. Call `repository.addKnowledgeBase(record)` to persist
3. Create a live `KnowledgeBase` instance (using in-memory storage for documents/chunks) and add to `getGlobalKnowledgeBases()` map so it's immediately available to workflows

**Note:** The document/chunk storage for live KB instances is in-memory. The metadata record persists across sessions. When the app restarts, metadata is loaded from the repository; live KB instances with their document/chunk storage are recreated when workflows use them. This matches how the system already works.

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

## Files Summary

### New files (in builder)

| File | Purpose |
|------|---------|
| `components/knowledge-base/BuilderKnowledgeBaseSchema.ts` | Extended schema with user_id/project_id |
| `components/knowledge-base/BuilderKnowledgeBaseRepository.ts` | Project-scoped repository |
| `routes/_authenticated/project/$project_id/knowledge-bases.tsx` | Route |
| `components/knowledge-base/KnowledgeBaseLibrary.tsx` | Library page |
| `components/knowledge-base/KnowledgeBaseCard.tsx` | Card component |
| `components/knowledge-base/AddKnowledgeBaseDialog.tsx` | Create dialog |

### Modified files (in builder)

| File | Change |
|------|--------|
| `lib/create-repositories.ts` | Add KB storage stack + repository for both Supabase and IndexedDB |
| `contexts/UserRepositoryContext.tsx` | Add `knowledgeBaseRepository` to context |
| `contexts/UserRepositoryProvider.tsx` | Pass through KB repository |
| `contexts/useUserRepositories.ts` | Add `useKnowledgeBaseRepository()` hook |
| `routes/_authenticated/route.tsx` | Add nav entry + Database icon import |
| `property-editors/KnowledgeBasePropertyEditor.tsx` | Fix format detection + add "Create New" |
| `shared/input-editors/types.ts` | Fix `hasKnowledgeBaseFormat()` |
| `shared/input-editors/KnowledgeBaseInputEditor.tsx` | Add "Create New" |

## Dependencies

All KB library imports come from `@workglow/knowledge-base` which is already a dependency of the builder. Storage types (`CachedTabularStorage`, `IndexedDbTabularStorage`, `InMemoryTabularStorage`, `SupabaseTabularStorage`) are already imported in `create-repositories.ts`.

UI components used: Button, AlertDialog, Command/Combobox, Popover, DropdownMenu, Dialog — all already exist in the builder's UI library.
