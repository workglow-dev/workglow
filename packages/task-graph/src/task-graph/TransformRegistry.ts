/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createServiceToken,
  globalServiceRegistry,
  ServiceRegistry,
} from "@workglow/util";
import type { DataPortSchema, JsonSchema } from "@workglow/util/schema";

/**
 * Serializable representation of a single transform step on a dataflow edge.
 * `id` identifies the registered {@link TransformDef}; `params` carries the
 * step's configuration and must round-trip through JSON.
 */
export interface TransformStep {
  readonly id: string;
  readonly params?: Record<string, unknown>;
}

/**
 * Sentinel id used when a serialized transform references an unknown
 * transform. Loaded dataflows keep the original step but resolve to a
 * {@link BrokenTransform} at runtime so the failure is visible.
 */
export const BROKEN_TRANSFORM_ID = "__broken__";

/**
 * Definition of a pure, named, schema-typed transform that can be placed on a
 * dataflow edge. Implementations must be deterministic and side-effect free.
 */
export interface TransformDef<P = unknown> {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  /** Optional JSON Schema describing the shape of {@link params}. */
  readonly paramsSchema?: DataPortSchema;
  /**
   * Computes the output schema given the input schema and concrete params.
   * Operates at the port-property level, so both input and output are raw
   * JSON Schemas (not wrapped task-port DataPortSchemas).
   * Must agree with what {@link apply} actually produces at runtime.
   */
  inferOutputSchema(inputSchema: JsonSchema, params: P): JsonSchema;
  /** Applies the transform to a materialized value. */
  apply(value: unknown, params: P): unknown | Promise<unknown>;
  /**
   * Optional streaming support. When present, each chunk is transformed on the
   * fly (used by structural transforms such as pick/index). When absent the
   * runner buffers the stream and calls {@link apply} once on the finish event.
   */
  applyStream?(chunk: unknown, params: P): unknown;
  /**
   * Optional suggestion hint used by the builder to bridge nearly-compatible
   * ports. Returns a score in [0, 1] plus concrete params, or undefined when
   * the transform cannot bridge the given pair.
   */
  suggestFromSchemas?(
    source: JsonSchema,
    target: JsonSchema
  ):
    | {
        readonly score: number;
        readonly params: P;
      }
    | undefined;
}

// ========================================================================
// Registry storage
// ========================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const transformDefs = new Map<string, TransformDef<any>>();

/**
 * Registers a transform definition. Idempotent when the same object is
 * registered twice; throws when a different object tries to claim the same id.
 */
function registerTransform(def: TransformDef<unknown>): void {
  const existing = transformDefs.get(def.id);
  if (existing) {
    if (existing === def) return;
    throw new Error(
      `Transform id "${def.id}" is already registered. Unregister it first to replace.`
    );
  }
  if (def.id === BROKEN_TRANSFORM_ID) {
    throw new Error(`Transform id "${BROKEN_TRANSFORM_ID}" is reserved.`);
  }
  transformDefs.set(def.id, def);
}

function unregisterTransform(id: string): boolean {
  return transformDefs.delete(id);
}

/** Global transform registry. Mirrors the shape of {@link TaskRegistry}. */
export const TransformRegistry = {
  all: transformDefs,
  registerTransform,
  unregisterTransform,
};

// ========================================================================
// DI-based access
// ========================================================================

/** Service token mapping transform ids to their definitions. */
export const TRANSFORM_DEFS =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createServiceToken<Map<string, TransformDef<any>>>("transform.defs");

globalServiceRegistry.registerIfAbsent(
  TRANSFORM_DEFS,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (): Map<string, TransformDef<any>> => transformDefs,
  true
);

export function getGlobalTransformDefs(): Map<string, TransformDef<unknown>> {
  return globalServiceRegistry.get(TRANSFORM_DEFS) as Map<string, TransformDef<unknown>>;
}

export function getTransformDefs(
  registry?: ServiceRegistry
): Map<string, TransformDef<unknown>> {
  if (!registry) return transformDefs as Map<string, TransformDef<unknown>>;
  return (
    registry.has(TRANSFORM_DEFS)
      ? (registry.get(TRANSFORM_DEFS) as Map<string, TransformDef<unknown>>)
      : (transformDefs as Map<string, TransformDef<unknown>>)
  );
}

// ========================================================================
// BrokenTransform sentinel
// ========================================================================

/**
 * Sentinel definition produced when a serialized step references an unknown
 * transform id. Fails fast at runtime so the edge is visibly broken rather
 * than silently dropped.
 */
export const BrokenTransform: TransformDef<{ readonly originalId: string }> = {
  id: BROKEN_TRANSFORM_ID,
  title: "Unknown transform",
  category: "Internal",
  inferOutputSchema(inputSchema) {
    return inputSchema;
  },
  apply(_value, params) {
    throw new Error(`Unknown transform: ${params.originalId}`);
  },
};

/**
 * Resolves a transform step's id to a definition. Unknown ids produce a
 * {@link BrokenTransform} bound to the original id so downstream errors are
 * traceable.
 */
export function resolveTransform(
  step: TransformStep,
  registry?: ServiceRegistry
): { readonly def: TransformDef<unknown>; readonly params: unknown } {
  const defs = getTransformDefs(registry);
  const def = defs.get(step.id);
  if (def) {
    return { def, params: step.params ?? {} };
  }
  return {
    def: BrokenTransform as TransformDef<unknown>,
    params: { originalId: step.id },
  };
}
