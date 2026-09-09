/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/schema";

/**
 * Bounds on a JSON Schema that a language model wrote.
 *
 * A schema a model authored is model-controlled input, and the sibling guard
 * for the other half of that surface sits beside it: tool-call *arguments* go
 * through {@link sanitizeToolArgs} before validation. Arguments are bounded by
 * the schema; the schema itself is bounded by nothing, and it drives a
 * renderer.
 */
export interface ModelAuthoredSchemaLimits {
  /** Maximum properties on any one object. */
  readonly maxProperties: number;
  /** Maximum nesting depth below the root. */
  readonly maxDepth: number;
  /**
   * `format` values a model may ask for.
   *
   * This is the load-bearing one, and it is an allowlist for the same reason
   * the entitlement gate is: in this codebase a `format` annotation does not
   * merely style a field, it selects a runtime editor and resolves a live
   * resource — `"storage:tabular"`, `"knowledge-base"`, `"credential"`. An
   * unbounded `format` is therefore the model choosing a resource, and a
   * denylist would hand every format added later to whoever asks for it first.
   *
   * A frozen array rather than a `ReadonlySet`: a Set keeps its members in
   * internal slots, so `Object.freeze` does not reach them and the default
   * below could be widened at run time by anything holding a reference to it.
   * The list is short enough that a scan costs nothing.
   */
  readonly allowedFormats: readonly string[];
  /**
   * Prefixes a `format` may carry, for families whose tail is a free
   * parameter — `"model:EmbeddingTask"` names a task, not a resource to open.
   */
  readonly allowedFormatPrefixes: readonly string[];
}

/**
 * Formats safe to hand a model-authored form: presentation and picker hints
 * that resolve nothing on their own. Anything naming a stored resource is
 * absent, and absent means refused.
 */
export const DEFAULT_MODEL_AUTHORED_SCHEMA_LIMITS: ModelAuthoredSchemaLimits = Object.freeze({
  maxProperties: 20,
  maxDepth: 3,
  allowedFormats: Object.freeze([
    "date",
    "date-time",
    "time",
    "uri",
    "email",
    "textarea",
    "color",
    "model",
  ]),
  allowedFormatPrefixes: Object.freeze(["model:"]),
});

export type ModelAuthoredSchemaResult =
  | { readonly ok: true; readonly schema: DataPortSchemaObject }
  | { readonly ok: false; readonly reason: string };

function formatAllowed(format: string, limits: ModelAuthoredSchemaLimits): boolean {
  if (limits.allowedFormats.includes(format)) return true;
  return limits.allowedFormatPrefixes.some((prefix) => format.startsWith(prefix));
}

/**
 * Hard ceiling on how deep the walk itself may recurse.
 *
 * `maxDepth` bounds the value tree, and branch keywords deliberately sit at
 * their parent's depth because they describe the same value — so a chain of
 * them (`{oneOf:[{oneOf:[…]}]}`) is bounded by nothing and overflows the stack.
 * This function is documented to hand a reason back rather than throw, and a
 * `RangeError` is neither a reason nor catchable by the model, so the walk
 * carries its own ceiling. It is far above anything a real form nests.
 */
const MAX_WALK_DEPTH = 64;

/** Keywords whose value is a list of subschemas describing a CHILD value. */
const CHILD_LIST_KEYWORDS = ["prefixItems"] as const;
/** Keywords whose value is a list of subschemas describing the SAME value. */
const SIBLING_LIST_KEYWORDS = ["allOf", "anyOf", "oneOf"] as const;
/** Keywords whose value is one subschema describing the SAME value. */
const SIBLING_KEYWORDS = ["not", "if", "then", "else"] as const;
/** Keywords whose value is one subschema describing a CHILD value. */
const CHILD_KEYWORDS = [
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contains",
  "propertyNames",
] as const;
/** Keywords whose value maps a name to a subschema of the SAME value. */
const SIBLING_MAP_KEYWORDS = ["dependentSchemas"] as const;
/** Keywords whose value maps a name to a subschema of a CHILD value. */
const CHILD_MAP_KEYWORDS = ["patternProperties"] as const;

/**
 * Keywords that move the schema somewhere this walk cannot follow.
 *
 * A `$ref` is resolved by the renderer, not here, so a definition the walk
 * never visits still selects a runtime editor — the same hole the branch
 * keywords opened, one indirection further. Refusing is the allowlist
 * direction: a model asked to describe a form has no use for references.
 */
const UNFOLLOWABLE_KEYWORDS = ["$ref", "$dynamicRef", "$defs", "definitions"] as const;

interface Walk {
  readonly path: string;
  /** Depth in the VALUE tree, bounded by `limits.maxDepth`. */
  readonly depth: number;
  /** Depth of this walk's own recursion, bounded by {@link MAX_WALK_DEPTH}. */
  readonly walkDepth: number;
}

function check(node: unknown, walk: Walk, limits: ModelAuthoredSchemaLimits): string | undefined {
  const { path, depth } = walk;
  if (walk.walkDepth > MAX_WALK_DEPTH) {
    return `schema at ${path || "root"} nests too many keywords to check`;
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return `${path || "schema"} must be an object schema`;
  }
  const schema = node as Record<string, unknown>;
  if (depth > limits.maxDepth) return `nesting depth at ${path} exceeds ${limits.maxDepth}`;
  for (const keyword of UNFOLLOWABLE_KEYWORDS) {
    if (schema[keyword] !== undefined) {
      return `"${keyword}" at ${path || "root"} is not allowed in a model-authored schema`;
    }
  }
  if (typeof schema.format === "string" && !formatAllowed(schema.format, limits)) {
    return `format "${schema.format}" at ${path || "root"} is not allowed in a model-authored schema`;
  }
  if (schema.type === "object" || schema.properties) {
    const properties = schema.properties;
    if (properties !== undefined) {
      if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
        return `properties at ${path || "root"} must be an object`;
      }
      const keys = Object.keys(properties as Record<string, unknown>);
      if (keys.length > limits.maxProperties) {
        return `too many properties at ${path || "root"} (max ${limits.maxProperties})`;
      }
      for (const key of keys) {
        const error = check(
          (properties as Record<string, unknown>)[key],
          child(walk, path ? `${path}.${key}` : key),
          limits
        );
        if (error) return error;
      }
    }
  }
  if (schema.items !== undefined) {
    const error = check(schema.items, child(walk, `${path}[]`), limits);
    if (error) return error;
  }
  return checkComposition(schema, walk, limits);
}

/** A subschema describing a child value: one step down the value tree. */
function child(walk: Walk, path: string): Walk {
  return { path, depth: walk.depth + 1, walkDepth: walk.walkDepth + 1 };
}

/** A subschema describing the same value: deeper in the walk, not in the tree. */
function sibling(walk: Walk, path: string): Walk {
  return { path, depth: walk.depth, walkDepth: walk.walkDepth + 1 };
}

/**
 * Walks the keywords a subschema can hide under.
 *
 * Checking only `properties` and `items` leaves the format allowlist — the
 * load-bearing half of this guard — trivially bypassable: a form renderer that
 * understands `oneOf`, `prefixItems` or `patternProperties` resolves the
 * `format` on the branch it picks, so a field the guard never looked at still
 * selects a runtime editor. Every keyword that can carry a subschema is walked
 * for that reason, and the ones this walk cannot follow at all are refused in
 * {@link check}. Sibling keywords sit at the node's own depth because they
 * describe the same value; the rest describe a child and count as one.
 */
function checkComposition(
  schema: Record<string, unknown>,
  walk: Walk,
  limits: ModelAuthoredSchemaLimits
): string | undefined {
  const here = walk.path || "root";
  const lists = [
    { keywords: SIBLING_LIST_KEYWORDS, step: sibling },
    { keywords: CHILD_LIST_KEYWORDS, step: child },
  ] as const;
  for (const { keywords, step } of lists) {
    for (const keyword of keywords) {
      const branches = schema[keyword];
      if (branches === undefined) continue;
      if (!Array.isArray(branches)) return `${keyword} at ${here} must be an array`;
      for (let index = 0; index < branches.length; index++) {
        // A boolean subschema carries no `format` and no children.
        if (typeof branches[index] === "boolean") continue;
        const error = check(
          branches[index],
          step(walk, `${walk.path}.${keyword}[${index}]`),
          limits
        );
        if (error) return error;
      }
    }
  }

  const singles = [
    { keywords: SIBLING_KEYWORDS, step: sibling },
    { keywords: CHILD_KEYWORDS, step: child },
  ] as const;
  for (const { keywords, step } of singles) {
    for (const keyword of keywords) {
      const branch = schema[keyword];
      // `additionalProperties: true | false` says nothing about a subschema.
      if (branch === undefined || typeof branch === "boolean") continue;
      const error = check(branch, step(walk, `${walk.path}.${keyword}`), limits);
      if (error) return error;
    }
  }

  const maps = [
    { keywords: SIBLING_MAP_KEYWORDS, step: sibling },
    { keywords: CHILD_MAP_KEYWORDS, step: child },
  ] as const;
  for (const { keywords, step } of maps) {
    for (const keyword of keywords) {
      const entries = schema[keyword];
      if (entries === undefined) continue;
      if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
        return `${keyword} at ${here} must be an object`;
      }
      for (const [name, value] of Object.entries(entries as Record<string, unknown>)) {
        if (typeof value === "boolean") continue;
        const error = check(value, step(walk, `${walk.path}.${keyword}.${name}`), limits);
        if (error) return error;
      }
    }
  }
  return undefined;
}

/**
 * Validates a model-authored JSON Schema before it reaches a form renderer.
 *
 * Returns the reason rather than throwing, because the caller's next move is
 * usually to hand that reason back to the model so it can fix the schema —
 * a rejection it can act on beats an exception it cannot see.
 */
export function validateModelAuthoredSchema(
  schema: unknown,
  limits: ModelAuthoredSchemaLimits = DEFAULT_MODEL_AUTHORED_SCHEMA_LIMITS
): ModelAuthoredSchemaResult {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { ok: false, reason: "schema must be a JSON Schema object" };
  }
  const root = schema as Record<string, unknown>;
  if (root.type !== "object" || !root.properties) {
    return { ok: false, reason: 'schema root must have type "object" and "properties"' };
  }
  const error = check(schema, { path: "", depth: 0, walkDepth: 0 }, limits);
  if (error) return { ok: false, reason: error };
  return { ok: true, schema: schema as DataPortSchemaObject };
}
