/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema, JsonSchema } from "@workglow/util";

/**
 * Stream mode determines how a task's streaming output is interpreted:
 * - `none`: No streaming (default). `execute()` returns `Promise<Output>`.
 * - `append`: Each chunk is a delta (e.g., a new token).
 * - `replace`: Each chunk is a corrected/revised snapshot of the complete output so far.
 *
 * Declared per-port via the `x-stream` schema extension property.
 * Absent `x-stream` = `"none"`.
 */
export type StreamMode = "none" | "append" | "replace";

/**
 * Append mode: delta chunk (consumer accumulates).
 */
export type StreamTextDelta = {
  type: "text-delta";
  textDelta: string;
};

/**
 * Replace mode: full snapshot chunk (replaces previous state).
 */
export type StreamSnapshot<Output = Record<string, any>> = {
  type: "snapshot";
  data: Output;
};

/**
 * Signals that the stream has finished. In append mode, the runner
 * always accumulates text-delta chunks into the `text` field; `data`
 * may carry additional non-text fields (merged into the final output).
 * In replace mode, `data` contains the final output.
 */
export type StreamFinish<Output = Record<string, any>> = {
  type: "finish";
  data: Output;
};

/**
 * Signals that the stream encountered an error.
 */
export type StreamError = {
  type: "error";
  error: Error;
};

/**
 * Discriminated union of all stream event types.
 * Used as the element type for `AsyncIterable<StreamEvent>` streams
 * flowing through the DAG.
 */
export type StreamEvent<Output = Record<string, any>> =
  | StreamTextDelta
  | StreamSnapshot<Output>
  | StreamFinish<Output>
  | StreamError;

// ========================================================================
// Port-level stream helpers
// ========================================================================

/**
 * Reads the `x-stream` value from a specific port property in a DataPortSchema.
 * Returns `"none"` when the property or the `x-stream` annotation is absent.
 *
 * @param schema - The task's input or output DataPortSchema
 * @param portId - The property name (port ID) to inspect
 * @returns The StreamMode declared on that port
 */
export function getPortStreamMode(schema: DataPortSchema | JsonSchema, portId: string): StreamMode {
  if (typeof schema === "boolean") return "none";
  const prop = (schema.properties as Record<string, any>)?.[portId];
  if (!prop || typeof prop === "boolean") return "none";
  const xStream = prop["x-stream"];
  if (xStream === "append" || xStream === "replace") return xStream;
  return "none";
}

/**
 * Returns the dominant output stream mode for a task by inspecting its output schema.
 * If any output port has `x-stream`, returns that mode. If multiple ports have
 * different modes, `append` takes priority (it is the most common).
 * Returns `"none"` if no output port declares streaming.
 */
export function getOutputStreamMode(outputSchema: DataPortSchema): StreamMode {
  if (typeof outputSchema === "boolean") return "none";
  const props = outputSchema.properties;
  if (!props) return "none";

  let found: StreamMode = "none";
  for (const prop of Object.values(props)) {
    if (!prop || typeof prop === "boolean") continue;
    const xStream = (prop as any)["x-stream"];
    if (xStream === "append") return "append";
    if (xStream === "replace") found = "replace";
  }
  return found;
}

/**
 * Determines whether a task supports streaming by checking if any output port
 * has an `x-stream` annotation AND the task implements `executeStream()`.
 *
 * @param task - The task to inspect (must have `outputSchema()` and optionally `executeStream`)
 * @returns true if the task can produce streaming output
 */
export function isTaskStreamable(task: {
  outputSchema(): DataPortSchema;
  executeStream?: (...args: any[]) => any;
}): boolean {
  if (typeof task.executeStream !== "function") return false;
  return getOutputStreamMode(task.outputSchema()) !== "none";
}

/**
 * Determines whether a dataflow edge needs to accumulate stream events
 * into a materialized value for the target port.
 *
 * Accumulation is needed when:
 * - The source output port declares streaming (`x-stream` is set)
 * - AND the target input port does NOT accept the same stream mode
 *
 * @param sourceSchema - Output schema of the source task
 * @param sourcePort - Port ID on the source task
 * @param targetSchema - Input schema of the target task
 * @param targetPort - Port ID on the target task
 * @returns true if the edge should accumulate; false if stream can pass through
 */
export function edgeNeedsAccumulation(
  sourceSchema: DataPortSchema,
  sourcePort: string,
  targetSchema: DataPortSchema,
  targetPort: string
): boolean {
  const sourceMode = getPortStreamMode(sourceSchema, sourcePort);
  if (sourceMode === "none") return false;
  const targetMode = getPortStreamMode(targetSchema, targetPort);
  return sourceMode !== targetMode;
}
