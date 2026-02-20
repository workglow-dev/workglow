/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskInput, TaskOutput, type StreamEvent } from "@workglow/task-graph";
import { globalServiceRegistry, WORKER_MANAGER } from "@workglow/util";
import type { ModelConfig } from "../model/ModelSchema";
import type { AiProvider } from "./AiProvider";

/**
 * Type for the run function for the AiJob
 */
export type AiProviderRunFn<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Model extends ModelConfig = ModelConfig,
> = (
  input: Input,
  model: Model | undefined,
  update_progress: (progress: number, message?: string, details?: any) => void,
  signal: AbortSignal
) => Promise<Output>;

/**
 * Type for the reactive run function for AiTask.executeReactive().
 * Receives the current output alongside the input so it can return a fast preview.
 * No `signal` or `update_progress` -- reactive execution is lightweight and synchronous-ish.
 */
export type AiProviderReactiveRunFn<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Model extends ModelConfig = ModelConfig,
> = (input: Input, output: Output, model: Model | undefined) => Promise<Output | undefined>;

/**
 * Type for the streaming run function for the AiJob.
 * Returns an AsyncIterable of StreamEvents instead of a Promise.
 * No `update_progress` callback -- for streaming providers, the stream itself IS the progress signal.
 */
export type AiProviderStreamFn<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Model extends ModelConfig = ModelConfig,
> = (
  input: Input,
  model: Model | undefined,
  signal: AbortSignal
) => AsyncIterable<StreamEvent<Output>>;

/**
 * Registry that manages provider-specific task execution functions and job queues.
 * Handles the registration, retrieval, and execution of task processing functions
 * for different model providers and task types.
 */
export class AiProviderRegistry {
  runFnRegistry: Map<string, Map<string, AiProviderRunFn<any, any>>> = new Map();
  streamFnRegistry: Map<string, Map<string, AiProviderStreamFn<any, any>>> = new Map();
  reactiveRunFnRegistry: Map<string, Map<string, AiProviderReactiveRunFn<any, any>>> = new Map();
  private providers: Map<string, AiProvider<any>> = new Map();

  /**
   * Registers an AiProvider instance for lifecycle management and introspection.
   * @param provider - The provider instance to register
   */
  registerProvider(provider: AiProvider<any>): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Retrieves a registered AiProvider instance by name.
   * @param name - The provider name (e.g., "HF_TRANSFORMERS_ONNX")
   * @returns The provider instance, or undefined if not found
   */
  getProvider(name: string): AiProvider<any> | undefined {
    return this.providers.get(name);
  }

  /**
   * Returns all registered AiProvider instances.
   */
  getProviders(): Map<string, AiProvider<any>> {
    return new Map(this.providers);
  }

  /**
   * Registers a task execution function for a specific task type and model provider
   * @param taskType - The type of task (e.g., 'text-generation', 'embedding')
   * @param modelProvider - The provider of the model (e.g., 'hf-transformers', 'tf-mediapipe', 'openai', etc)
   * @param runFn - The function that executes the task
   */
  registerRunFn<Input extends TaskInput = TaskInput, Output extends TaskOutput = TaskOutput>(
    modelProvider: string,
    taskType: string,
    runFn: AiProviderRunFn<Input, Output>
  ) {
    if (!this.runFnRegistry.has(taskType)) {
      this.runFnRegistry.set(taskType, new Map());
    }
    this.runFnRegistry.get(taskType)!.set(modelProvider, runFn);
  }

  registerAsWorkerRunFn<
    Input extends TaskInput = TaskInput,
    Output extends TaskOutput = TaskOutput,
  >(modelProvider: string, taskType: string) {
    const workerFn: AiProviderRunFn<Input, Output> = async (
      input: Input,
      model: ModelConfig | undefined,
      update_progress: (progress: number, message?: string, details?: any) => void,
      signal?: AbortSignal
    ) => {
      const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
      const result = await workerManager.callWorkerFunction<Output>(
        modelProvider,
        taskType,
        [input, model],
        {
          signal: signal,
          onProgress: update_progress,
        }
      );
      return result;
    };
    this.registerRunFn<Input, Output>(modelProvider, taskType, workerFn);
  }

  /**
   * Registers a streaming execution function for a specific task type and model provider.
   * @param modelProvider - The provider of the model (e.g., 'openai', 'anthropic', etc.)
   * @param taskType - The type of task (e.g., 'TextGenerationTask')
   * @param streamFn - The async generator function that yields StreamEvents
   */
  registerStreamFn<Input extends TaskInput = TaskInput, Output extends TaskOutput = TaskOutput>(
    modelProvider: string,
    taskType: string,
    streamFn: AiProviderStreamFn<Input, Output>
  ) {
    if (!this.streamFnRegistry.has(taskType)) {
      this.streamFnRegistry.set(taskType, new Map());
    }
    this.streamFnRegistry.get(taskType)!.set(modelProvider, streamFn);
  }

  /**
   * Registers a worker-proxied streaming function for a specific task type and model provider.
   * Creates a proxy that delegates streaming to a Web Worker via WorkerManager.
   * The proxy calls `callWorkerStreamFunction()` which sends a `stream: true` call message
   * and yields `stream_chunk` messages from the worker as an AsyncIterable.
   */
  registerAsWorkerStreamFn<
    Input extends TaskInput = TaskInput,
    Output extends TaskOutput = TaskOutput,
  >(modelProvider: string, taskType: string) {
    const streamFn: AiProviderStreamFn<Input, Output> = async function* (
      input: Input,
      model: ModelConfig | undefined,
      signal: AbortSignal
    ) {
      const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
      yield* workerManager.callWorkerStreamFunction<StreamEvent<Output>>(
        modelProvider,
        taskType,
        [input, model],
        { signal }
      );
    };
    this.registerStreamFn<Input, Output>(modelProvider, taskType, streamFn);
  }

  /**
   * Retrieves the streaming execution function for a task type and model provider.
   * Returns undefined if no streaming function is registered (fallback to non-streaming).
   */
  getStreamFn<Input extends TaskInput = TaskInput, Output extends TaskOutput = TaskOutput>(
    modelProvider: string,
    taskType: string
  ): AiProviderStreamFn<Input, Output> | undefined {
    const taskTypeMap = this.streamFnRegistry.get(taskType);
    return taskTypeMap?.get(modelProvider) as AiProviderStreamFn<Input, Output> | undefined;
  }

  /**
   * Registers a reactive execution function for a specific task type and model provider.
   * Called by AiTask.executeReactive() to provide a fast, lightweight preview without a network call.
   */
  registerReactiveRunFn<
    Input extends TaskInput = TaskInput,
    Output extends TaskOutput = TaskOutput,
  >(
    modelProvider: string,
    taskType: string,
    reactiveRunFn: AiProviderReactiveRunFn<Input, Output>
  ) {
    if (!this.reactiveRunFnRegistry.has(taskType)) {
      this.reactiveRunFnRegistry.set(taskType, new Map());
    }
    this.reactiveRunFnRegistry.get(taskType)!.set(modelProvider, reactiveRunFn);
  }

  /**
   * Retrieves the reactive execution function for a task type and model provider.
   * Returns undefined if no reactive function is registered (fallback to default behavior).
   */
  getReactiveRunFn<Input extends TaskInput = TaskInput, Output extends TaskOutput = TaskOutput>(
    modelProvider: string,
    taskType: string
  ): AiProviderReactiveRunFn<Input, Output> | undefined {
    const taskTypeMap = this.reactiveRunFnRegistry.get(taskType);
    return taskTypeMap?.get(modelProvider) as AiProviderReactiveRunFn<Input, Output> | undefined;
  }

  /**
   * Retrieves the direct execution function for a task type and model
   * Bypasses the job queue system for immediate execution
   */
  getDirectRunFn<Input extends TaskInput = TaskInput, Output extends TaskOutput = TaskOutput>(
    modelProvider: string,
    taskType: string
  ) {
    const taskTypeMap = this.runFnRegistry.get(taskType);
    const runFn = taskTypeMap?.get(modelProvider) as AiProviderRunFn<Input, Output> | undefined;
    if (!runFn) {
      throw new Error(
        `No run function found for task type ${taskType} and model provider ${modelProvider}`
      );
    }
    return runFn;
  }
}

// Singleton instance management for the ProviderRegistry
let providerRegistry: AiProviderRegistry;
export function getAiProviderRegistry() {
  if (!providerRegistry) providerRegistry = new AiProviderRegistry();
  return providerRegistry;
}
export function setAiProviderRegistry(pr: AiProviderRegistry) {
  providerRegistry = pr;
}
