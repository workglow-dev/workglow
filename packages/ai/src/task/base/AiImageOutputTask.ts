/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared base for AI tasks that produce a single GpuImage output, with
 * streaming partial-image support. The streaming convention follows the
 * existing snapshot/finish contract on StreamingAiTask: providers yield
 * `{ type: "snapshot", data: { image: GpuImage } }` for each partial image
 * (and the final), then `{ type: "finish", data: {} }`.
 *
 * This base class:
 * - Tracks the latest partial in `_latestPartial` WITHOUT retaining — the
 *   provider donates the reference, which is jointly held by `_latestPartial`
 *   and `runOutputData`. When a new snapshot replaces both slots, the prior
 *   partial is released.
 * - Exposes the latest partial via `executePreview()` so downstream image
 *   tasks can refresh their preview chains live as the image refines.
 * - Renders a placeholder GpuImage when no partial is available (no API call).
 * - Treats the task as not cacheable when `input.seed` is undefined, since
 *   image generation without a seed is non-deterministic.
 */

import type { TaskConfig, IExecutePreviewContext, IExecuteContext, StreamEvent, TaskOutput } from "@workglow/task-graph";
import type { GpuImage } from "@workglow/util/media";

import type { AiJobInput } from "../../job/AiJob";
import { StreamingAiTask } from "./StreamingAiTask";
import type { AiTaskInput } from "./AiTask";
import type { ModelConfig } from "../../model/ModelSchema";
import { ProviderUnsupportedFeatureError } from "../../errors/ImageGenerationErrors";
import { buildPlaceholderGpuImage } from "./__placeholderPreviewRenderer";

export interface AiImageOutput extends TaskOutput {
  image: GpuImage;
}

export interface AiImageInputBase extends AiTaskInput {
  prompt: string;
  seed?: number | undefined;
}

export class AiImageOutputTask<
  Input extends AiImageInputBase = AiImageInputBase,
  Config extends TaskConfig<Input> = TaskConfig<Input>,
> extends StreamingAiTask<Input, AiImageOutput, Config> {
  public static override type: string = "AiImageOutputTask";

  /** The most recent partial received from the provider stream, retained by this task. */
  protected _latestPartial: GpuImage | undefined = undefined;

  // --------------------------------------------------------------------
  // Cacheable: seed-aware
  // --------------------------------------------------------------------

  public override get cacheable(): boolean {
    const seed = (this.runInputData as { seed?: number } | undefined)?.seed;
    if (seed === undefined || seed === null) return false;
    return super.cacheable;
  }

  // --------------------------------------------------------------------
  // Worker-boundary materialization
  // --------------------------------------------------------------------

  /**
   * Converts a GpuImage to a structured-clone-safe data URI (base64 PNG) so
   * image/mask/additionalImages inputs survive the worker boundary when
   * EditImageTask runs via the queued execution strategy. GenerateImageTask
   * has no image inputs, so the guards below make this a no-op for it.
   *
   * On the worker side, providers call GpuImageFactory.fromDataUri() (already
   * used in e.g. OpenAI's decodeB64Png helper) or the imageEncodeHelper
   * wrappers accept a data URI string directly.
   */
  protected override async getJobInput(input: Input): Promise<AiJobInput<Input>> {
    const jobInput = await super.getJobInput(input);
    const taskInput = jobInput.taskInput as Record<string, unknown>;

    const toDataUri = async (img: GpuImage): Promise<string> => {
      const bytes = await img.encode("png");
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return `data:image/png;base64,${btoa(binary)}`;
    };

    const isGpuImage = (v: unknown): v is GpuImage =>
      v !== null && typeof v === "object" && typeof (v as GpuImage).encode === "function";

    if (isGpuImage(taskInput.image)) {
      taskInput.image = await toDataUri(taskInput.image);
    }
    if (isGpuImage(taskInput.mask)) {
      taskInput.mask = await toDataUri(taskInput.mask);
    }
    if (Array.isArray(taskInput.additionalImages)) {
      taskInput.additionalImages = await Promise.all(
        (taskInput.additionalImages as unknown[]).map((g) =>
          isGpuImage(g) ? toDataUri(g) : g,
        ),
      );
    }

    return jobInput;
  }

  // --------------------------------------------------------------------
  // Streaming accumulator
  // --------------------------------------------------------------------

  /**
   * Called by executeStream() (or directly by tests) for each partial image
   * delivered by the provider. Releases the prior `_latestPartial` (if any) and
   * stores the new image. Does NOT retain — the provider donates the reference,
   * which is then jointly held by `_latestPartial` and `runOutputData`. When a
   * subsequent snapshot replaces both slots, this method releases the prior.
   */
  protected ingestPartial(image: GpuImage): void {
    if (this._latestPartial !== undefined && this._latestPartial !== image) {
      this._latestPartial.release();
    }
    this._latestPartial = image;
  }

  /**
   * Transfers ownership of the latest partial out of the task, clearing the
   * internal slot WITHOUT releasing. Used to hand the final image to the
   * runner via the snapshot/finish path so the output port owns one ref.
   */
  protected takeFinalPartial(): GpuImage | undefined {
    const partial = this._latestPartial;
    this._latestPartial = undefined;
    return partial;
  }

  /**
   * Releases the latest partial without transferring. Used on abort/error.
   */
  protected discardPartial(): void {
    if (this._latestPartial !== undefined) {
      this._latestPartial.release();
      this._latestPartial = undefined;
    }
  }

  // --------------------------------------------------------------------
  // executeStream override
  // --------------------------------------------------------------------

  /**
   * Wraps the StreamingAiTask stream to track partial images via ingestPartial,
   * so executePreview() can surface the latest partial mid-stream and refcounts
   * are released correctly when partials are replaced.
   *
   * Providers yield `{ type: "snapshot", data: { image: GpuImage } }` for each
   * partial (and the final). On `finish`, we clear `_latestPartial` without
   * releasing — the final partial is owned by `runOutputData`.
   */
  override async *executeStream(
    input: Input,
    context: IExecuteContext,
  ): AsyncIterable<StreamEvent<AiImageOutput>> {
    try {
      for await (const event of super.executeStream(input, context)) {
        if (event.type === "snapshot") {
          const newImage = (event.data as AiImageOutput | undefined)?.image;
          if (newImage) {
            this.ingestPartial(newImage);
          }
          yield event;
        } else if (event.type === "finish") {
          this._latestPartial = undefined;
          yield event;
        } else {
          yield event;
        }
      }
    } catch (err) {
      // Release any retained partial on error so refcounts don't leak.
      // The normal completion path clears _latestPartial in the "finish" branch,
      // so this only fires when an exception escapes the loop.
      this.discardPartial();
      throw err;
    }
  }

  // --------------------------------------------------------------------
  // Preview
  // --------------------------------------------------------------------

  /**
   * Cheap UI preview path. NEVER calls the provider.
   * Order of preference:
   *   1. Live partial currently in `_latestPartial`.
   *   2. Last completed run's output (`runOutputData.image`).
   *   3. A placeholder GpuImage (cheap canvas/CPU image).
   *
   * Subclasses may override `renderPlaceholderPreview()` to produce a richer
   * placeholder (e.g., showing the prompt text).
   */
  override async executePreview(
    _input: Input,
    _context: IExecutePreviewContext,
  ): Promise<AiImageOutput | undefined> {
    if (this._latestPartial !== undefined) {
      this._latestPartial.retain();
      return { image: this._latestPartial };
    }
    const prior = (this.runOutputData as AiImageOutput | undefined)?.image;
    if (prior !== undefined) {
      prior.retain();
      return { image: prior };
    }
    return { image: this.renderPlaceholderPreview() };
  }

  /**
   * Builds a placeholder GpuImage for the graph editor. Default is a small
   * dark-gray fill. Subclasses may override to render the prompt text, etc.
   */
  protected renderPlaceholderPreview(): GpuImage {
    return buildPlaceholderGpuImage();
  }

  // --------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------

  /**
   * Called by the runner on abort. Releases any retained partial.
   * Errors during executeStream are handled inline via the catch block.
   */
  async cleanup(): Promise<void> {
    this.discardPartial();
  }

  // --------------------------------------------------------------------
  // Validation hook
  // --------------------------------------------------------------------

  /**
   * Hook for subclasses + providers to reject unsupported (model, input)
   * combinations before any worker dispatch. Subclasses call this from
   * their own validateInput() override after super.validateInput().
   *
   * Each provider implements the per-feature checks (e.g., Gemini + mask).
   * Throws ProviderUnsupportedFeatureError on rejection.
   */
  protected async validateProviderImageInput(input: Input): Promise<void> {
    const model = input.model as ModelConfig | string | undefined;
    if (!model || typeof model === "string") return;
    const provider = model.provider;
    const validator = AiImageOutputTask._providerValidators.get(provider);
    if (validator) {
      await validator(this.type, input as unknown as Record<string, unknown>, model);
    }
  }

  /**
   * Provider-side validators register here at provider load time. Each
   * validator inspects (taskType, input, model) and throws
   * ProviderUnsupportedFeatureError if the combination is invalid.
   */
  private static _providerValidators: Map<
    string,
    (taskType: string, input: Record<string, unknown>, model: ModelConfig) => Promise<void> | void
  > = new Map();

  public static registerProviderImageValidator(
    providerName: string,
    validator: (
      taskType: string,
      input: Record<string, unknown>,
      model: ModelConfig,
    ) => Promise<void> | void,
  ): void {
    AiImageOutputTask._providerValidators.set(providerName, validator);
  }

  public static unregisterProviderImageValidator(providerName: string): void {
    AiImageOutputTask._providerValidators.delete(providerName);
  }

  // Keep a reference to the unsupported error class so tests/providers don't
  // need to import it separately when overriding validators.
  public static readonly UnsupportedFeatureError = ProviderUnsupportedFeatureError;
}
