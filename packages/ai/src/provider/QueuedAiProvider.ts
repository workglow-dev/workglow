/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "../model/ModelSchema";
import { createDefaultQueue } from "../queue/createDefaultQueue";
import { AiProvider, type AiProviderRegisterOptions } from "./AiProvider";

/**
 * AI provider base that creates the default in-memory job queue when
 * {@link AiProvider.register} runs on the main thread (inline or worker-backed).
 *
 * Web worker entrypoints should use a provider that extends {@link AiProvider} only
 * (no queue / storage), so bundles for `registerOnWorkerServer` stay lean.
 */
export abstract class QueuedAiProvider<
  TModelConfig extends ModelConfig = ModelConfig,
> extends AiProvider<TModelConfig> {
  protected override async afterRegister(options: AiProviderRegisterOptions): Promise<void> {
    if (options.queue?.autoCreate !== false) {
      await createDefaultQueue(this.name, options.queue?.concurrency ?? 1);
    }
  }
}
