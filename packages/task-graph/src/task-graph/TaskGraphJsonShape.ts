/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskGraphJson } from "../task/TaskJSON";

/**
 * Checks the shape of a `TaskGraphJson` before deserialization touches it.
 *
 * `createGraphFromGraphJSON` throws from deep inside its own construction, and
 * the message it throws is written for whoever wrote the deserializer. That is
 * the wrong audience for graph JSON this process did not author — a CLI given a
 * file, an HTTP endpoint given a body, a model asked to produce a graph. Those
 * callers need to hand a reason back to whoever supplied the graph, and a
 * stack from inside a constructor is not one.
 *
 * Returns the first problem as a sentence naming the offending id, or
 * `undefined` when the shape is sound. It is deliberately structural only:
 * whether a `type` is a task this host will *run* is a question about the
 * host's registry, not about the JSON, and it is asked separately.
 */
export function taskGraphJsonShapeError(graph: unknown): string | undefined {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    return "graph must be an object with tasks and dataflows";
  }
  const candidate = graph as Record<string, unknown>;
  if (!Array.isArray(candidate.tasks)) return "graph.tasks must be an array";
  if (!Array.isArray(candidate.dataflows)) return "graph.dataflows must be an array";

  const ids = new Set<string>();
  for (const entry of candidate.tasks) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return "each task must be an object";
    const task = entry as Record<string, unknown>;
    if (typeof task.id !== "string" || task.id.length === 0) return "each task needs a string id";
    if (typeof task.type !== "string") return `task "${task.id}" needs a string type`;
    if (ids.has(task.id)) return `duplicate task id "${task.id}"`;
    ids.add(task.id);
    const defaults = task.defaults;
    if (
      defaults !== undefined &&
      (typeof defaults !== "object" || defaults === null || Array.isArray(defaults))
    ) {
      return `task "${task.id}" defaults must be an object`;
    }
  }

  for (const entry of candidate.dataflows) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return "each dataflow must be an object";
    const dataflow = entry as Record<string, unknown>;
    for (const key of ["sourceTaskId", "sourceTaskPortId", "targetTaskId", "targetTaskPortId"]) {
      if (typeof dataflow[key] !== "string") return `dataflow is missing ${key}`;
    }
    if (!ids.has(dataflow.sourceTaskId as string)) {
      return `dataflow source "${dataflow.sourceTaskId}" is not a task id`;
    }
    if (!ids.has(dataflow.targetTaskId as string)) {
      return `dataflow target "${dataflow.targetTaskId}" is not a task id`;
    }
  }
  return undefined;
}

export type TaskGraphJsonShapeResult =
  | { readonly ok: true; readonly graph: TaskGraphJson }
  | { readonly ok: false; readonly reason: string };

/** {@link taskGraphJsonShapeError} as a narrowing result. */
export function validateTaskGraphJsonShape(graph: unknown): TaskGraphJsonShapeResult {
  const reason = taskGraphJsonShapeError(graph);
  return reason === undefined ? { ok: true, graph: graph as TaskGraphJson } : { ok: false, reason };
}
