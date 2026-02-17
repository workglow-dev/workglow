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
 * `port` identifies which output port this delta belongs to.
 */
export type StreamTextDelta = {
  type: "text-delta";
  port: string;
  textDelta: string;
};

/**
 * Object delta for future structured/object streaming.
 * `port` identifies which output port this delta belongs to.
 * The exact shape of `objectDelta` is TBD (JSON Merge Patch, partial, etc.).
 */
export type StreamObjectDelta = {
  type: "object-delta";
  port: string;
  objectDelta: unknown;
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
 * accumulates text-delta chunks into the append port (determined by
 * the output schema's `x-stream: "append"` annotation); `data` may
 * carry additional fields (merged into the final output).
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
  | StreamObjectDelta
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
 * Returns all ports that declare an `x-stream` annotation, along with their mode.
 *
 * @param schema - The task's output (or input) DataPortSchema
 * @returns Array of `{ port, mode }` for every annotated port
 */
export function getStreamingPorts(
  schema: DataPortSchema
): Array<{ port: string; mode: StreamMode }> {
  if (typeof schema === "boolean") return [];
  const props = schema.properties;
  if (!props) return [];

  const result: Array<{ port: string; mode: StreamMode }> = [];
  for (const [name, prop] of Object.entries(props)) {
    if (!prop || typeof prop === "boolean") continue;
    const xStream = (prop as any)["x-stream"];
    if (xStream === "append" || xStream === "replace") {
      result.push({ port: name, mode: xStream });
    }
  }
  return result;
}

/**
 * Returns the dominant output stream mode for a task by inspecting its output schema.
 * All streaming ports must use the same mode -- mixing `append` and `replace` on
 * a single task is not supported and will throw.
 * Returns `"none"` if no output port declares streaming.
 */
export function getOutputStreamMode(outputSchema: DataPortSchema): StreamMode {
  const ports = getStreamingPorts(outputSchema);
  if (ports.length === 0) return "none";

  const mode = ports[0].mode;
  for (let i = 1; i < ports.length; i++) {
    if (ports[i].mode !== mode) {
      throw new Error(
        `Mixed stream modes on a single task are not supported: ` +
          `port "${ports[0].port}" is "${mode}" but port "${ports[i].port}" is "${ports[i].mode}"`
      );
    }
  }
  return mode;
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
 * Returns the port ID (property name) of the first output port that declares
 * `x-stream: "append"`, or `undefined` if no such port exists.
 *
 * @param schema - The task's output DataPortSchema
 * @returns The port name with append streaming, or undefined
 */
export function getAppendPortId(schema: DataPortSchema): string | undefined {
  if (typeof schema === "boolean") return undefined;
  const props = schema.properties;
  if (!props) return undefined;

  for (const [name, prop] of Object.entries(props)) {
    if (!prop || typeof prop === "boolean") continue;
    if ((prop as any)["x-stream"] === "append") return name;
  }
  return undefined;
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
