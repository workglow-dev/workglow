/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { areSemanticallyCompatible, EventEmitter } from "@workglow/util";
import type { StreamEvent } from "../task/StreamTypes";
import { TaskError } from "../task/TaskError";
import { DataflowJson } from "../task/TaskJSON";
import { TaskIdType, TaskOutput, TaskStatus } from "../task/TaskTypes";
import {
  DataflowEventListener,
  DataflowEventListeners,
  DataflowEventParameters,
  DataflowEvents,
} from "./DataflowEvents";
import { TaskGraph } from "./TaskGraph";

export type DataflowIdType = `${string}[${string}] ==> ${string}[${string}]`;

export const DATAFLOW_ALL_PORTS = "*";
export const DATAFLOW_ERROR_PORT = "[error]";

/**
 * Represents a data flow between two tasks, indicating how one task's output is used as input for another task
 */
export class Dataflow {
  constructor(
    public sourceTaskId: TaskIdType,
    public sourceTaskPortId: string,
    public targetTaskId: TaskIdType,
    public targetTaskPortId: string
  ) {}
  public static createId(
    sourceTaskId: TaskIdType,
    sourceTaskPortId: string,
    targetTaskId: TaskIdType,
    targetTaskPortId: string
  ): DataflowIdType {
    return `${sourceTaskId}[${sourceTaskPortId}] ==> ${targetTaskId}[${targetTaskPortId}]`;
  }
  get id(): DataflowIdType {
    return Dataflow.createId(
      this.sourceTaskId,
      this.sourceTaskPortId,
      this.targetTaskId,
      this.targetTaskPortId
    );
  }
  public value: any = undefined;
  public status: TaskStatus = TaskStatus.PENDING;
  public error: TaskError | undefined;

  /**
   * Active stream for this dataflow edge.
   * Set when a streaming upstream task begins producing chunks.
   * Multiple downstream consumers can each get an independent reader via tee().
   */
  public stream: ReadableStream<StreamEvent> | undefined = undefined;

  /**
   * Sets the active stream on this dataflow.
   * @param stream The ReadableStream of StreamEvents from the upstream task
   */
  public setStream(stream: ReadableStream<StreamEvent>): void {
    this.stream = stream;
  }

  /**
   * Gets the active stream from this dataflow, or undefined if not streaming.
   */
  public getStream(): ReadableStream<StreamEvent> | undefined {
    return this.stream;
  }

  /**
   * Consumes the active stream to completion and materializes the value.
   *
   * This is edge-level accumulation for non-streaming downstream tasks that
   * depend on a streaming upstream task (Plan section 5e). The method reads
   * all stream events and determines the final value:
   *
   * - **append mode** (text-delta events): concatenates all textDelta strings.
   *   The accumulated text is stored directly as `this.value` (for specific-port
   *   dataflows) or wrapped in `{ text }` (for DATAFLOW_ALL_PORTS).
   * - **replace mode** (snapshot events): uses the data from the last snapshot.
   * - **finish with data**: uses the finish payload (covers cache-on append and
   *   replace modes where the provider already accumulated).
   *
   * After consumption the stream reference is cleared. Calling this method on
   * a dataflow that has no stream is a no-op.
   */
  public async awaitStreamValue(): Promise<void> {
    if (!this.stream) return;

    const reader = this.stream.getReader();
    let accumulatedText = "";
    let lastSnapshotData: any = undefined;
    let finishData: any = undefined;
    let hasTextDelta = false;

    try {
      while (true) {
        const { done, value: event } = await reader.read();
        if (done) break;

        switch (event.type) {
          case "text-delta":
            hasTextDelta = true;
            accumulatedText += event.textDelta;
            break;
          case "snapshot":
            lastSnapshotData = event.data;
            break;
          case "finish":
            finishData = event.data;
            break;
          case "error":
            // Swallow – let the value be whatever we accumulated so far
            break;
        }
      }
    } finally {
      reader.releaseLock();
      this.stream = undefined;
    }

    // Determine the materialized value.
    // Priority: snapshot > non-empty finish > accumulated text-deltas.
    if (lastSnapshotData !== undefined) {
      // Replace mode: last snapshot is a complete output object
      this.setPortData(lastSnapshotData);
    } else if (finishData && Object.keys(finishData).length > 0) {
      // Finish event carried data (e.g. append with cache-on, or replace)
      this.setPortData(finishData);
    } else if (hasTextDelta) {
      // Append mode (cache off): reconstruct from accumulated text-deltas
      if (this.sourceTaskPortId === DATAFLOW_ALL_PORTS) {
        this.value = { text: accumulatedText };
      } else {
        this.value = accumulatedText;
      }
    }
  }

  public reset() {
    this.status = TaskStatus.PENDING;
    this.error = undefined;
    this.value = undefined;
    this.stream = undefined;
    this.emit("reset");
    this.emit("status", this.status);
  }

  public setStatus(status: TaskStatus) {
    if (status === this.status) return;
    this.status = status;
    switch (status) {
      case TaskStatus.PROCESSING:
        this.emit("start");
        break;
      case TaskStatus.STREAMING:
        this.emit("streaming");
        break;
      case TaskStatus.COMPLETED:
        this.emit("complete");
        break;
      case TaskStatus.ABORTING:
        this.emit("abort");
        break;
      case TaskStatus.PENDING:
        this.emit("reset");
        break;
      case TaskStatus.FAILED:
        this.emit("error", this.error!);
        break;
      case TaskStatus.DISABLED:
        this.emit("disabled");
        break;
    }
    this.emit("status", this.status);
  }

  setPortData(entireDataBlock: any) {
    if (this.sourceTaskPortId === DATAFLOW_ALL_PORTS) {
      this.value = entireDataBlock;
    } else if (this.sourceTaskPortId === DATAFLOW_ERROR_PORT) {
      this.error = entireDataBlock;
    } else {
      this.value = entireDataBlock[this.sourceTaskPortId];
    }
  }

  getPortData(): TaskOutput {
    let result: TaskOutput;
    if (this.targetTaskPortId === DATAFLOW_ALL_PORTS) {
      result = this.value;
    } else if (this.targetTaskPortId === DATAFLOW_ERROR_PORT) {
      result = { [DATAFLOW_ERROR_PORT]: this.error };
    } else {
      result = { [this.targetTaskPortId]: this.value };
    }
    return result;
  }

  toJSON(): DataflowJson {
    return {
      sourceTaskId: this.sourceTaskId,
      sourceTaskPortId: this.sourceTaskPortId,
      targetTaskId: this.targetTaskId,
      targetTaskPortId: this.targetTaskPortId,
    };
  }

  semanticallyCompatible(
    graph: TaskGraph,
    dataflow: Dataflow
  ): "static" | "runtime" | "incompatible" {
    // TODO(str): this is inefficient
    const targetSchema = graph.getTask(dataflow.targetTaskId)!.inputSchema();
    const sourceSchema = graph.getTask(dataflow.sourceTaskId)!.outputSchema();

    if (typeof targetSchema === "boolean") {
      if (targetSchema === false) {
        return "incompatible";
      }
      return "static";
    }
    if (typeof sourceSchema === "boolean") {
      if (sourceSchema === false) {
        return "incompatible";
      }
      return "runtime";
    }

    let targetSchemaProperty =
      DATAFLOW_ALL_PORTS === dataflow.targetTaskPortId
        ? true // Accepts any schema (equivalent to Type.Any())
        : (targetSchema.properties as any)?.[dataflow.targetTaskPortId];
    // If the specific property doesn't exist but additionalProperties is true,
    // treat it as accepting any schema
    if (targetSchemaProperty === undefined && targetSchema.additionalProperties === true) {
      targetSchemaProperty = true;
    }
    let sourceSchemaProperty =
      DATAFLOW_ALL_PORTS === dataflow.sourceTaskPortId
        ? true // Accepts any schema (equivalent to Type.Any())
        : (sourceSchema.properties as any)?.[dataflow.sourceTaskPortId];
    // If the specific property doesn't exist but additionalProperties is true,
    // treat it as outputting any schema
    if (sourceSchemaProperty === undefined && sourceSchema.additionalProperties === true) {
      sourceSchemaProperty = true;
    }

    const semanticallyCompatible = areSemanticallyCompatible(
      sourceSchemaProperty,
      targetSchemaProperty
    );

    return semanticallyCompatible;
  }

  // ========================================================================
  // Event handling methods
  // ========================================================================

  /**
   * Event emitter for dataflow events
   */
  public get events(): EventEmitter<DataflowEventListeners> {
    if (!this._events) {
      this._events = new EventEmitter<DataflowEventListeners>();
    }
    return this._events;
  }
  protected _events: EventEmitter<DataflowEventListeners> | undefined;

  public subscribe<Event extends DataflowEvents>(
    name: Event,
    fn: DataflowEventListener<Event>
  ): () => void {
    return this.events.subscribe(name, fn);
  }

  /**
   * Registers an event listener
   */
  public on<Event extends DataflowEvents>(name: Event, fn: DataflowEventListener<Event>): void {
    this.events.on(name, fn);
  }

  /**
   * Removes an event listener
   */
  public off<Event extends DataflowEvents>(name: Event, fn: DataflowEventListener<Event>): void {
    this.events.off(name, fn);
  }

  /**
   * Registers a one-time event listener
   */
  public once<Event extends DataflowEvents>(name: Event, fn: DataflowEventListener<Event>): void {
    this.events.once(name, fn);
  }

  /**
   * Returns a promise that resolves when the specified event is emitted
   */
  public waitOn<Event extends DataflowEvents>(
    name: Event
  ): Promise<DataflowEventParameters<Event>> {
    return this.events.waitOn(name) as Promise<DataflowEventParameters<Event>>;
  }

  /**
   * Emits an event
   */
  public emit<Event extends DataflowEvents>(
    name: Event,
    ...args: DataflowEventParameters<Event>
  ): void {
    this._events?.emit(name, ...args);
  }
}

/**
 * Represents a data flow between two tasks, indicating how one task's output is used as input for another task
 *
 * This is a helper class that parses a data flow id string into a Dataflow object
 *
 * @param dataflow - The data flow string, e.g. "sourceTaskId[sourceTaskPortId] ==> targetTaskId[targetTaskPortId]"
 */
export class DataflowArrow extends Dataflow {
  constructor(dataflow: DataflowIdType) {
    // Parse the dataflow string using regex
    const pattern =
      /^([a-zA-Z0-9-]+?)\[([a-zA-Z0-9-]+?)\] ==> ([a-zA-Z0-9-]+?)\[([a-zA-Z0-9-]+?)\]$/;
    const match = dataflow.match(pattern);

    if (!match) {
      throw new Error(`Invalid dataflow format: ${dataflow}`);
    }

    const [, sourceTaskId, sourceTaskPortId, targetTaskId, targetTaskPortId] = match;
    super(sourceTaskId, sourceTaskPortId, targetTaskId, targetTaskPortId);
  }
}
