/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISpan, ITelemetryProvider, SpanAttributes, SpanOptions } from "./ITelemetryProvider";
import { SpanStatusCode } from "./ITelemetryProvider";

interface SpanEvent {
  readonly name: string;
  readonly attributes: SpanAttributes | undefined;
}

/**
 * A span that prints a formatted summary to console when ended.
 */
class ConsoleSpan implements ISpan {
  private readonly name: string;
  private readonly startTime: number;
  private attributes: SpanAttributes = {};
  private readonly events: SpanEvent[] = [];
  private statusCode: SpanStatusCode = SpanStatusCode.UNSET;
  private statusMessage: string | undefined;

  constructor(name: string, options?: SpanOptions) {
    this.name = name;
    this.startTime = performance.now();
    if (options?.attributes) {
      this.attributes = { ...options.attributes };
    }
  }

  setAttributes(attributes: SpanAttributes): void {
    Object.assign(this.attributes, attributes);
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    this.events.push({ name, attributes });
  }

  setStatus(code: SpanStatusCode, message?: string): void {
    this.statusCode = code;
    this.statusMessage = message;
  }

  end(): void {
    const duration = performance.now() - this.startTime;
    const parts: string[] = [`[telemetry] ${this.name} (${duration.toFixed(2)}ms)`];

    const attrKeys = Object.keys(this.attributes);
    if (attrKeys.length > 0) {
      parts.push(`  attributes: ${JSON.stringify(this.attributes)}`);
    }

    for (const event of this.events) {
      const eventStr = event.attributes
        ? `${event.name} ${JSON.stringify(event.attributes)}`
        : event.name;
      parts.push(`  event: ${eventStr}`);
    }

    if (this.statusCode === SpanStatusCode.OK) {
      parts.push("  status: OK");
    } else if (this.statusCode === SpanStatusCode.ERROR) {
      parts.push(`  status: ERROR${this.statusMessage ? ` - ${this.statusMessage}` : ""}`);
    }

    const message = parts.join("\n");

    if (this.statusCode === SpanStatusCode.ERROR) {
      console.error(message);
    } else {
      console.debug(message);
    }
  }
}

/**
 * Lightweight telemetry provider that prints span summaries to console.
 * Useful for local development without requiring a full OpenTelemetry stack.
 */
export class ConsoleTelemetryProvider implements ITelemetryProvider {
  readonly isEnabled = true;

  startSpan(name: string, options?: SpanOptions): ISpan {
    return new ConsoleSpan(name, options);
  }
}
