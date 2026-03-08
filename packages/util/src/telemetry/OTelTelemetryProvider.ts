/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISpan, ITelemetryProvider, SpanAttributes, SpanOptions } from "./ITelemetryProvider";
import { SpanStatusCode } from "./ITelemetryProvider";

/**
 * Minimal subset of the OpenTelemetry `Tracer` interface that we depend on.
 * This avoids a hard dependency on `@opentelemetry/api` while still being
 * fully compatible with `trace.getTracer()`.
 */
export interface OTelTracer {
  startSpan(name: string, options?: any, context?: any): OTelSpan;
}

/**
 * Minimal subset of the OpenTelemetry `Span` interface.
 */
export interface OTelSpan {
  setAttribute(key: string, value: string | number | boolean): any;
  addEvent(name: string, attributes?: Record<string, any>): any;
  setStatus(status: { code: number; message?: string }): any;
  end(): void;
}

/** Maps our SpanStatusCode to the OTel StatusCode numeric values. */
const STATUS_MAP: Record<SpanStatusCode, number> = {
  [SpanStatusCode.UNSET]: 0,
  [SpanStatusCode.OK]: 1,
  [SpanStatusCode.ERROR]: 2,
};

/**
 * Wraps an OTel Span to implement our ISpan interface.
 */
class OTelSpanWrapper implements ISpan {
  constructor(private readonly otelSpan: OTelSpan) {}

  setAttributes(attributes: SpanAttributes): void {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        this.otelSpan.setAttribute(key, value);
      }
    }
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    const filtered = attributes
      ? Object.fromEntries(Object.entries(attributes).filter(([, v]) => v !== undefined))
      : undefined;
    this.otelSpan.addEvent(name, filtered);
  }

  setStatus(code: SpanStatusCode, message?: string): void {
    this.otelSpan.setStatus({ code: STATUS_MAP[code], message });
  }

  end(): void {
    this.otelSpan.end();
  }
}

/**
 * Telemetry provider backed by a real OpenTelemetry tracer.
 *
 * @example
 * ```ts
 * import { trace } from "@opentelemetry/api";
 * import { OTelTelemetryProvider, setTelemetryProvider } from "@workglow/util";
 *
 * const tracer = trace.getTracer("my-app", "1.0.0");
 * setTelemetryProvider(new OTelTelemetryProvider(tracer));
 * ```
 */
export class OTelTelemetryProvider implements ITelemetryProvider {
  readonly isEnabled = true;

  constructor(private readonly tracer: OTelTracer) {}

  startSpan(name: string, options?: SpanOptions): ISpan {
    const otelOptions: Record<string, any> = {};
    if (options?.attributes) {
      otelOptions.attributes = Object.fromEntries(
        Object.entries(options.attributes).filter(([, v]) => v !== undefined)
      );
    }
    const otelSpan = this.tracer.startSpan(name, otelOptions);
    return new OTelSpanWrapper(otelSpan);
  }
}
