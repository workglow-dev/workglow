/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types";
import type { ITaskConstructor, TaskOutput } from "@workglow/task-graph";
import { TaskRegistry } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";

export type AnyTaskConstructor = ITaskConstructor<any, any, any>;

/**
 * Tasks that only mean something as part of a graph, or that a class never
 * meant to publish at all.
 *
 * A `MapTask` with no subgraph to map over is not a tool a caller can use, and
 * offering one is worse than offering nothing: it fills the tool list a model
 * has to read with entries whose every invocation fails.
 *
 * `"Hidden"` is what `Task` leaves behind when a class names no category, and
 * it is the repo's existing "keep out of pickers" marker. Publishing it is not
 * merely noisy: `JsonTask` takes a graph as JSON and runs it, which re-admits
 * every task this set excludes and walks around a host's own selection, and
 * `LambdaTask` cannot be configured over the wire at all.
 */
const NON_TOOL_CATEGORIES: ReadonlySet<string> = new Set(["Flow Control", "Hidden"]);

/**
 * Characters an MCP tool name may carry.
 *
 * The protocol itself only says "string", but every mainstream client narrows
 * it to this set before forwarding the list to a model, and one bad name there
 * rejects the whole list rather than the one tool.
 */
const TOOL_NAME_ALLOWED = /^[a-zA-Z0-9_-]+$/;

/** Long enough for any task type in practice, short enough for every client. */
const TOOL_NAME_MAX = 64;

export interface TaskToolSelection {
  /**
   * The task classes to offer. Defaults to everything in the global
   * {@link TaskRegistry}, which is what a host's own `registerTasks` filled.
   *
   * An array rather than an `Iterable`: the selection is re-read on every
   * `tools/list` and every `tools/call`, so a one-shot iterator would be
   * drained by the first list and leave every later one empty.
   */
  readonly tasks?: readonly AnyTaskConstructor[];
  /**
   * Narrows {@link TaskToolSelection.tasks}. Defaults to dropping the
   * flow-control and hidden categories; a host passing its own predicate
   * replaces that judgement entirely, so re-apply {@link isToolWorthyTask} if
   * you only meant to add a condition.
   */
  readonly include?: (ctor: AnyTaskConstructor) => boolean;
}

/** Whether a task is worth offering as a standalone tool. */
export function isToolWorthyTask(ctor: AnyTaskConstructor): boolean {
  return !NON_TOOL_CATEGORIES.has(ctor.category ?? "");
}

/**
 * The tool name for a task type — the type itself wherever it already is a
 * legal name, which every task in this repo is.
 *
 * Keeping it verbatim means the name a model calls is the name an operator
 * types at `task run`, so a transcript and a terminal stay one vocabulary.
 */
export function toolNameForTaskType(type: string): string {
  const name = TOOL_NAME_ALLOWED.test(type) ? type : type.replace(/[^a-zA-Z0-9_-]+/g, "_");
  // Trim AFTER the length cap, or the cut reintroduces the very separator the
  // trim just removed: a 63-character type ending in `-Bcd` lands on a name
  // whose last character is `-`.
  const trimmed = name.slice(0, TOOL_NAME_MAX).replace(/^[_-]+|[_-]+$/g, "");
  return trimmed.length > 0 ? trimmed : "task";
}

/**
 * The selected tasks, keyed by tool name.
 *
 * Sorted by task type before naming, so the list a client caches does not
 * reorder — and so a name collision survivor is decided by the type names
 * rather than by whichever module happened to register first.
 */
export function buildTaskToolIndex(
  selection: TaskToolSelection = {}
): ReadonlyMap<string, AnyTaskConstructor> {
  const include = selection.include ?? isToolWorthyTask;
  const source = selection.tasks ?? TaskRegistry.all.values();
  const selected = [...source].filter(include).sort((a, b) => a.type.localeCompare(b.type));

  const index = new Map<string, AnyTaskConstructor>();
  for (const ctor of selected) {
    const base = toolNameForTaskType(ctor.type);
    let name = base;
    // Only reachable once sanitizing has folded two types together. Suffixing
    // keeps both callable rather than silently dropping the loser.
    for (let n = 2; index.has(name); n++) name = `${base}_${n}`;
    index.set(name, ctor);
  }
  return index;
}

/**
 * A task's input schema as MCP's narrower one.
 *
 * MCP requires an object schema; a task declaring anything else (or a bare
 * `true`/`false` schema) is offered as taking no declared arguments rather
 * than as a tool whose schema a client will reject.
 */
export function toToolInputSchema(schema: DataPortSchema): Tool["inputSchema"] {
  if (typeof schema !== "object" || schema === null) return { type: "object" };
  if (schema.type !== "object") return { type: "object" };
  // A task declares `required` readonly and MCP's type does not, so it is
  // copied rather than shared — which also keeps the task's own schema object
  // out of the wire payload.
  const { required, ...rest } = schema;
  return {
    ...rest,
    type: "object",
    ...(required ? { required: [...required] } : {}),
  };
}

/**
 * A static a task actually set.
 *
 * `Task` defaults `title` and `description` to `""` rather than leaving them
 * undefined, so `??` alone would happily describe a tool as the empty string.
 */
function declared(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The MCP tool describing one task class. */
export function describeTaskTool(name: string, ctor: AnyTaskConstructor): Tool {
  const title = declared(ctor.title);
  // `"Hidden"` is what `Task` leaves behind when a class names no category, and
  // stamping it on a description reads as a claim rather than as a default.
  const named = declared(ctor.category);
  const category = named === "Hidden" ? undefined : named;
  const description = declared(ctor.description) ?? title ?? ctor.type;
  return {
    name,
    ...(title ? { title } : {}),
    description: category ? `[${category}] ${description}` : description,
    inputSchema: toToolInputSchema(ctor.inputSchema()),
  };
}

/** The tool list for a selection of tasks, in the order clients should see it. */
export function listTaskTools(selection: TaskToolSelection = {}): Tool[] {
  return [...buildTaskToolIndex(selection)].map(([name, ctor]) => describeTaskTool(name, ctor));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * JSON a tool result can carry, and whether the value survived the trip.
 *
 * A task may legitimately output a value `JSON.stringify` refuses — a cyclic
 * structure, a `BigInt`. Failing to render the result is not a reason to fail
 * the call, which by then has already done its work and possibly spent money.
 */
function renderOutput(output: unknown): { readonly text: string; readonly serializable: boolean } {
  try {
    return { text: JSON.stringify(output, null, 2) ?? String(output), serializable: true };
  } catch (error) {
    return {
      text: `<output could not be serialized as JSON: ${
        error instanceof Error ? error.message : String(error)
      }>`,
      serializable: false,
    };
  }
}

/**
 * A completed task run as an MCP tool result.
 *
 * `structuredContent` is attached only for an output that actually serializes.
 * The whole response is `JSON.stringify`d again by the transport, so echoing an
 * unserializable value there would throw where nothing can answer the client:
 * the SDK routes that failure to `onerror` and never sends a response, and the
 * call hangs until the client's own timeout — undoing the guard above it.
 */
export function toolResultForOutput(output: TaskOutput | undefined): CallToolResult {
  const rendered = renderOutput(output);
  return {
    content: [{ type: "text", text: rendered.text }],
    ...(rendered.serializable && isPlainObject(output) ? { structuredContent: output } : {}),
  };
}

/**
 * A failed task run as an MCP tool result.
 *
 * A tool that could not do its job reports that IN a result, not as a JSON-RPC
 * error: the protocol reserves errors for the call never having reached the
 * tool, and a model can only react to what comes back as content.
 */
export function toolResultForError(error: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}
