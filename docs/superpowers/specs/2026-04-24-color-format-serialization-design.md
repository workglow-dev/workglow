# Color format serialization (`format: "color"`)

**Date:** 2026-04-24
**Status:** Design approved, not yet implemented
**Branch:** TBD (currently on `image-text-task-input`)

## Problem

Tasks exchange color values through the task-graph dataflow. Today the only supported wire form is the object `{r, g, b, a}` via `ColorSchema()` in `packages/tasks/src/task/image/ImageSchemas.ts`. A task that naturally emits a hex string (e.g., a color picker, a palette lookup, an LLM response) cannot feed a task that accepts only the object form — even though autoConnect happily links them by shared `format: "color"`, the value fails the consumer's schema.

We want `format: "color"` to behave like `format: "image"`: ports declare `oneOf` on the two canonical forms, and consuming tasks normalize to the internal form with a small helper.

## Scope

**In scope:**
- A `ColorObject` interface + hex parse/emit utilities in `@workglow/util`.
- New schema helpers `HexColorSchema()` and `ColorValueSchema()` colocated with existing `ColorSchema()` in `packages/tasks/src/task/image/ImageSchemas.ts`.
- Migration of the three existing color-consuming tasks (`ImageTintTask`, `ImageTextTask`, `ImageBorderTask`) to accept either form via `ColorValueSchema()` and normalize with `resolveColor()`.
- Unit + end-to-end tests.

**Out of scope:**
- CSS named colors (`"red"`), `rgb()`/`hsl()` functional syntax.
- A `Color` class wrapper — the wire forms and helper functions are enough.
- A `produceColorOutput` transport helper — hex↔object conversion is trivial, so emitting in the caller's form has no measurable benefit.
- Builder-side color picker UI that recognizes the new `oneOf` schema — separate follow-up.
- Dataflow-layer automatic conversion between strict string and strict object ports.

## Architecture

### Wire forms

| Form   | Example                                 | Notes                                           |
|--------|-----------------------------------------|-------------------------------------------------|
| Object | `{r: 255, g: 0, b: 0, a: 255}`          | Existing `ColorSchema()`. `a` defaults to 255.  |
| Hex    | `"#ff0000"`, `"#ff000080"`, `"#f00"`, `"#f008"` | 3/4/6/8 hex digits, `#`-prefixed, case-insensitive on input. |

Emitted hex is always lowercase, never shorthand (always 6 or 8 digits). Shorthand (`#f00`) is parse-only.

### Module layout

```
packages/util/src/media/color.ts             (new, pure TS, no deps)
  - interface ColorObject
  - parseHexColor(hex): ColorObject
  - toHexColor(c): string
  - resolveColor(value): ColorObject
  - isColorObject(value): value is ColorObject
  - isHexColor(value): value is string

packages/util/src/media-browser.ts           (extend: export * from "./media/color")
packages/util/src/media-node.ts              (extend: export * from "./media/color")

packages/tasks/src/task/image/ImageSchemas.ts (extend)
  - ColorSchema()          ← existing, unchanged
  - HexColorSchema()       ← new
  - ColorValueSchema()     ← new, oneOf union
  - ColorFromSchemaOptions ← new, type inference options
  - ColorFromSchema<S>     ← new, generic type helper
```

Color exports through the `@workglow/util/media` sub-path, mirroring `ImageBinary`. The `/media` entry already holds pure-TS types colocated with platform-specific handlers (see existing `media/image.ts` which defines `ImageBinary` and `parseDataUri` with no native deps).

`ImageSchemas.ts` imports `ColorObject` from `@workglow/util/media`, matching the existing `import type { ImageBinary } from "@workglow/util/media"` at the top of that file.

### AutoConnect behavior

No changes required. `autoConnect.getSpecificTypeIdentifiers` (packages/task-graph/src/task-graph/autoConnect.ts:65-107) already descends into `oneOf`/`anyOf` and collects every nested `format`. A port emitting hex-only (`format: "color"` inside a `oneOf` branch) matches a port accepting `ColorValueSchema()` because the shared inner `format: "color"` is visible to the matcher on both sides. `ColorValueSchema()` therefore does NOT need an outer `format: "color"` — matching `ImageBinaryOrDataUriSchema` which carries no outer format either.

## API

### `packages/util/src/media/color.ts`

```ts
export interface ColorObject {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Parse a #RGB / #RGBA / #RRGGBB / #RRGGBBAA hex color into a ColorObject.
 * Case-insensitive. No whitespace tolerance. Throws on malformed input.
 * Shorthand nibbles are doubled (e.g. #f00 → {r:255, g:0, b:0, a:255}).
 */
export function parseHexColor(hex: string): ColorObject;

/**
 * Emit a ColorObject as #RRGGBB when a === 255, else #RRGGBBAA. Lowercase.
 * Throws if any channel is non-integer or outside 0–255.
 */
export function toHexColor(c: ColorObject): string;

/**
 * Normalize either wire form to a ColorObject. Object inputs default `a` to 255.
 * Throws on any other input.
 */
export function resolveColor(value: string | ColorObject): ColorObject;

export function isColorObject(value: unknown): value is ColorObject;
export function isHexColor(value: unknown): value is string;
```

### `packages/tasks/src/task/image/ImageSchemas.ts`

Existing `ColorSchema()` stays as-is. Add:

```ts
export const HexColorSchema = (annotations: Record<string, unknown> = {}) =>
  ({
    type: "string",
    format: "color",
    pattern: "^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$",
    title: "Color (hex)",
    ...annotations,
  }) as const;

export const ColorValueSchema = (annotations: Record<string, unknown> = {}) =>
  ({
    oneOf: [
      ColorSchema(),
      HexColorSchema({
        title: (annotations.title as string | undefined) ?? "Color",
        description:
          (annotations.description as string | undefined) ??
          "Color as {r,g,b,a} object or `#RRGGBB[AA]` / `#RGB[A]` hex string",
      }),
    ],
    ...annotations,
  }) as const;

// Type-only sentinel for FromSchema deserialize patterns, mirroring ImageBinaryType.
const ColorObjectType = null as any as ColorObject;

export const ColorFromSchemaOptions = {
  ...FromSchemaDefaultOptions,
  deserialize: [
    {
      pattern: { type: "object", format: "color" },
      output: ColorObjectType,
    },
  ],
} as const satisfies FromSchemaOptions;

export type ColorFromSchemaOptions = typeof ColorFromSchemaOptions;

export type ColorFromSchema<SCHEMA extends JsonSchema> = FromSchema<
  SCHEMA,
  ColorFromSchemaOptions
>;
```

The `pattern` regex covers all four hex lengths in one expression:
- `{3,4}` → `#RGB` and `#RGBA`
- `{6}` → `#RRGGBB`
- `{8}` → `#RRGGBBAA`

## Task migration

Each of `ImageTintTask`, `ImageTextTask`, `ImageBorderTask`:

1. Change the `color` port schema from `ColorSchema()` to `ColorValueSchema()`.
2. At the top of `execute()`, call `const color = resolveColor(input.color)` instead of destructuring the raw input.
3. Replace every subsequent `input.color.r/g/b/a` with `color.r/g/b/a`.

No behavior change for existing callers using object-form colors — the schema still accepts them, and `resolveColor()` is an identity-with-defaulting on object inputs.

## Testing

### Unit tests

New file in `packages/test/src/test/` (name to match existing convention, e.g., `colorSchema.test.ts`):

- **`parseHexColor`** accepts `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA` (upper and lower case); expands shorthand correctly; rejects `#ABC1` (5 digits), `#GG0000`, `FF0000` (missing `#`), empty string, whitespace-padded, non-string input.
- **`toHexColor`** emits `#ff0000` for opaque red, `#ff000080` for half-alpha red, lowercase output; throws on non-integer channels and out-of-range values.
- **Round trip**: `toHexColor(parseHexColor(x))` equals `x.toLowerCase()` for 6/8-digit forms; 3/4-digit shorthand round-trips to the expanded 6/8-digit lowercase form.
- **`resolveColor`** handles both wire forms; defaults `a` to 255 when missing on object input; throws on everything else.
- **`isColorObject` / `isHexColor`** positive and negative cases.

### Schema-level tests

Extend or sit alongside the existing `packages/test/src/test/schema/imageTextTaskInputSchema.test.ts`:

- `ColorValueSchema()` validates both `"#ff0000"` and `{r:255,g:0,b:0,a:255}` against the `oneOf`.
- `ColorValueSchema()` rejects `"ff0000"` (no `#`), `{r: 256, ...}`, and non-color shapes.
- Existing `ColorSchema()` still validates object form (regression guard).

### End-to-end

One integration test per migrated task: run the task twice with identical expected pixel output — once with `color: "#ff0000"`, once with `color: {r:255, g:0, b:0, a:255}`. This is the test that proves `ColorValueSchema` + `resolveColor` close the loop through a real task.

### Running

Per `CLAUDE.md`:

```sh
bun scripts/test.ts util vitest     # color.ts unit tests
bun scripts/test.ts tasks vitest    # schema + integration tests
```

## Risks & non-risks

**Non-risks:**
- AutoConnect breakage — format matching is already lenient on schema shape; adding a `oneOf` branch doesn't affect it.
- Object-form consumer regression — `resolveColor()` on a valid `ColorObject` is effectively `{...value, a: value.a ?? 255}`, preserving all current behavior.

**Risks:**
- Schema validators in the codebase that don't understand `oneOf`. If any call site validates color inputs with something other than the central schema library, they'll fail on the new union form. Mitigation: spec leaves `ColorSchema()` (object-only) available — individual tasks opt in to `ColorValueSchema()` one at a time.
- Regex mismatch with JSON Schema pattern semantics. `^…$` anchors are standard in JSON Schema regex; no multiline concerns for single-value fields.

## Open questions

None — all design decisions (hex-only strings, schema-level `oneOf`, interface + helpers, keep helpers in `ImageSchemas.ts`, no `produceColorOutput`, migrate all three existing tasks, name = `ColorValueSchema`) were resolved during brainstorming.
