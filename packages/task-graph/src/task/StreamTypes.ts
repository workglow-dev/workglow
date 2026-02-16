/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stream mode determines how a task's streaming output is interpreted:
 * - `none`: No streaming (default). `execute()` returns `Promise<Output>`.
 * - `append`: Each chunk is a delta (e.g., a new token). No accumulation by default.
 * - `replace`: Each chunk is a corrected/revised snapshot of the complete output so far.
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
