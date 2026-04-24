# Color format serialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `format: "color"` accept either a `{r,g,b,a}` object or a `#RRGGBB[AA]`/`#RGB[A]` hex string on the wire, mirroring how `format: "image"` accepts either an `ImageBinary` object or a data-URI string.

**Architecture:** Add a pure-TS `ColorObject` interface plus `parseHexColor`, `toHexColor`, `resolveColor`, `isColorObject`, `isHexColor` helpers in `packages/util/src/media/color.ts`, exported via the `@workglow/util/media` sub-path. Extend `packages/tasks/src/task/image/ImageSchemas.ts` with `HexColorSchema()` and a `ColorValueSchema()` `oneOf` union, plus a `ColorFromSchemaOptions` parallel to `ImageBinarySchemaOptions`. Migrate the three color-consuming tasks (`ImageTintTask`, `ImageTextTask`, `ImageBorderTask`) to use `ColorValueSchema()` and call `resolveColor()` at the top of `execute`/`executeReactive`. AutoConnect needs no changes — it already descends into `oneOf` via `getSpecificTypeIdentifiers` (packages/task-graph/src/task-graph/autoConnect.ts:86-99).

**Tech Stack:** TypeScript, Bun workspaces, Turborepo, Vitest, JSON Schema (via `@workglow/util/schema`).

**Spec:** `docs/superpowers/specs/2026-04-24-color-format-serialization-design.md`

---

## File map

**Create:**
- `packages/util/src/media/color.ts` — `ColorObject`, parse/emit/resolve helpers, type guards.
- `packages/test/src/test/util/color.test.ts` — unit tests for color utilities.
- `packages/test/src/test/schema/colorValueSchema.test.ts` — schema-level validation tests for `ColorValueSchema`.
- `packages/test/src/test/task/ImageColorInput.test.ts` — end-to-end tests proving each migrated task accepts both wire forms.

**Modify:**
- `packages/util/src/media-browser.ts` — add `export * from "./media/color"`.
- `packages/util/src/media-node.ts` — add `export * from "./media/color"`.
- `packages/tasks/src/task/image/ImageSchemas.ts` — add `HexColorSchema`, `ColorValueSchema`, `ColorFromSchemaOptions`, `ColorFromSchema`.
- `packages/tasks/src/task/image/ImageTintTask.ts:15,22,71` — import `resolveColor`, switch to `ColorValueSchema`, call `resolveColor(input.color)` in `executeReactive`.
- `packages/tasks/src/task/image/ImageBorderTask.ts:15,29,70,78-81` — same migration pattern.
- `packages/tasks/src/task/image/ImageTextTask.ts:16,149,260,284` — same migration pattern; resolve once at top of `execute`, reuse the resolved object at all call sites.

No other files are expected to change. If the type checker points to unexpected call sites (e.g., because `input.color` narrowing changes), add a task to migrate them — don't widen the type to paper over it.

---

## Conventions applied

- **No backward-compat shims.** `ColorSchema()` (object-only) remains exported but the three migrated tasks stop using it. Per the user's memory (`feedback_no_backward_compat`), we don't keep a legacy wrapper.
- **License header** on every new source file (`@license Copyright 2025 Steven Roussey … SPDX-License-Identifier: Apache-2.0`).
- **No default exports, no enums, interfaces extend interfaces, `readonly` by default.** Per `.claude/CLAUDE.md`.
- **`import type`** for type-only imports.
- **TDD:** tests go in before implementation for every behavioral change. Commit after each green task.
- **Test runner:** Use `bun scripts/test.ts <section> vitest` scoped to the section you changed (CLAUDE.md: "tests are very slow" if unscoped). `util` for color utilities, `task` for task migrations. The schema test file lives in `packages/test/src/test/schema/` — that directory is not mapped in `SECTION_DIRS` but the file is picked up by `bun run test:vitest` (vitest matches `**/*.test.ts`); run it directly with `bunx vitest run packages/test/src/test/schema/colorValueSchema.test.ts`.

---

## Task 1: `ColorObject` interface + `parseHexColor`

**Files:**
- Create: `packages/util/src/media/color.ts`
- Create: `packages/test/src/test/util/color.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/test/src/test/util/color.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { parseHexColor } from "@workglow/util/media";

describe("parseHexColor", () => {
  it("parses #RRGGBB", () => {
    expect(parseHexColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseHexColor("#00FF00")).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    expect(parseHexColor("#0000ff")).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  });

  it("parses #RRGGBBAA with alpha", () => {
    expect(parseHexColor("#ff000080")).toEqual({ r: 255, g: 0, b: 0, a: 128 });
    expect(parseHexColor("#00000000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseHexColor("#ffffffff")).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it("expands #RGB shorthand by doubling each nibble", () => {
    expect(parseHexColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseHexColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 255 });
  });

  it("expands #RGBA shorthand", () => {
    expect(parseHexColor("#f008")).toEqual({ r: 255, g: 0, b: 0, a: 0x88 });
    expect(parseHexColor("#0000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("is case-insensitive on input", () => {
    expect(parseHexColor("#AbCdEf")).toEqual(parseHexColor("#abcdef"));
    expect(parseHexColor("#AbCdEf12")).toEqual(parseHexColor("#abcdef12"));
  });

  it("throws on missing leading #", () => {
    expect(() => parseHexColor("ff0000")).toThrow();
  });

  it("throws on non-hex characters", () => {
    expect(() => parseHexColor("#gg0000")).toThrow();
    expect(() => parseHexColor("#ff00zz")).toThrow();
  });

  it("throws on invalid lengths", () => {
    expect(() => parseHexColor("#")).toThrow();
    expect(() => parseHexColor("#f")).toThrow();
    expect(() => parseHexColor("#ff")).toThrow();
    expect(() => parseHexColor("#fffff")).toThrow();
    expect(() => parseHexColor("#fffffff")).toThrow();
    expect(() => parseHexColor("#fffffffff")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => parseHexColor("")).toThrow();
  });

  it("throws on whitespace-padded input (no trim)", () => {
    expect(() => parseHexColor(" #ff0000")).toThrow();
    expect(() => parseHexColor("#ff0000 ")).toThrow();
  });

  it("throws on non-string input", () => {
    expect(() => parseHexColor(null as unknown as string)).toThrow();
    expect(() => parseHexColor(undefined as unknown as string)).toThrow();
    expect(() => parseHexColor(123 as unknown as string)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run packages/test/src/test/util/color.test.ts`
Expected: FAIL with "Cannot find module '@workglow/util/media'" export of `parseHexColor`, or equivalent "`parseHexColor` is not exported" error.

- [ ] **Step 3: Create `packages/util/src/media/color.ts` with `ColorObject` + `parseHexColor`**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ColorObject {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX_PATTERN = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Parse a `#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA` hex color into a {@link ColorObject}.
 * Case-insensitive on input. No whitespace tolerance. Shorthand nibbles are doubled.
 * Throws on any malformed input.
 */
export function parseHexColor(hex: string): ColorObject {
  if (typeof hex !== "string" || !HEX_PATTERN.test(hex)) {
    throw new Error(`Invalid hex color: ${String(hex)}`);
  }
  const body = hex.slice(1);
  const double = (nibble: string): number => parseInt(nibble + nibble, 16);
  if (body.length === 3) {
    return { r: double(body[0]!), g: double(body[1]!), b: double(body[2]!), a: 255 };
  }
  if (body.length === 4) {
    return {
      r: double(body[0]!),
      g: double(body[1]!),
      b: double(body[2]!),
      a: double(body[3]!),
    };
  }
  if (body.length === 6) {
    return {
      r: parseInt(body.slice(0, 2), 16),
      g: parseInt(body.slice(2, 4), 16),
      b: parseInt(body.slice(4, 6), 16),
      a: 255,
    };
  }
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
    a: parseInt(body.slice(6, 8), 16),
  };
}
```

- [ ] **Step 4: Wire the new file into `@workglow/util/media` sub-exports**

Edit `packages/util/src/media-node.ts` — append after the last `export * from`:

```ts
export * from "./media/color";
```

Edit `packages/util/src/media-browser.ts` — append after the last `export * from`:

```ts
export * from "./media/color";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bunx vitest run packages/test/src/test/util/color.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/util/src/media/color.ts \
        packages/util/src/media-node.ts \
        packages/util/src/media-browser.ts \
        packages/test/src/test/util/color.test.ts
git commit -m "feat(util): add ColorObject + parseHexColor hex color parser"
```

---

## Task 2: `toHexColor` emitter

**Files:**
- Modify: `packages/util/src/media/color.ts`
- Modify: `packages/test/src/test/util/color.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `packages/test/src/test/util/color.test.ts` (inside the existing top-level `describe` or as a new sibling `describe`):

```ts
import { toHexColor } from "@workglow/util/media";

describe("toHexColor", () => {
  it("emits #RRGGBB when alpha is 255", () => {
    expect(toHexColor({ r: 255, g: 0, b: 0, a: 255 })).toBe("#ff0000");
    expect(toHexColor({ r: 0, g: 255, b: 0, a: 255 })).toBe("#00ff00");
    expect(toHexColor({ r: 0, g: 0, b: 255, a: 255 })).toBe("#0000ff");
  });

  it("emits #RRGGBBAA when alpha < 255", () => {
    expect(toHexColor({ r: 255, g: 0, b: 0, a: 128 })).toBe("#ff000080");
    expect(toHexColor({ r: 0, g: 0, b: 0, a: 0 })).toBe("#00000000");
    expect(toHexColor({ r: 170, g: 187, b: 204, a: 136 })).toBe("#aabbcc88");
  });

  it("emits lowercase only", () => {
    expect(toHexColor({ r: 0xab, g: 0xcd, b: 0xef, a: 255 })).toBe("#abcdef");
  });

  it("never emits 3/4-digit shorthand", () => {
    expect(toHexColor({ r: 255, g: 0, b: 0, a: 255 })).toBe("#ff0000");
    expect(toHexColor({ r: 255, g: 0, b: 0, a: 0 })).toBe("#ff000000");
  });

  it("round-trips 6-digit and 8-digit hex", () => {
    for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#123456", "#abcdef12", "#00000080"]) {
      expect(toHexColor(parseHexColor(hex))).toBe(hex);
    }
  });

  it("expands 3/4-digit shorthand to long lowercase form after round trip", () => {
    expect(toHexColor(parseHexColor("#f00"))).toBe("#ff0000");
    expect(toHexColor(parseHexColor("#ABC"))).toBe("#aabbcc");
    expect(toHexColor(parseHexColor("#f008"))).toBe("#ff000088");
  });

  it("throws on non-integer channels", () => {
    expect(() => toHexColor({ r: 1.5, g: 0, b: 0, a: 255 })).toThrow();
    expect(() => toHexColor({ r: 0, g: NaN, b: 0, a: 255 })).toThrow();
  });

  it("throws on out-of-range channels", () => {
    expect(() => toHexColor({ r: -1, g: 0, b: 0, a: 255 })).toThrow();
    expect(() => toHexColor({ r: 256, g: 0, b: 0, a: 255 })).toThrow();
    expect(() => toHexColor({ r: 0, g: 0, b: 0, a: 300 })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run packages/test/src/test/util/color.test.ts`
Expected: FAIL — "`toHexColor` is not exported".

- [ ] **Step 3: Add `toHexColor` to `packages/util/src/media/color.ts`**

Append after `parseHexColor`:

```ts
const CHANNEL_MIN = 0;
const CHANNEL_MAX = 255;

function assertChannel(name: string, value: number): void {
  if (!Number.isInteger(value) || value < CHANNEL_MIN || value > CHANNEL_MAX) {
    throw new Error(`Color channel ${name} out of range (0-255 integer): ${value}`);
  }
}

function byteToHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/**
 * Emit a {@link ColorObject} as `#RRGGBB` when `a === 255`, otherwise `#RRGGBBAA`.
 * Always lowercase, never shorthand. Throws on non-integer or out-of-range channels.
 */
export function toHexColor(c: ColorObject): string {
  assertChannel("r", c.r);
  assertChannel("g", c.g);
  assertChannel("b", c.b);
  assertChannel("a", c.a);
  const head = `#${byteToHex(c.r)}${byteToHex(c.g)}${byteToHex(c.b)}`;
  return c.a === 255 ? head : `${head}${byteToHex(c.a)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run packages/test/src/test/util/color.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/util/src/media/color.ts packages/test/src/test/util/color.test.ts
git commit -m "feat(util): add toHexColor emitter"
```

---

## Task 3: `resolveColor`, `isColorObject`, `isHexColor`

**Files:**
- Modify: `packages/util/src/media/color.ts`
- Modify: `packages/test/src/test/util/color.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `packages/test/src/test/util/color.test.ts`:

```ts
import { resolveColor, isColorObject, isHexColor } from "@workglow/util/media";

describe("resolveColor", () => {
  it("normalizes a full ColorObject", () => {
    expect(resolveColor({ r: 1, g: 2, b: 3, a: 4 })).toEqual({ r: 1, g: 2, b: 3, a: 4 });
  });

  it("defaults alpha to 255 when missing from object input", () => {
    const result = resolveColor({ r: 10, g: 20, b: 30 } as unknown as ColorObject);
    expect(result).toEqual({ r: 10, g: 20, b: 30, a: 255 });
  });

  it("parses a hex string input", () => {
    expect(resolveColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(resolveColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 255 });
    expect(resolveColor("#00000080")).toEqual({ r: 0, g: 0, b: 0, a: 128 });
  });

  it("throws on invalid hex", () => {
    expect(() => resolveColor("ff0000")).toThrow();
    expect(() => resolveColor("#zzzzzz")).toThrow();
  });

  it("throws on out-of-range object channels", () => {
    expect(() => resolveColor({ r: 300, g: 0, b: 0, a: 255 })).toThrow();
    expect(() => resolveColor({ r: -1, g: 0, b: 0, a: 255 })).toThrow();
  });

  it("throws on non-object non-string input", () => {
    expect(() => resolveColor(null as unknown as ColorObject)).toThrow();
    expect(() => resolveColor(undefined as unknown as ColorObject)).toThrow();
    expect(() => resolveColor(123 as unknown as ColorObject)).toThrow();
    expect(() => resolveColor({ foo: "bar" } as unknown as ColorObject)).toThrow();
  });
});

describe("isColorObject", () => {
  it("returns true for a valid full RGBA object", () => {
    expect(isColorObject({ r: 1, g: 2, b: 3, a: 4 })).toBe(true);
  });

  it("returns true when alpha is omitted", () => {
    expect(isColorObject({ r: 1, g: 2, b: 3 })).toBe(true);
  });

  it("returns false when any channel is out of range or non-integer", () => {
    expect(isColorObject({ r: -1, g: 0, b: 0 })).toBe(false);
    expect(isColorObject({ r: 256, g: 0, b: 0 })).toBe(false);
    expect(isColorObject({ r: 1.5, g: 0, b: 0 })).toBe(false);
    expect(isColorObject({ r: 0, g: 0, b: 0, a: 300 })).toBe(false);
  });

  it("returns false for non-objects, nulls, strings, arrays", () => {
    expect(isColorObject(null)).toBe(false);
    expect(isColorObject(undefined)).toBe(false);
    expect(isColorObject("#ff0000")).toBe(false);
    expect(isColorObject([1, 2, 3])).toBe(false);
    expect(isColorObject(123)).toBe(false);
  });
});

describe("isHexColor", () => {
  it("returns true for valid hex forms", () => {
    for (const x of ["#f00", "#f008", "#ff0000", "#ff000080", "#ABCDEF"]) {
      expect(isHexColor(x)).toBe(true);
    }
  });

  it("returns false for invalid inputs", () => {
    for (const x of ["ff0000", "#gg0000", "#", "#f", "#fffff", "#fffffff", "", 123, null]) {
      expect(isHexColor(x)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run packages/test/src/test/util/color.test.ts`
Expected: FAIL — `resolveColor`, `isColorObject`, `isHexColor` not exported.

- [ ] **Step 3: Add the three helpers to `packages/util/src/media/color.ts`**

Append after `toHexColor`:

```ts
function isInRangeByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}

/**
 * Type guard for a {@link ColorObject}-shaped value (alpha optional).
 * Does not reject extra properties — JSON Schema validation handles that separately.
 */
export function isColorObject(value: unknown): value is ColorObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!isInRangeByte(candidate.r)) return false;
  if (!isInRangeByte(candidate.g)) return false;
  if (!isInRangeByte(candidate.b)) return false;
  if (candidate.a !== undefined && !isInRangeByte(candidate.a)) return false;
  return true;
}

/** Type guard for a hex color string (same regex as `parseHexColor`). */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_PATTERN.test(value);
}

/**
 * Normalize either wire form to a full {@link ColorObject}. Object inputs default
 * `a` to 255. Throws on anything that's neither a valid hex string nor a valid
 * color object.
 */
export function resolveColor(value: string | ColorObject): ColorObject {
  if (typeof value === "string") return parseHexColor(value);
  if (!isColorObject(value)) {
    throw new Error(`Invalid color value: ${JSON.stringify(value)}`);
  }
  return {
    r: value.r,
    g: value.g,
    b: value.b,
    a: value.a ?? 255,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run packages/test/src/test/util/color.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/util/src/media/color.ts packages/test/src/test/util/color.test.ts
git commit -m "feat(util): add resolveColor + isColorObject/isHexColor guards"
```

---

## Task 4: Schema helpers (`HexColorSchema`, `ColorValueSchema`, `ColorFromSchema`)

**Files:**
- Modify: `packages/tasks/src/task/image/ImageSchemas.ts`
- Create: `packages/test/src/test/schema/colorValueSchema.test.ts`

- [ ] **Step 1: Write the failing schema tests**

Create `packages/test/src/test/schema/colorValueSchema.test.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ColorSchema, ColorValueSchema, HexColorSchema } from "@workglow/tasks";
import { compileSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

function validate(schema: ReturnType<typeof ColorValueSchema>, value: unknown) {
  return compileSchema(schema).validate(value);
}

describe("HexColorSchema", () => {
  const schema = HexColorSchema();

  it("accepts 3/4/6/8-digit hex strings", () => {
    for (const x of ["#f00", "#f008", "#ff0000", "#ff000080", "#AbCdEf"]) {
      expect(compileSchema(schema).validate(x).valid).toBe(true);
    }
  });

  it("rejects strings without leading #", () => {
    expect(compileSchema(schema).validate("ff0000").valid).toBe(false);
  });

  it("rejects non-hex characters and wrong lengths", () => {
    for (const x of ["#gg0000", "#fffff", "#fffffff", "#"]) {
      expect(compileSchema(schema).validate(x).valid).toBe(false);
    }
  });

  it("carries format: color", () => {
    expect(schema.format).toBe("color");
  });
});

describe("ColorValueSchema", () => {
  const schema = ColorValueSchema();

  it("accepts a valid RGBA object", () => {
    expect(validate(schema, { r: 255, g: 0, b: 0, a: 255 }).valid).toBe(true);
  });

  it("accepts an object with omitted alpha", () => {
    expect(validate(schema, { r: 0, g: 0, b: 0 }).valid).toBe(true);
  });

  it("accepts a hex string", () => {
    expect(validate(schema, "#ff0000").valid).toBe(true);
    expect(validate(schema, "#f00").valid).toBe(true);
    expect(validate(schema, "#ff000080").valid).toBe(true);
  });

  it("rejects a hex string without leading #", () => {
    expect(validate(schema, "ff0000").valid).toBe(false);
  });

  it("rejects an out-of-range object channel", () => {
    expect(validate(schema, { r: 256, g: 0, b: 0 }).valid).toBe(false);
  });

  it("rejects arbitrary other shapes", () => {
    expect(validate(schema, 42).valid).toBe(false);
    expect(validate(schema, null).valid).toBe(false);
    expect(validate(schema, { foo: "bar" }).valid).toBe(false);
  });
});

describe("ColorSchema (regression)", () => {
  it("still validates object-only color inputs", () => {
    expect(compileSchema(ColorSchema()).validate({ r: 1, g: 2, b: 3, a: 4 }).valid).toBe(true);
    expect(compileSchema(ColorSchema()).validate("#ff0000").valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run packages/test/src/test/schema/colorValueSchema.test.ts`
Expected: FAIL — `ColorValueSchema` and `HexColorSchema` are not exported from `@workglow/tasks`.

- [ ] **Step 3: Extend `packages/tasks/src/task/image/ImageSchemas.ts`**

Top of the file — update the imports to pull in `ColorObject` alongside the existing `ImageBinary`:

```ts
import type { ColorObject, ImageBinary } from "@workglow/util/media";
```

Below the existing `ColorSchema` definition (at the end of the file), append:

```ts
export const HexColorSchema = (annotations: Record<string, unknown> = {}) =>
  ({
    type: "string",
    format: "color",
    pattern: "^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$",
    title: "Color (hex)",
    description: "Color as a `#RRGGBB[AA]` or `#RGB[A]` hex string",
    ...annotations,
  }) as const;

/** Accept a {@link ColorObject} or a `#RRGGBB[AA]`/`#RGB[A]` hex string. */
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

(The existing imports of `FromSchema`, `FromSchemaDefaultOptions`, `FromSchemaOptions` and `JsonSchema` at the top of the file already cover this new code — do not add duplicate imports.)

- [ ] **Step 4: Run the schema tests to verify they pass**

Run: `bunx vitest run packages/test/src/test/schema/colorValueSchema.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Run the existing image schema tests to check for regressions**

Run: `bunx vitest run packages/test/src/test/schema/imageTextTaskInputSchema.test.ts`
Expected: all existing tests still pass (this task changed only imports, not existing `ColorSchema` behavior).

- [ ] **Step 6: Commit**

```bash
git add packages/tasks/src/task/image/ImageSchemas.ts \
        packages/test/src/test/schema/colorValueSchema.test.ts
git commit -m "feat(tasks): add HexColorSchema + ColorValueSchema oneOf union"
```

---

## Task 5: Migrate `ImageTintTask` to `ColorValueSchema`

**Files:**
- Modify: `packages/tasks/src/task/image/ImageTintTask.ts:15,22,71`
- Create/modify: end-to-end test for this task arrives in Task 8; this task is a typed migration only.

- [ ] **Step 1: Update the import line (packages/tasks/src/task/image/ImageTintTask.ts:15)**

Replace:

```ts
import { ColorSchema, ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
```

With:

```ts
import { ColorValueSchema, ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
import { resolveColor } from "@workglow/util/media";
```

- [ ] **Step 2: Switch the color port to `ColorValueSchema` (line 22)**

Replace:

```ts
    color: ColorSchema({ title: "Color", description: "Tint color" }),
```

With:

```ts
    color: ColorValueSchema({ title: "Color", description: "Tint color" }),
```

- [ ] **Step 3: Normalize `input.color` inside `executeReactive` (line 71)**

Replace:

```ts
    const { r: tr, g: tg, b: tb } = input.color;
```

With:

```ts
    const { r: tr, g: tg, b: tb } = resolveColor(input.color);
```

- [ ] **Step 4: Typecheck**

Run: `bun run build:types`
Expected: no errors. (If the union type surfaces as an issue elsewhere in the file, `resolveColor` returns a narrowed `ColorObject` so downstream usage of `tr`/`tg`/`tb` should be unchanged.)

- [ ] **Step 5: Run the task-level tests to confirm no regression**

Run: `bun scripts/test.ts task vitest`
Expected: all existing task tests pass; nothing has changed behaviorally for callers who still pass object-form color.

- [ ] **Step 6: Commit**

```bash
git add packages/tasks/src/task/image/ImageTintTask.ts
git commit -m "refactor(tasks): migrate ImageTintTask to ColorValueSchema + resolveColor"
```

---

## Task 6: Migrate `ImageBorderTask` to `ColorValueSchema`

**Files:**
- Modify: `packages/tasks/src/task/image/ImageBorderTask.ts:15,29,70-81`

- [ ] **Step 1: Update the import line (line 15)**

Replace:

```ts
import { ColorSchema, ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
```

With:

```ts
import { ColorValueSchema, ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
import { resolveColor } from "@workglow/util/media";
```

- [ ] **Step 2: Switch the color port to `ColorValueSchema` (line 29)**

Replace:

```ts
    color: ColorSchema({ title: "Color", description: "Border color" }),
```

With:

```ts
    color: ColorValueSchema({ title: "Color", description: "Border color" }),
```

- [ ] **Step 3: Resolve `input.color` at the top of `execute`/`executeReactive` (lines 70-81)**

The current body starts:

```ts
    const { borderWidth: bw = 1, color } = input;
    // ...
      const r = color.r;
      const g = color.g;
      const b = color.b;
      const a = color.a ?? 255;
```

Replace the destructuring line and the four channel-extraction lines so `color` is the resolved object and `a` no longer needs a fallback:

```ts
    const { borderWidth: bw = 1 } = input;
    const color = resolveColor(input.color);
    // ...
      const r = color.r;
      const g = color.g;
      const b = color.b;
      const a = color.a;
```

(Leave the rest of the function body unchanged. The `a ?? 255` fallback becomes unnecessary because `resolveColor` fills `a` with 255 when the object input omits it.)

- [ ] **Step 4: Typecheck**

Run: `bun run build:types`
Expected: no errors.

- [ ] **Step 5: Run the task-level tests to confirm no regression**

Run: `bun scripts/test.ts task vitest`
Expected: all existing task tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/tasks/src/task/image/ImageBorderTask.ts
git commit -m "refactor(tasks): migrate ImageBorderTask to ColorValueSchema + resolveColor"
```

---

## Task 7: Migrate `ImageTextTask` to `ColorValueSchema`

**Files:**
- Modify: `packages/tasks/src/task/image/ImageTextTask.ts:16,149,260,284`

- [ ] **Step 1: Update the import line (line 16)**

Replace:

```ts
import { ColorSchema, ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
```

With:

```ts
import { ColorValueSchema, ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
import { resolveColor } from "@workglow/util/media";
```

- [ ] **Step 2: Switch the color port to `ColorValueSchema` (line 149)**

Replace:

```ts
    color: ColorSchema({ title: "Color", description: "Text color" }),
```

With:

```ts
    color: ColorValueSchema({ title: "Color", description: "Text color" }),
```

- [ ] **Step 3: Resolve `input.color` once at the top of `execute` and reuse at both call sites (lines ~260 and ~284)**

Find the single method that contains both uses of `input.color` (likely `execute`). At the very top of that method body, add:

```ts
    const color = resolveColor(input.color);
```

Then replace both occurrences of `color: input.color,` with `color,` (object shorthand referencing the local). Concretely:

Before (around line 260):
```ts
          color: input.color,
```
After:
```ts
          color,
```

Before (around line 284):
```ts
        color: input.color,
```
After:
```ts
        color,
```

If the two usages are in different methods, repeat `const color = resolveColor(input.color);` at the top of each method and use `color,` in that scope. Do NOT resolve in module scope — `input.color` isn't available there.

- [ ] **Step 4: Typecheck**

Run: `bun run build:types`
Expected: no errors.

- [ ] **Step 5: Run the task-level tests + existing `imageTextTaskInputSchema` tests**

Run: `bun scripts/test.ts task vitest`
Run: `bunx vitest run packages/test/src/test/schema/imageTextTaskInputSchema.test.ts`
Expected: all existing tests pass. The in-file schema test (`imageTextTaskInputSchema.test.ts`) exercises `ImageTextTask.inputSchema()` and should continue to accept its existing object-form `{r,g,b}` color fixture via the new `oneOf`.

- [ ] **Step 6: Commit**

```bash
git add packages/tasks/src/task/image/ImageTextTask.ts
git commit -m "refactor(tasks): migrate ImageTextTask to ColorValueSchema + resolveColor"
```

---

## Task 8: End-to-end tests — migrated tasks accept both wire forms

**Files:**
- Create: `packages/test/src/test/task/ImageColorInput.test.ts`

- [ ] **Step 1: Write the failing end-to-end tests**

Create `packages/test/src/test/task/ImageColorInput.test.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ImageBorderTask, ImageTextTask, ImageTintTask } from "@workglow/tasks";
import type { ImageBinary } from "@workglow/util/media";
import { describe, expect, it } from "vitest";

function makeImage(width: number, height: number): ImageBinary {
  const channels = 4 as const;
  const data = new Uint8ClampedArray(width * height * channels);
  // Opaque white everywhere.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return { data, width, height, channels };
}

function assertSameImage(a: ImageBinary, b: ImageBinary): void {
  expect(a.width).toBe(b.width);
  expect(a.height).toBe(b.height);
  expect(a.channels).toBe(b.channels);
  expect(Array.from(a.data)).toEqual(Array.from(b.data));
}

describe("ImageTintTask accepts both color wire forms", () => {
  it("produces identical pixels for hex and object color input", async () => {
    const image = makeImage(4, 4);
    const objTask = new ImageTintTask();
    const hexTask = new ImageTintTask();

    const fromObject = await objTask.run({
      image,
      color: { r: 255, g: 0, b: 0, a: 255 },
      amount: 0.5,
    });
    const fromHex = await hexTask.run({
      image,
      color: "#ff0000",
      amount: 0.5,
    });

    assertSameImage(fromObject.image as ImageBinary, fromHex.image as ImageBinary);
  });
});

describe("ImageBorderTask accepts both color wire forms", () => {
  it("produces identical pixels for hex and object color input", async () => {
    const image = makeImage(6, 6);
    const objTask = new ImageBorderTask();
    const hexTask = new ImageBorderTask();

    const fromObject = await objTask.run({
      image,
      color: { r: 0, g: 0, b: 0, a: 255 },
      borderWidth: 1,
    });
    const fromHex = await hexTask.run({
      image,
      color: "#000000",
      borderWidth: 1,
    });

    assertSameImage(fromObject.image as ImageBinary, fromHex.image as ImageBinary);
  });
});

describe("ImageTextTask accepts both color wire forms", () => {
  it("produces identical pixels for hex and object color input", async () => {
    const objTask = new ImageTextTask();
    const hexTask = new ImageTextTask();

    const fromObject = await objTask.run({
      text: "A",
      color: { r: 0, g: 0, b: 0, a: 255 },
      width: 32,
      height: 32,
    });
    const fromHex = await hexTask.run({
      text: "A",
      color: "#000000",
      width: 32,
      height: 32,
    });

    assertSameImage(fromObject.image as ImageBinary, fromHex.image as ImageBinary);
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `bunx vitest run packages/test/src/test/task/ImageColorInput.test.ts`
Expected: all tests pass. (If any fail, the migration left a code path that still accesses `input.color.r` directly instead of the resolved local — go back to that task's Step 3 and fix before continuing.)

- [ ] **Step 3: If any test fails, fix the offending task and re-run**

Diagnostic hint: search the task file for remaining `input.color` references — every one must be replaced with the local resolved variable.

```bash
grep -n "input\.color" packages/tasks/src/task/image/ImageTintTask.ts \
                        packages/tasks/src/task/image/ImageBorderTask.ts \
                        packages/tasks/src/task/image/ImageTextTask.ts
```

Expected: each file shows ONE line, and that line is the `resolveColor(input.color)` call introduced in Tasks 5/6/7. Any other match is a bug — fix it, re-run the test.

- [ ] **Step 4: Run the full `task` vitest scope as a regression sweep**

Run: `bun scripts/test.ts task vitest`
Expected: all task tests pass, including pre-existing `ImageTask.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/test/src/test/task/ImageColorInput.test.ts
git commit -m "test: verify migrated image tasks accept both color wire forms"
```

---

## Task 9: Final verification + cleanup

**Files:** none (verification-only).

- [ ] **Step 1: Full typecheck**

Run: `bun run build:types`
Expected: no errors across any package.

- [ ] **Step 2: Scoped vitest sweeps**

Run: `bun scripts/test.ts util vitest`
Run: `bun scripts/test.ts task vitest`
Run: `bunx vitest run packages/test/src/test/schema/`
Expected: all green.

- [ ] **Step 3: Lint + format**

Run: `bun run format`
Expected: clean exit; any auto-fixes applied.

- [ ] **Step 4: Confirm no stray `ColorSchema` imports remain in the migrated tasks**

Run:

```bash
grep -rn "ColorSchema\b" packages/tasks/src/ | grep -v "ImageSchemas.ts"
```

Expected: zero matches. (All three tasks now import `ColorValueSchema` instead. `ColorSchema` is only defined/re-exported from `ImageSchemas.ts`.)

- [ ] **Step 5: Confirm `resolveColor` is imported exactly in the three migrated tasks**

Run:

```bash
grep -rn "resolveColor" packages/tasks/src/
```

Expected: exactly three matches, one per migrated task file.

- [ ] **Step 6: If any format issues surfaced in Step 3, commit them**

```bash
git add -A
git commit -m "chore: format after color-format migration"
```

(If Step 3 produced no changes, skip this step.)

- [ ] **Step 7: Done — final status check**

Run: `git log --oneline -10`
Expected: the commits from Tasks 1–8 (plus optional Task 9 Step 6 format commit) are at the tip of the branch, in order.

---

## Task 10: Builder-side — make color editors activate + tolerate object-form values

**Repo:** `/workspaces/workglow/builder` (separate git repo, currently on branch `image-text-task-input`).

**Depends on:** Tasks 1-9 merged and the libs rebuilt — Task 10 imports `resolveColor` and `toHexColor` from `@workglow/util/media`, which don't exist until Task 3 ships and the libs `dist` is rebuilt.

**Context:** The builder has two parallel editor registries. Task-node ports go through `propertyEditorRegistry` → `ColorPropertyEditor`, whose `canHandle` has `if (baseType !== "string") return false;` — so it never matches `ColorSchema` (object) or `ColorValueSchema` (oneOf). Both color editors' components also do `String(value)` on the incoming value, which produces `"[object Object]"` for object-form defaults and silently falls back to black. Task 10 fixes both.

**Files:**
- Modify: `builder/packages/app/src/components/workflow/nodes/task-node/property-editors/ColorPropertyEditor.tsx:44,218-226`
- Modify: `builder/packages/app/src/components/shared/input-editors/ColorInputEditor.tsx:30-42,95-110` — may have an in-progress uncommitted edit dropping the `baseType` guard; preserve that if so.

**Pre-check:** The user's uncommitted edit to `ColorInputEditor.tsx` already removes the `baseType !== "string"` guard from `canHandle`. Inspect with `git -C /workspaces/workglow/builder diff packages/app/src/components/shared/input-editors/ColorInputEditor.tsx` before starting, and incorporate — don't clobber.

- [ ] **Step 1: Update `ColorPropertyEditor.canHandle` to match hex-string and `oneOf`-with-hex-branch**

In `builder/packages/app/src/components/workflow/nodes/task-node/property-editors/ColorPropertyEditor.tsx:218-226`, replace:

```ts
  canHandle: (schema: PropertySchema) => {
    const baseType = getBaseType(schema);
    if (baseType !== "string") return false;

    const schemaObject = isSchemaObject(schema) ? schema : undefined;
    const format = schemaObject?.format as string | undefined;

    return format === "color" ? 150 : false; // Higher priority than generic string
  },
```

With:

```ts
  canHandle: (schema: PropertySchema) => {
    const schemaObject = isSchemaObject(schema) ? schema : undefined;
    if (!schemaObject) return false;

    // Direct format: "color" at the top level (either string or object ColorSchema shape).
    if (schemaObject.format === "color") return 150;

    // oneOf wrappers (e.g. ColorValueSchema) — match if any branch declares a string with format: "color".
    // The picker emits hex strings, so requiring a string branch guarantees the emitted value is valid.
    const branches = Array.isArray(schemaObject.oneOf) ? schemaObject.oneOf : undefined;
    if (branches) {
      for (const branch of branches) {
        if (branch && typeof branch === "object" && !Array.isArray(branch)) {
          const b = branch as { type?: string; format?: string };
          if (b.type === "string" && b.format === "color") return 150;
        }
      }
    }

    return false;
  },
```

- [ ] **Step 2: Teach `ColorPropertyEditor`'s component to accept object-form `{r,g,b,a}` values**

In `ColorPropertyEditor.tsx` — replace line 44:

```ts
  const effectiveValue = currentValue !== undefined && currentValue !== null ? String(currentValue) : defaultValue || "";
```

With an object-aware coercion. Keep the logic inline (no new helpers; the conversion is small). At the top of the file, add the import:

```ts
import { resolveColor, toHexColor } from "@workglow/util/media";
```

Then replace the `effectiveValue` line with:

```ts
  const effectiveValue = (() => {
    if (currentValue === undefined || currentValue === null) return defaultValue || "";
    if (typeof currentValue === "string") return currentValue;
    if (typeof currentValue === "object") {
      try {
        return toHexColor(resolveColor(currentValue as { r: number; g: number; b: number; a?: number }));
      } catch {
        return defaultValue || "";
      }
    }
    return defaultValue || "";
  })();
```

(The `try/catch` guards against shapes that look object-like but fail `isColorObject`, e.g. a partially-hydrated value during load. Falling back to the default is preferable to crashing the panel.)

- [ ] **Step 3: Apply the same object-aware coercion to the shared `ColorInputEditor` component**

In `builder/packages/app/src/components/shared/input-editors/ColorInputEditor.tsx`, replace `normalizeColorValue` (lines 30-42):

```ts
function normalizeColorValue(colorValue: unknown): string {
  if (!colorValue) return "#000000";
  const strValue = String(colorValue);
  const parsed = parseColorString(strValue);
  if (parsed) {
    return rgbToHex(parsed);
  }
  if (/^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/.test(strValue)) {
    return strValue;
  }
  return "#000000";
}
```

With:

```ts
function normalizeColorValue(colorValue: unknown): string {
  if (colorValue === undefined || colorValue === null) return "#000000";
  if (typeof colorValue === "object") {
    try {
      return toHexColor(resolveColor(colorValue as { r: number; g: number; b: number; a?: number }));
    } catch {
      return "#000000";
    }
  }
  const strValue = String(colorValue);
  const parsed = parseColorString(strValue);
  if (parsed) {
    return rgbToHex(parsed);
  }
  if (/^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/.test(strValue)) {
    return strValue;
  }
  return "#000000";
}
```

And add to the imports at the top of the file:

```ts
import { resolveColor, toHexColor } from "@workglow/util/media";
```

- [ ] **Step 4: Confirm `ColorInputEditor.canHandle` already descends into `oneOf`, or extend it**

The user's uncommitted edit drops the `baseType` guard. After that edit, `canHandle` checks:

```ts
if (editorType === "color" || editorType === "colorpicker") return 150;
if (schema.format === "color") return 150;
return false;
```

This still misses `ColorValueSchema` (no outer format, just `oneOf`). Extend the same way as Step 1 — add a `oneOf` branch check:

```ts
  canHandle: (schema) => {
    const editorType = schema["x-ui-editor"]?.toLowerCase();
    if (editorType === "color" || editorType === "colorpicker") return 150;

    if (schema.format === "color") return 150;

    const branches = Array.isArray(schema.oneOf) ? schema.oneOf : undefined;
    if (branches) {
      for (const branch of branches) {
        if (branch && typeof branch === "object" && !Array.isArray(branch)) {
          const b = branch as { type?: string; format?: string };
          if (b.type === "string" && b.format === "color") return 150;
        }
      }
    }

    return false;
  },
```

- [ ] **Step 5: Typecheck the builder**

Run from the builder repo:

```bash
cd /workspaces/workglow/builder && bun run types
```

(This proxies to `bun run --filter @workglow/builder-app types` → `tsgo -b tsconfig.json --noEmit` inside `packages/app`.) Expected: no errors.

If `@workglow/util/media` doesn't resolve, confirm the libs were rebuilt first (the `dist` output from Task 9's `bun run build:types` is what the builder consumes via its workspace/npm link).

- [ ] **Step 6: Manual smoke test (required — builder is UI; type checks don't prove behavior)**

Start the builder dev server and open a workflow that contains an `ImageTintTask`, `ImageBorderTask`, or `ImageTextTask` node:

```bash
cd /workspaces/workglow/builder && bun run dev
```

Verify:
1. The `color` port shows a color picker trigger (not a generic object/string editor).
2. Clicking the trigger opens the color picker panel.
3. Picking a color commits a hex string and the node's runtime value updates.
4. Loading an existing workflow with object-form `{r,g,b,a}` defaults displays the correct color (not black) on the trigger swatch.

If any step fails, return to the earlier step — do not claim completion.

- [ ] **Step 7: Commit (in the builder repo)**

```bash
cd /workspaces/workglow/builder
git add packages/app/src/components/workflow/nodes/task-node/property-editors/ColorPropertyEditor.tsx \
        packages/app/src/components/shared/input-editors/ColorInputEditor.tsx
git commit -m "fix(color-editor): activate on ColorValueSchema and tolerate object-form values"
```

---

## Out-of-scope follow-ups (not part of this plan)

- A full builder-side color-picker component rewrite to natively read and write `{r,g,b,a}` objects (rather than always emitting hex strings). Not needed now that `ColorValueSchema` accepts hex strings too.
- Dataflow-layer automatic string↔object conversion for tasks that declare strict (non-`oneOf`) color schemas — explicitly rejected during brainstorming.
- Named CSS color strings (`"red"`) and functional `rgb()`/`hsl()` syntax — explicitly rejected.
- Audio format getting the same treatment (`format: "audio:*"` already has hints of this pattern but is out of scope here).
