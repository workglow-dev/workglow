/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Attributes that can be attached to a span.
 * Values follow OpenTelemetry attribute value conventions.
 */
export type SpanAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Status codes for a span, matching OpenTelemetry conventions.
 */
export const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;
export type SpanStatusCode = (typeof SpanStatusCode)[keyof typeof SpanStatusCode];

/**
 * A handle to an active span. Call `end()` when the operation completes.
 */
export interface ISpan {
  /** Record key-value attributes on the span. */
  setAttributes(attributes: SpanAttributes): void;
  /** Record a timestamped event (log) on the span. */
  addEvent(name: string, attributes?: SpanAttributes): void;
  /** Mark the span with a status code and optional message. */
  setStatus(code: SpanStatusCode, message?: string): void;
  /** End the span. Must be called exactly once. */
  end(): void;
}

/**
 * Options for starting a new span.
 */
export interface SpanOptions {
  /** Attributes to set on the span at creation. */
  attributes?: SpanAttributes;
}

/**
 * Provider interface for telemetry instrumentation.
 * Implementations bridge to OpenTelemetry, Datadog, or any APM backend.
 *
 * Register a provider via {@link setTelemetryProvider} to enable tracing
 * across task-graph, job-queue, and ai-provider packages.
 */
export interface ITelemetryProvider {
  /**
   * Start a new span for the given operation.
   *
   * @param name - Dot-separated operation name, e.g. `"workglow.task.run"`
   * @param options - Optional span configuration
   * @returns A handle to the active span
   */
  startSpan(name: string, options?: SpanOptions): ISpan;

  /**
   * Whether the provider is actively collecting traces.
   * When false, callers may skip expensive attribute computation.
   */
  readonly isEnabled: boolean;
}
