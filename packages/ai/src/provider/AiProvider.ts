/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskInput, TaskOutput } from "@workglow/task-graph";
import type { WorkerServerBase as WorkerServer } from "@workglow/util/worker";
import { globalServiceRegistry, WORKER_MANAGER } from "@workglow/util/worker";
import type { ModelConfig } from "../model/ModelSchema";
import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  AiProviderStreamFn,
} from "./AiProviderRegistry";
import { getAiProviderRegistry } from "./AiProviderRegistry";

/**
 * Job queue concurrency: one limit for the primary ({@link QueuedAiProvider} hardware) queue,
 * or per-slot limits. Hugging Face Transformers ONNX uses `gpu` and `cpu` for its two queues.
 */
export type AiProviderQueueConcurrency = number | Record<string, number>;
export const DEFAULT_AI_PROVIDER_WORKER_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Resolves the primary (e.g. WebGPU) queue limit for {@link QueuedAiProvider}.
 * A numeric `concurrency` sets that queue; a record uses `gpu` (default 1).
 */
export function resolveAiProviderGpuQueueConcurrency(
  concurrency: AiProviderQueueConcurrency | undefined
): number {
  if (concurrency === undefined) {
    return 1;
  }
  if (typeof concurrency === "number") {
    return concurrency;
  }
  return concurrency.gpu ?? 1;
}

/**
 * Options for registering an AI provider on the main thread.
 *
 * - If the provider was constructed **with** task run functions → **inline** registration
 *   (direct run fns). No `worker` option.
 * - If the provider was constructed **without** tasks → **worker** registration (proxies).
 *   A `worker` (instance or lazy factory) is **required**.
 */
export interface AiProviderRegisterOptions {
  /**
   * Web Worker for worker-backed registration. Pass a `Worker` or a factory
   * `() => Worker` to defer instantiation until the first job (lazy worker).
   */
  worker?: Worker | (() => Worker);
  /**
   * Idle timeout for factory-backed worker registrations. `0` disables idle termination.
   * Defaults to 15 minutes for AI providers when `worker` is a factory.
   */
  workerIdleTimeoutMs?: number;
  /** Job queue configuration */
  queue?: {
    /**
     * Concurrent jobs on the provider's primary queued path (e.g. GPU), default 1.
     * Use a record for multiple queues — e.g. `{ gpu: 1, cpu: 4 }` for Hugging Face
     * Transformers ONNX (`cpu` defaults to 4 in production and 1 under test when omitted).
     */
    concurrency?: AiProviderQueueConcurrency;
    /** Set to false to skip automatic queue creation. Defaults to true. */
    autoCreate?: boolean;
  };
}

/**
 * Registration context passed to {@link AiProvider.onInitialize}, including whether
 * the provider is registering inline (tasks present) or worker-backed (no tasks).
 */
export interface AiProviderRegisterContext extends AiProviderRegisterOptions {
  readonly isInline: boolean;
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
 * - Registering run functions with the AiProviderRegistry (inline or worker proxies)
 * - Registering functions on a WorkerServer (for worker-side code)
 * - Lifecycle management (initialize / dispose)
 *
 * @example
 * ```typescript
 * // Worker host (main thread) -- lightweight, no heavy task imports:
 * await new MyProvider().register({
 *   worker: () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
 * });
 *
 * // Inline -- caller provides the tasks (imports heavy library):
 * import { MY_TASKS } from "./MyJobRunFns";
 * await new MyProvider(MY_TASKS).register();
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
   * Human-readable label for the provider (UI, JSON Schema `x-ui-enum-labels`, etc.).
   */
  abstract readonly displayName: string;

  /** Whether this provider runs models locally (on the same machine). */
  abstract readonly isLocal: boolean;

  /** Whether this provider can run in a browser environment. */
  abstract readonly supportsBrowser: boolean;

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

  /**
   * Map of task type names to their preview run functions.
   * Injected via constructor alongside `tasks`. Only needed for tasks that
   * provide lightweight previews via executePreview().
   */
  protected readonly previewTasks?: Record<
    string,
    AiProviderPreviewRunFn<any, any, TModelConfig>
  >;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, TModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, TModelConfig>>,
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, TModelConfig>>
  ) {
    this.tasks = tasks;
    this.streamTasks = streamTasks;
    this.previewTasks = previewTasks;
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
   * Get the preview run function for a specific task type.
   * @param taskType - The task type name (e.g., "CountTokensTask")
   * @returns The preview function, or undefined if not supported for this task type
   */
  getPreviewRunFn<I extends TaskInput = TaskInput, O extends TaskOutput = TaskOutput>(
    taskType: string
  ): AiProviderPreviewRunFn<I, O, TModelConfig> | undefined {
    return this.previewTasks?.[taskType] as
      | AiProviderPreviewRunFn<I, O, TModelConfig>
      | undefined;
  }

  /**
   * Register this provider on the main thread.
   *
   * Inferred from constructor: **with** tasks → direct run functions; **without** tasks →
   * worker proxies (requires `worker` in options).
   *
   * Creates a job queue unless `queue.autoCreate` is set to false.
   *
   * @param options - Registration options (worker for worker-backed, queue config)
   */
  async register(options: AiProviderRegisterOptions = {}): Promise<void> {
    const isInline = !!this.tasks;
    const context: AiProviderRegisterContext = { ...options, isInline };
    await this.onInitialize(context);

    if (isInline) {
      if (!this.tasks) {
        throw new Error(
          `AiProvider "${this.name}": tasks must be provided via the constructor for inline registration. ` +
            `Pass the tasks record when constructing the provider, e.g. new MyProvider(MY_TASKS).`
        );
      }
    } else {
      if (!options.worker) {
        throw new Error(
          `AiProvider "${this.name}": worker is required when no tasks are provided (worker-backed registration). ` +
            `Pass worker: new Worker(...) or worker: () => new Worker(...).`
        );
      }
    }

    const registry = getAiProviderRegistry();

    if (!isInline && options.worker) {
      const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
      if (typeof options.worker === "function") {
        workerManager.registerWorker(this.name, options.worker, {
          idleTimeoutMs: options.workerIdleTimeoutMs ?? DEFAULT_AI_PROVIDER_WORKER_IDLE_TIMEOUT_MS,
        });
      } else {
        workerManager.registerWorker(this.name, options.worker);
      }
      for (const taskType of this.taskTypes) {
        registry.registerAsWorkerRunFn(this.name, taskType);
        registry.registerAsWorkerStreamFn(this.name, taskType);
        registry.registerAsWorkerPreviewRunFn(this.name, taskType);
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

    if (this.previewTasks) {
      for (const [taskType, fn] of Object.entries(this.previewTasks)) {
        registry.registerPreviewRunFn(this.name, taskType, fn as AiProviderPreviewRunFn);
      }
    }

    registry.registerProvider(this);

    try {
      await this.afterRegister(options);
    } catch (err) {
      // Clean up the partially-registered provider so the registry isn't left
      // in an inconsistent state (e.g., functions registered but no queue).
      registry.unregisterProvider(this.name);
      throw err;
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
    if (this.previewTasks) {
      for (const [taskType, fn] of Object.entries(this.previewTasks)) {
        workerServer.registerPreviewFunction(taskType, fn);
      }
    }
  }

  /**
   * Hook for provider-specific initialization.
   * Called at the start of `register()`, before any functions are registered.
   * Override in subclasses to perform setup (e.g., configuring WASM backends).
   */
  protected async onInitialize(_options: AiProviderRegisterContext): Promise<void> {}

  /**
   * Dispose of provider resources.
   * Override in subclasses to clean up (e.g., clearing pipeline caches).
   */
  async dispose(): Promise<void> {}

  /**
   * Create a session for the given model configuration.
   * Returns an opaque session ID that can be passed to run/stream functions
   * to reuse provider-side resources (e.g., a loaded pipeline or KV cache).
   *
   * The base implementation returns a random UUID; provider subclasses
   * (e.g., HF Transformers, llama-cpp) override this to allocate real resources.
   */
  createSession(_model: ModelConfig): string {
    return crypto.randomUUID();
  }

  /**
   * Dispose of a previously created session.
   * Provider subclasses override this to release resources tied to the session.
   * The base implementation is a no-op.
   */
  async disposeSession(_sessionId: string): Promise<void> {}

  /**
   * Called at the end of {@link register} after registry wiring.
   * {@link QueuedAiProvider} overrides this to create the default job queue; the base
   * implementation is a no-op so worker-only provider classes stay free of queue/storage.
   */
  protected async afterRegister(_options: AiProviderRegisterOptions): Promise<void> {}
}
