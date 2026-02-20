/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, ServiceRegistry } from "@workglow/util";
import { TASK_OUTPUT_REPOSITORY, TaskOutputRepository } from "../storage/TaskOutputRepository";
import { ensureTask, type Taskish } from "../task-graph/Conversions";
import { resolveSchemaInputs } from "./InputResolver";
import { IRunConfig, ITask } from "./ITask";
import { ITaskRunner } from "./ITaskRunner";
import {
  getOutputStreamMode,
  getStreamingPorts,
  isTaskStreamable,
  type StreamEvent,
  type StreamMode,
} from "./StreamTypes";
import { Task } from "./Task";
import { TaskAbortedError, TaskError, TaskFailedError, TaskInvalidInputError } from "./TaskError";
import { TaskConfig, TaskInput, TaskOutput, TaskStatus } from "./TaskTypes";

/**
 * Responsible for running tasks
 * Manages the execution lifecycle of individual tasks
 */
export class TaskRunner<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig = TaskConfig,
> implements ITaskRunner<Input, Output, Config> {
  /**
   * Whether the task is currently running
   */
  protected running = false;
  protected reactiveRunning = false;

  /**
   * The task to run
   */
  public readonly task: ITask<Input, Output, Config>;

  /**
   * AbortController for cancelling task execution
   */
  protected abortController?: AbortController;

  /**
   * The output cache for the task
   */
  protected outputCache?: TaskOutputRepository;

  /**
   * The service registry for the task
   */
  protected registry: ServiceRegistry = globalServiceRegistry;

  /**
   * Input streams for pass-through streaming tasks.
   * Set by the graph runner before executing a streaming task that has
   * upstream streaming edges. Keyed by input port name.
   */
  public inputStreams?: Map<string, ReadableStream<StreamEvent>>;

  /**
   * Whether the streaming task runner should accumulate text-delta chunks and
   * emit an enriched finish event. Set from IRunConfig.shouldAccumulate.
   * Defaults to true so standalone task execution is backward-compatible.
   * The graph runner sets this to false when no downstream edge needs
   * materialized data (no cache, all downstream tasks are also streaming).
   */
  protected shouldAccumulate: boolean = true;

  /**
   * Constructor for TaskRunner
   * @param task The task to run
   */
  constructor(task: ITask<Input, Output, Config>) {
    this.task = task;
    this.own = this.own.bind(this);
    this.handleProgress = this.handleProgress.bind(this);
  }

  // ========================================================================
  // Public methods
  // ========================================================================

  /**
   * Runs the task and returns the output
   * @param overrides Optional input overrides
   * @param config Optional configuration overrides
   * @returns The task output
   */
  async run(overrides: Partial<Input> = {}, config: IRunConfig = {}): Promise<Output> {
    await this.handleStart(config);

    try {
      this.task.setInput(overrides);

      // Resolve schema-annotated inputs (models, repositories) before validation
      const schema = (this.task.constructor as typeof Task).inputSchema();
      this.task.runInputData = (await resolveSchemaInputs(
        this.task.runInputData as Record<string, unknown>,
        schema,
        { registry: this.registry }
      )) as Input;

      const isValid = await this.task.validateInput(this.task.runInputData);
      if (!isValid) {
        throw new TaskInvalidInputError("Invalid input data");
      }

      if (this.abortController?.signal.aborted) {
        await this.handleAbort();
        throw new TaskAbortedError("Promise for task created and aborted before run");
      }

      const inputs: Input = this.task.runInputData as Input;
      let outputs: Output | undefined;

      const isStreamable = isTaskStreamable(this.task);

      if (this.task.cacheable) {
        outputs = (await this.outputCache?.getOutput(this.task.type, inputs)) as Output;
        if (outputs) {
          if (isStreamable) {
            this.task.runOutputData = outputs;
            this.task.emit("stream_start");
            this.task.emit("stream_chunk", { type: "finish", data: outputs } as StreamEvent);
            this.task.emit("stream_end", outputs);
            this.task.runOutputData = await this.executeTaskReactive(inputs, outputs);
          } else {
            this.task.runOutputData = await this.executeTaskReactive(inputs, outputs);
          }
        }
      }
      if (!outputs) {
        if (isStreamable) {
          outputs = await this.executeStreamingTask(inputs);
        } else {
          outputs = await this.executeTask(inputs);
        }
        if (this.task.cacheable && outputs !== undefined) {
          await this.outputCache?.saveOutput(this.task.type, inputs, outputs);
        }
        this.task.runOutputData = outputs ?? ({} as Output);
      }

      await this.handleComplete();

      return this.task.runOutputData as Output;
    } catch (err: any) {
      await this.handleError(err);
      throw err;
    }
  }

  /**
   * Runs the task in reactive mode
   * @param overrides Optional input overrides
   * @returns The task output
   */
  public async runReactive(overrides: Partial<Input> = {}): Promise<Output> {
    if (this.task.status === TaskStatus.PROCESSING) {
      return this.task.runOutputData as Output;
    }
    this.task.setInput(overrides);

    // Resolve schema-annotated inputs (models, repositories) before validation
    const schema = (this.task.constructor as typeof Task).inputSchema();
    this.task.runInputData = (await resolveSchemaInputs(
      this.task.runInputData as Record<string, unknown>,
      schema,
      { registry: this.registry }
    )) as Input;

    await this.handleStartReactive();

    try {
      const isValid = await this.task.validateInput(this.task.runInputData);
      if (!isValid) {
        throw new TaskInvalidInputError("Invalid input data");
      }

      const resultReactive = await this.executeTaskReactive(
        this.task.runInputData as Input,
        this.task.runOutputData as Output
      );

      this.task.runOutputData = resultReactive;

      await this.handleCompleteReactive();
    } catch (err: any) {
      await this.handleErrorReactive();
    } finally {
      return this.task.runOutputData as Output;
    }
  }

  /**
   * Aborts task execution
   */
  public abort(): void {
    if (this.task.hasChildren()) {
      this.task.subGraph.abort();
    }
    this.abortController?.abort();
  }

  // ========================================================================
  // Protected methods
  // ========================================================================

  protected own<T extends Taskish<any, any>>(i: T): T {
    const task = ensureTask(i, { isOwned: true });
    this.task.subGraph.addTask(task);
    return i;
  }

  /**
   * Protected method to execute a task by delegating back to the task itself.
   */
  protected async executeTask(input: Input): Promise<Output | undefined> {
    const result = await this.task.execute(input, {
      signal: this.abortController!.signal,
      updateProgress: this.handleProgress.bind(this),
      own: this.own,
      registry: this.registry,
    });
    return await this.executeTaskReactive(input, result || ({} as Output));
  }

  /**
   * Protected method for reactive execution delegation
   */
  protected async executeTaskReactive(input: Input, output: Output): Promise<Output> {
    const reactiveResult = await this.task.executeReactive(input, output, { own: this.own });
    return Object.assign({}, output, reactiveResult ?? {}) as Output;
  }

  /**
   * Executes a streaming task by consuming its executeStream() async iterable.
   *
   * When `shouldAccumulate` is true (default, set by graph runner when any downstream
   * edge needs materialized data, or when caching is on):
   *   - text-delta chunks are accumulated per-port into a Map
   *   - the raw finish event is NOT emitted; instead an enriched finish event is
   *     emitted with the accumulated text merged in, so downstream dataflows can
   *     materialize values without re-accumulating on their own
   *
   * When `shouldAccumulate` is false (set by graph runner when all downstream edges
   * are also streaming and no cache is needed):
   *   - all events including the raw finish are emitted as-is (pure pass-through)
   *   - no accumulation Map is maintained
   */
  protected async executeStreamingTask(input: Input): Promise<Output | undefined> {
    const streamMode: StreamMode = getOutputStreamMode(this.task.outputSchema());
    if (streamMode === "append") {
      const ports = getStreamingPorts(this.task.outputSchema());
      if (ports.length === 0) {
        throw new TaskError(
          `Task ${this.task.type} declares append streaming but no output port has x-stream: "append"`
        );
      }
    }

    const accumulated = this.shouldAccumulate ? new Map<string, string>() : undefined;
    let chunkCount = 0;
    let finalOutput: Output | undefined;

    this.task.emit("stream_start");

    const stream = this.task.executeStream!(input, {
      signal: this.abortController!.signal,
      updateProgress: this.handleProgress.bind(this),
      own: this.own,
      registry: this.registry,
      inputStreams: this.inputStreams,
    });

    for await (const event of stream) {
      chunkCount++;

      if (chunkCount === 1) {
        this.task.status = TaskStatus.STREAMING;
        this.task.emit("status", this.task.status);
      }

      // For snapshot events, update runOutputData BEFORE emitting stream_chunk
      // so listeners see the latest snapshot when they handle the event
      if (event.type === "snapshot") {
        this.task.runOutputData = event.data as Output;
      }

      switch (event.type) {
        case "text-delta": {
          if (accumulated) {
            accumulated.set(event.port, (accumulated.get(event.port) ?? "") + event.textDelta);
          }
          this.task.emit("stream_chunk", event as StreamEvent);
          const progress = Math.min(99, Math.round(100 * (1 - Math.exp(-0.05 * chunkCount))));
          await this.handleProgress(progress);
          break;
        }
        case "object-delta": {
          // Reserved for future object streaming -- no accumulation yet
          this.task.emit("stream_chunk", event as StreamEvent);
          const progress = Math.min(99, Math.round(100 * (1 - Math.exp(-0.05 * chunkCount))));
          await this.handleProgress(progress);
          break;
        }
        case "snapshot": {
          this.task.emit("stream_chunk", event as StreamEvent);
          const progress = Math.min(99, Math.round(100 * (1 - Math.exp(-0.05 * chunkCount))));
          await this.handleProgress(progress);
          break;
        }
        case "finish": {
          if (accumulated) {
            // Emit an enriched finish event: merge accumulated text-deltas into
            // the finish payload so downstream dataflows get complete port data
            // without needing to re-accumulate themselves.
            const merged: Record<string, unknown> = { ...(event.data || {}) };
            for (const [port, text] of accumulated) {
              if (text.length > 0) merged[port] = text;
            }
            finalOutput = merged as unknown as Output;
            this.task.emit("stream_chunk", { type: "finish", data: merged } as StreamEvent);
          } else {
            // No accumulation: emit the raw finish event and use it directly
            finalOutput = event.data as Output;
            this.task.emit("stream_chunk", event as StreamEvent);
          }
          break;
        }
        case "error": {
          throw event.error;
        }
      }
    }

    // Check if the task was aborted during streaming
    if (this.abortController?.signal.aborted) {
      throw new TaskAbortedError("Task aborted during streaming");
    }

    if (finalOutput !== undefined) {
      this.task.runOutputData = finalOutput;
    }

    this.task.emit("stream_end", this.task.runOutputData as Output);

    const reactiveResult = await this.executeTaskReactive(
      input,
      (this.task.runOutputData as Output) || ({} as Output)
    );
    return reactiveResult;
  }

  // ========================================================================
  // Protected Handlers
  // ========================================================================

  /**
   * Handles task start
   */
  protected async handleStart(config: IRunConfig = {}): Promise<void> {
    if (this.task.status === TaskStatus.PROCESSING) return;

    this.running = true;

    this.task.startedAt = new Date();
    this.task.progress = 0;
    this.task.status = TaskStatus.PROCESSING;

    this.abortController = new AbortController();
    this.abortController.signal.addEventListener("abort", () => {
      this.handleAbort();
    });

    const cache = this.task.config.outputCache ?? config.outputCache;
    if (cache === true) {
      let instance = globalServiceRegistry.get(TASK_OUTPUT_REPOSITORY);
      this.outputCache = instance;
    } else if (cache === false) {
      this.outputCache = undefined;
    } else if (cache instanceof TaskOutputRepository) {
      this.outputCache = cache;
    }

    // shouldAccumulate defaults to true (backward-compatible for standalone runs)
    this.shouldAccumulate = config.shouldAccumulate !== false;

    if (config.updateProgress) {
      this.updateProgress = config.updateProgress;
    }

    if (config.registry) {
      this.registry = config.registry;
    }

    this.task.emit("start");
    this.task.emit("status", this.task.status);
  }
  private updateProgress = async (
    task: ITask,
    progress: number,
    message?: string,
    ...args: any[]
  ) => {};

  protected async handleStartReactive(): Promise<void> {
    this.reactiveRunning = true;
  }

  /**
   * Handles task abort
   */
  protected async handleAbort(): Promise<void> {
    if (this.task.status === TaskStatus.ABORTING) return;
    this.task.status = TaskStatus.ABORTING;
    this.task.progress = 100;
    this.task.error = new TaskAbortedError();
    this.task.emit("abort", this.task.error);
    this.task.emit("status", this.task.status);
  }

  protected async handleAbortReactive(): Promise<void> {
    this.reactiveRunning = false;
  }

  /**
   * Handles task completion
   */
  protected async handleComplete(): Promise<void> {
    if (this.task.status === TaskStatus.COMPLETED) return;

    this.task.completedAt = new Date();
    this.task.progress = 100;
    this.task.status = TaskStatus.COMPLETED;
    this.abortController = undefined;

    this.task.emit("complete");
    this.task.emit("status", this.task.status);
  }

  protected async handleCompleteReactive(): Promise<void> {
    this.reactiveRunning = false;
  }

  protected async handleDisable(): Promise<void> {
    if (this.task.status === TaskStatus.DISABLED) return;
    this.task.status = TaskStatus.DISABLED;
    this.task.progress = 100;
    this.task.completedAt = new Date();
    this.abortController = undefined;
    this.task.emit("disabled");
    this.task.emit("status", this.task.status);
  }

  public async disable(): Promise<void> {
    await this.handleDisable();
  }

  /**
   * Handles task error
   * @param err Error that occurred
   */
  protected async handleError(err: Error): Promise<void> {
    if (err instanceof TaskAbortedError) return this.handleAbort();
    if (this.task.status === TaskStatus.FAILED) return;

    if (this.task.hasChildren()) {
      this.task.subGraph!.abort();
    }

    this.task.completedAt = new Date();
    this.task.progress = 100;
    this.task.status = TaskStatus.FAILED;
    this.task.error =
      err instanceof TaskError ? err : new TaskFailedError(err?.message || "Task failed");
    this.abortController = undefined;
    this.task.emit("error", this.task.error);
    this.task.emit("status", this.task.status);
  }

  protected async handleErrorReactive(): Promise<void> {
    this.reactiveRunning = false;
  }

  /**
   * Handles task progress update
   * @param progress Progress value (0-100)
   * @param args Additional arguments
   */
  protected async handleProgress(
    progress: number,
    message?: string,
    ...args: any[]
  ): Promise<void> {
    this.task.progress = progress;
    await this.updateProgress(this.task, progress, message, ...args);
    this.task.emit("progress", progress, message, ...args);
  }
}
