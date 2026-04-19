/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { areSemanticallyCompatible, type JsonSchema } from "@workglow/util/schema";
import { EventEmitter, type ServiceRegistry } from "@workglow/util";
import type { StreamEvent } from "../task/StreamTypes";
import { TaskError } from "../task/TaskError";
import { DataflowJson } from "../task/TaskJSON";
import { TaskIdType, TaskOutput, TaskStatus } from "../task/TaskTypes";
import { Task } from "../task/Task";
import {
  DataflowEventListener,
  DataflowEventListeners,
  DataflowEventParameters,
  DataflowEvents,
} from "./DataflowEvents";
import { TaskGraph } from "./TaskGraph";
import { resolveTransform, type TransformStep } from "./TransformRegistry";

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
   * Ordered chain of transform steps applied to the port value between source
   * and target. Kept private so all mutations funnel through the setters and
   * trigger cache invalidation.
   */
  private _transforms: TransformStep[] = [];

  public getTransforms(): ReadonlyArray<TransformStep> {
    return this._transforms;
  }

  public hasTransforms(): boolean {
    return this._transforms.length > 0;
  }

  public setTransforms(steps: ReadonlyArray<TransformStep>): void {
    this._transforms = steps.map((s) => ({ id: s.id, params: s.params }));
    this.invalidateCompatibilityCache();
  }

  public addTransform(step: TransformStep): void {
    this._transforms.push({ id: step.id, params: step.params });
    this.invalidateCompatibilityCache();
  }

  public removeTransform(index: number): void {
    if (index < 0 || index >= this._transforms.length) return;
    this._transforms.splice(index, 1);
    this.invalidateCompatibilityCache();
  }

  public clearTransforms(): void {
    if (this._transforms.length === 0) return;
    this._transforms = [];
    this.invalidateCompatibilityCache();
  }

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
   * Accumulation of text-delta chunks is the responsibility of the **source
   * task** (via TaskRunner.executeStreamingTask when shouldAccumulate=true).
   * When accumulation is needed the source task emits an enriched finish event
   * that carries the fully-assembled port data. All downstream edges share that
   * enriched event through tee'd ReadableStreams, so no edge needs to
   * re-accumulate independently.
   *
   * This method therefore only reads snapshot and finish events:
   * - **snapshot**: used for replace-mode tasks that emit incremental snapshots.
   * - **finish**: the primary materialization path; carries complete data when
   *   the source task accumulated, or provider-level data otherwise.
   * - text-delta / object-delta: ignored here (handled by source task).
   *
   * After consumption the stream reference is cleared. Calling this method on
   * a dataflow that has no stream is a no-op.
   */
  public async awaitStreamValue(registry?: ServiceRegistry): Promise<void> {
    if (!this.stream) return;

    const reader = this.stream.getReader();
    let lastSnapshotData: any = undefined;
    let finishData: any = undefined;
    let streamError: Error | undefined;

    // When transforms are configured and every step supports applyStream, we
    // can transform snapshots in-flight after port extraction. Scalar casts
    // (no applyStream) force buffering to the finish event.
    const streamableTransforms =
      this._transforms.length > 0 &&
      this._transforms.every((step) => {
        const { def } = resolveTransform(step, registry);
        return typeof def.applyStream === "function";
      });

    try {
      while (true) {
        const { done, value: event } = await reader.read();
        if (done) break;

        switch (event.type) {
          case "snapshot":
            if (streamableTransforms) {
              // Extract port from the snapshot block then fold the chain.
              const extracted = this.extractSourcePort(event.data);
              this.value = this.applyStreamChain(extracted, registry);
              lastSnapshotData = undefined;
            } else {
              lastSnapshotData = event.data;
            }
            break;
          case "finish":
            finishData = event.data;
            break;
          case "error":
            streamError = event.error;
            break;
          // text-delta, object-delta: source task handles accumulation
        }
      }
    } finally {
      reader.releaseLock();
      this.stream = undefined;
    }

    if (streamError) {
      this.error = streamError as TaskError;
      this.setStatus(TaskStatus.FAILED);
      throw streamError;
    }

    // Priority: snapshot > finish.
    if (lastSnapshotData !== undefined) {
      this.setPortData(lastSnapshotData);
      if (!streamableTransforms && this._transforms.length > 0) {
        await this.applyTransforms(registry);
      }
    } else if (finishData !== undefined) {
      this.setPortData(finishData);
      if (this._transforms.length > 0) {
        await this.applyTransforms(registry);
      }
    }
    // If streamableTransforms ran, this.value is already the transformed value.
  }

  private extractSourcePort(block: any): unknown {
    if (this.sourceTaskPortId === DATAFLOW_ALL_PORTS) return block;
    if (this.sourceTaskPortId === DATAFLOW_ERROR_PORT) return block;
    return block?.[this.sourceTaskPortId];
  }

  private applyStreamChain(portValue: unknown, registry?: ServiceRegistry): unknown {
    let current: unknown = portValue;
    for (const step of this._transforms) {
      const { def, params } = resolveTransform(step, registry);
      current = def.applyStream!(current, params);
    }
    return current;
  }

  public reset() {
    this.status = TaskStatus.PENDING;
    this.error = undefined;
    this.value = undefined;
    this.stream = undefined;
    this._compatibilityCache = undefined;
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
    const base: DataflowJson = {
      sourceTaskId: this.sourceTaskId,
      sourceTaskPortId: this.sourceTaskPortId,
      targetTaskId: this.targetTaskId,
      targetTaskPortId: this.targetTaskPortId,
    };
    if (this._transforms.length > 0) {
      base.transforms = this._transforms.map((s) =>
        s.params === undefined ? { id: s.id } : { id: s.id, params: { ...s.params } }
      );
    }
    return base;
  }

  /**
   * Applies the configured transform chain to {@link value} in sequence. Runs
   * only when at least one transform is configured. Any throw is captured into
   * {@link error} and the dataflow is flipped to FAILED so downstream nodes do
   * not receive a half-transformed value.
   *
   * Resolution uses the provided DI registry when supplied; otherwise falls
   * back to the global {@link TransformRegistry}.
   */
  public async applyTransforms(registry?: ServiceRegistry): Promise<void> {
    if (this._transforms.length === 0) return;
    try {
      let current: unknown = this.value;
      for (const step of this._transforms) {
        const { def, params } = resolveTransform(step, registry);
        current = await def.apply(current, params);
      }
      this.value = current;
    } catch (err) {
      this.error = err as TaskError;
      this.setStatus(TaskStatus.FAILED);
      throw err;
    }
  }

  /**
   * Cached result of the last semantic compatibility check.
   * Invalidated by calling {@link invalidateCompatibilityCache}.
   */
  protected _compatibilityCache?: "static" | "runtime" | "incompatible";

  /**
   * Invalidates the cached semantic compatibility result so the next call
   * to {@link semanticallyCompatible} recomputes it. Call this when
   * either endpoint's schema changes (e.g., in response to a schemaChange event).
   */
  public invalidateCompatibilityCache(): void {
    this._compatibilityCache = undefined;
  }

  semanticallyCompatible(
    graph: TaskGraph,
    dataflow: Dataflow
  ): "static" | "runtime" | "incompatible" {
    const sourceTask = graph.getTask(dataflow.sourceTaskId)!;
    const targetTask = graph.getTask(dataflow.targetTaskId)!;

    // Only use the cache when both endpoint tasks have stable (non-dynamic) schemas.
    // Tasks with dynamic schemas may emit `schemaChange` events, which would make
    // a cached result stale. Checking the static `hasDynamicSchemas` flag (defined
    // on Task with a default of `false`) is sufficient because tasks with stable
    // schemas never emit `schemaChange`. Unknown constructors default to no caching.
    const shouldCache =
      !((sourceTask.constructor as typeof Task).hasDynamicSchemas ?? true) &&
      !((targetTask.constructor as typeof Task).hasDynamicSchemas ?? true);

    if (shouldCache && this._compatibilityCache !== undefined) {
      return this._compatibilityCache;
    }

    const targetSchema = targetTask.inputSchema();
    const sourceSchema = sourceTask.outputSchema();

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

    const effectiveSourceSchema = this.composeSourceSchema(sourceSchemaProperty as JsonSchema);

    const result = areSemanticallyCompatible(effectiveSourceSchema, targetSchemaProperty);
    if (shouldCache) {
      this._compatibilityCache = result;
    }
    return result;
  }

  /**
   * Folds the transform chain over a source schema to get the effective schema
   * the target port actually sees. Used by {@link semanticallyCompatible} and
   * exposed so the UI can render bridge-validation identically.
   */
  public composeSourceSchema(sourceSchema: JsonSchema): JsonSchema {
    if (this._transforms.length === 0) return sourceSchema;
    let current: JsonSchema = sourceSchema;
    for (const step of this._transforms) {
      const { def, params } = resolveTransform(step);
      current = def.inferOutputSchema(current, params);
    }
    return current;
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
