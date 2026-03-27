/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskInput, TaskOutput } from "@workglow/task-graph";
import type { AiJobInput } from "../job/AiJob";
import type { ModelConfig } from "../model/ModelSchema";

/**
 * Strategy for executing AI jobs. Providers register a strategy resolver
 * that picks the right strategy based on the model config.
 */
export interface IAiExecutionStrategy {
  execute(
    jobInput: AiJobInput<TaskInput>,
    context: IExecuteContext,
    runnerId: string | undefined
  ): Promise<TaskOutput>;

  abort(): void;
}

/**
 * Resolves an execution strategy for a given model config.
 * Called at task execution time to allow model-specific decisions
 * (e.g., HFT WebGPU → queued, HFT WASM → direct).
 */
export type AiStrategyResolver = (model: ModelConfig) => IAiExecutionStrategy;
