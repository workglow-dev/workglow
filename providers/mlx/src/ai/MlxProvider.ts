/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  AiProviderRunFnRegistration,
  Capability,
  ModelConfig,
  ModelPricing,
  ModelRecord,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import { AiProvider, FREE_LOCAL_PRICING } from "@workglow/ai";
import { LOCAL_MLX } from "./common/Mlx_Constants";

/**
 * MLX provider stub.
 *
 * The MLX runtime requires an mlx-lm Python environment which is not bundled,
 * so {@link MlxProvider.isAvailable} reports `false` and `registerMlx()` skips
 * registration. The provider is constructible for metadata inspection, and the
 * run-fn below is the backstop for anyone registering it directly: every
 * inference call throws immediately.
 */
export class MlxProvider extends AiProvider {
  readonly name = LOCAL_MLX;
  readonly displayName = "Local MLX (Apple Silicon)";
  readonly isLocal = true;
  readonly supportsBrowser = false;
  readonly supportsServer = true;

  constructor() {
    const runFns: readonly AiProviderRunFnRegistration<
      TextGenerationTaskInput,
      TextGenerationTaskOutput,
      ModelConfig
    >[] = [
      {
        serves: ["text.generation"] as readonly Capability[],
        runFn: mlxNotAvailableRunFn as AiProviderRunFn<
          TextGenerationTaskInput,
          TextGenerationTaskOutput,
          ModelConfig
        >,
      },
    ];

    const previewTasks: Record<
      string,
      AiProviderPreviewRunFn<TextGenerationTaskInput, TextGenerationTaskOutput, ModelConfig>
    > = {};

    super(runFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return (model.capabilities as readonly Capability[] | undefined) ?? ["text.generation"];
  }

  /**
   * Always `false`: inference needs an mlx-lm Python runtime that ships with
   * neither this package nor its host. Reporting availability honestly keeps
   * the provider (and its models) out of any UI that offers a choice, rather
   * than surfacing an option whose every call throws.
   */
  /**
   * MLX runs on the user's own Apple silicon, so a run costs nothing. Said
   * explicitly: an unanswered `modelPricing` reads as UNKNOWN rather than free,
   * which is the same silence a metered provider with no rate card produces.
   */
  override modelPricing(model?: ModelConfig): ModelPricing | undefined {
    if (model && model.provider !== this.name) return undefined;
    return FREE_LOCAL_PRICING;
  }

  override async isAvailable(): Promise<boolean> {
    return false;
  }
}

const mlxNotAvailableRunFn: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  ModelConfig
> = async (_input, _model, _signal, _emit) => {
  throw new Error("MLX provider not available: Python runtime not bundled.");
};
