/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskInput, TaskOutput } from "@workglow/task-graph";
import { globalServiceRegistry, WORKER_MANAGER, type WorkerServer } from "@workglow/util";
import type { ModelConfig } from "../model/ModelSchema";
import { createDefaultQueue } from "../queue/createDefaultQueue";
import {
  type AiProviderRunFn,
  type AiProviderStreamFn,
  getAiProviderRegistry,
} from "./AiProviderRegistry";

/**
 * Execution mode for an AI provider.
 * - "inline": run functions execute directly in the current thread
 * - "worker": run functions are proxied to a Web Worker via WorkerManager
 */
export type AiProviderMode = "inline" | "worker";

/**
 * Options for registering an AI provider.
 */
export interface AiProviderRegisterOptions {
  /** Execution mode: "inline" (same thread) or "worker" (Web Worker) */
  mode: AiProviderMode;
  /** The Web Worker instance. Required when mode is "worker". */
  worker?: Worker;
  /** Job queue configuration */
  queue?: {
    /** Maximum number of concurrent jobs. Defaults to 1. */
    concurrency?: number;
    /** Set to false to skip automatic queue creation. Defaults to true. */
    autoCreate?: boolean;
  };
}

/**
 * Abstract base class for AI providers.
 *
 * Each provider subclass declares a `taskTypes` array listing the task type
 * names it supports. The actual run function implementations (`tasks` record)
 * are **injected via the constructor** so that heavy ML library imports remain
 * at the call site. This allows the provider class to be imported on the main
 * thread without pulling in heavy dependencies when running in worker mode.
 *
 * The base class handles:
 * - Registering run functions with the AiProviderRegistry (inline or worker mode)
 * - Creating a default job queue
 * - Registering functions on a WorkerServer (for worker-side code)
 * - Lifecycle management (initialize / dispose)
 *
 * @example
 * ```typescript
 * // Worker mode (main thread) -- lightweight, no heavy imports:
 * await new MyProvider().register({
 *   mode: "worker",
 *   worker: new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
 * });
 *
 * // Inline mode -- caller provides the tasks (imports heavy library):
 * import { MY_TASKS } from "./MyJobRunFns";
 * await new MyProvider(MY_TASKS).register({ mode: "inline" });
 *
 * // Worker side -- caller provides the tasks:
 * import { MY_TASKS } from "./MyJobRunFns";
 * new MyProvider(MY_TASKS).registerOnWorkerServer(workerServer);
 * ```
 */
export abstract class AiProvider<TModelConfig extends ModelConfig = ModelConfig> {
  /** Unique provider identifier (e.g., "HF_TRANSFORMERS_ONNX") */
  abstract readonly name: string;

  /**
   * List of task type names this provider supports.
   * This is lightweight metadata -- no heavy library imports needed.
   */
  abstract readonly taskTypes: readonly string[];

  /**
   * Map of task type names to their run functions.
   * Injected via constructor. Required for inline mode and worker-server
   * registration; not needed for worker-mode registration on the main thread.
   */
  protected readonly tasks?: Record<string, AiProviderRunFn<any, any, TModelConfig>>;

  /**
   * Map of task type names to their streaming run functions.
   * Injected via constructor alongside `tasks`. Only needed for tasks that
   * support streaming output (e.g., text generation, summarization).
   */
  protected readonly streamTasks?: Record<string, AiProviderStreamFn<any, any, TModelConfig>>;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, TModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, TModelConfig>>
  ) {
    this.tasks = tasks;
    this.streamTasks = streamTasks;
  }

  /** Get all task type names this provider supports */
  get supportedTaskTypes(): readonly string[] {
    return this.taskTypes;
  }

  /**
   * Get the run function for a specific task type.
   * @param taskType - The task type name (e.g., "TextEmbeddingTask")
   * @returns The run function, or undefined if the task type is not supported or tasks not provided
   */
  getRunFn<I extends TaskInput = TaskInput, O extends TaskOutput = TaskOutput>(
    taskType: string
  ): AiProviderRunFn<I, O, TModelConfig> | undefined {
    return this.tasks?.[taskType] as AiProviderRunFn<I, O, TModelConfig> | undefined;
  }

  /**
   * Get the streaming function for a specific task type.
   * @param taskType - The task type name (e.g., "TextGenerationTask")
   * @returns The stream function, or undefined if streaming is not supported for this task type
   */
  getStreamFn<I extends TaskInput = TaskInput, O extends TaskOutput = TaskOutput>(
    taskType: string
  ): AiProviderStreamFn<I, O, TModelConfig> | undefined {
    return this.streamTasks?.[taskType] as AiProviderStreamFn<I, O, TModelConfig> | undefined;
  }

  /**
   * Register this provider on the main thread.
   *
   * In "inline" mode, registers direct run functions with the AiProviderRegistry.
   * Requires `tasks` to have been provided via the constructor.
   *
   * In "worker" mode, registers the worker with WorkerManager and creates proxy
   * functions that delegate to the worker. Does NOT require `tasks`.
   *
   * Both modes create a job queue unless `queue.autoCreate` is set to false.
   *
   * @param options - Registration options (mode, worker, queue config)
   */
  async register(options: AiProviderRegisterOptions = { mode: "inline" }): Promise<void> {
    await this.onInitialize(options);

    // Validate before any registration so we don't leave the registry in a partial state
    if (options.mode === "worker") {
      if (!options.worker) {
        throw new Error(
          `AiProvider "${this.name}": worker is required when mode is "worker". ` +
            `Pass a Web Worker instance, e.g. register({ mode: "worker", worker: new Worker(...) }).`
        );
      }
    } else {
      if (!this.tasks) {
        throw new Error(
          `AiProvider "${this.name}": tasks must be provided via the constructor for inline mode. ` +
            `Pass the tasks record when constructing the provider, e.g. new MyProvider(MY_TASKS).`
        );
      }
    }

    const registry = getAiProviderRegistry();

    if (options.mode === "worker" && options.worker) {
      const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
      workerManager.registerWorker(this.name, options.worker);
      for (const taskType of this.taskTypes) {
        registry.registerAsWorkerRunFn(this.name, taskType);
        registry.registerAsWorkerStreamFn(this.name, taskType);
      }
    } else {
      for (const [taskType, fn] of Object.entries(this.tasks!)) {
        registry.registerRunFn(this.name, taskType, fn as AiProviderRunFn);
      }
      if (this.streamTasks) {
        for (const [taskType, fn] of Object.entries(this.streamTasks)) {
          registry.registerStreamFn(this.name, taskType, fn as AiProviderStreamFn);
        }
      }
    }

    registry.registerProvider(this);

    if (options.queue?.autoCreate !== false) {
      await this.createQueue(options.queue?.concurrency ?? 1);
    }
  }

  /**
   * Register this provider's run functions on a WorkerServer.
   * Call this inside a Web Worker to make the provider's functions
   * available for remote invocation from the main thread.
   *
   * Requires `tasks` to have been provided via the constructor.
   *
   * @param workerServer - The WorkerServer instance to register on
   */
  registerOnWorkerServer(workerServer: WorkerServer): void {
    if (!this.tasks) {
      throw new Error(
        `AiProvider "${this.name}": tasks must be provided via the constructor for worker server registration. ` +
          `Pass the tasks record when constructing the provider, e.g. new MyProvider(MY_TASKS).`
      );
    }
    for (const [taskType, fn] of Object.entries(this.tasks)) {
      workerServer.registerFunction(taskType, fn);
    }
    if (this.streamTasks) {
      for (const [taskType, fn] of Object.entries(this.streamTasks)) {
        workerServer.registerStreamFunction(taskType, fn);
      }
    }
  }

  /**
   * Hook for provider-specific initialization.
   * Called at the start of `register()`, before any functions are registered.
   * Override in subclasses to perform setup (e.g., configuring WASM backends).
   */
  protected async onInitialize(_options: AiProviderRegisterOptions): Promise<void> {}

  /**
   * Dispose of provider resources.
   * Override in subclasses to clean up (e.g., clearing pipeline caches).
   */
  async dispose(): Promise<void> {}

  /**
   * Create and register a default job queue for this provider.
   * Uses InMemoryQueueStorage with a ConcurrencyLimiter.
   */
  protected async createQueue(concurrency: number): Promise<void> {
    await createDefaultQueue(this.name, concurrency);
  }
}
