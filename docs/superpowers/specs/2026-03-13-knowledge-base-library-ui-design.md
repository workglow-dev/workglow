# Knowledge Base Library UI

## Problem

The builder has a full Model Library page for managing AI models (list, add, delete, edit), but no equivalent for knowledge bases. Knowledge base property/input editors exist but are broken — they don't detect `format: "knowledge-base"` schemas, which is what `TypeKnowledgeBase()` produces. Users have no way to manage KBs or create them outside of code.

## Scope

Three changes:

1. **Knowledge Base Library page** — standalone management UI mirroring the Model Library pattern
2. **Fix format detection** — editors exist but fail to match `format: "knowledge-base"`
3. **Inline create** — "Create New" action in KB property/input editor popovers

## 1. Knowledge Base Library Page

### Route

New file: `routes/_authenticated/project/$project_id/knowledge-bases.tsx`

- Path: `/project/{projectId}/knowledge-bases`
- Renders heading + `<KnowledgeBaseLibrary />`
- Mirrors `models.tsx` structure exactly

### Navigation

In `routes/_authenticated/route.tsx`, add entry after "Models":

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
- `getGlobalKnowledgeBaseRepository().enumerateAll()` for persisted records
- For live stats, looks up each KB from `getGlobalKnowledgeBases()` map, calls `kb.chunkCount()` (async)
- Subscribes to `KnowledgeBaseRepository` events (`knowledge_base_added`, `knowledge_base_removed`) for auto-refresh

**Search:** Filters by title, kb_id, description (case-insensitive).

**Delete:** Calls `getGlobalKnowledgeBaseRepository().removeKnowledgeBase(kb_id)` and removes from the live `getGlobalKnowledgeBases()` map. Confirmation dialog before delete.

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

**On submit:** Calls `createKnowledgeBase({ name, vectorDimensions, title, description })` from `@workglow/knowledge-base`. This auto-registers in both the live Map and the repository.

**Reusable:** Exported so it can also be used inline from property/input editors.

## 2. Fix Format Detection

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

## 3. Inline Create from Editors

### Property Editor

In `KnowledgeBasePropertyEditor.tsx`, add a footer section below the command list (when popover is open):

```tsx
<div className="border-t p-2">
  <AddKnowledgeBaseDialog
    trigger={<Button variant="ghost" size="sm" className="w-full h-7 text-xs"><Plus size={12} className="mr-1" /> Create New</Button>}
    onCreated={(kbId) => { handleSelect(kbId); }}
  />
</div>
```

After creation, auto-select the new KB and close the popover.

### Input Editor

Same pattern in `KnowledgeBaseInputEditor.tsx` — add "Create New" footer button that opens `AddKnowledgeBaseDialog`.

## Files Summary

### New files (in builder)

| File | Purpose |
|------|---------|
| `routes/_authenticated/project/$project_id/knowledge-bases.tsx` | Route |
| `components/knowledge-base/KnowledgeBaseLibrary.tsx` | Library page |
| `components/knowledge-base/KnowledgeBaseCard.tsx` | Card component |
| `components/knowledge-base/AddKnowledgeBaseDialog.tsx` | Create dialog |

### Modified files (in builder)

| File | Change |
|------|--------|
| `routes/_authenticated/route.tsx` | Add nav entry |
| `property-editors/KnowledgeBasePropertyEditor.tsx` | Fix format detection + add "Create New" |
| `shared/input-editors/types.ts` | Fix `hasKnowledgeBaseFormat()` |
| `shared/input-editors/KnowledgeBaseInputEditor.tsx` | Add "Create New" |

## Dependencies

All KB library imports come from `@workglow/knowledge-base` which is already a dependency of the builder. No new package dependencies needed.

UI components used: Button, AlertDialog, Command/Combobox, Popover, DropdownMenu, Dialog — all already exist in the builder's UI library.
