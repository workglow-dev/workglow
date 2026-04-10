/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * SSRF-aware fetch wrapper.
 *
 * The browser default performs a static URL classification only and delegates
 * to `globalThis.fetch`. The Node/Bun entrypoints register a server-side
 * implementation (see `SafeFetch.server.ts`) that additionally resolves DNS,
 * classifies every resolved address, and pins the connection to a specific
 * IP via an undici Agent — this closes the DNS-rebinding gap.
 *
 * Callers pass `allowPrivate` to opt into private/loopback targets. The task
 * layer sets this flag based on whether the task has been granted the
 * `network:private` entitlement (via its dynamic `entitlements()`).
 */

import { PermanentJobError } from "@workglow/job-queue";
import { classifyUrl } from "./UrlClassifier";

// ========================================================================
// Types
// ========================================================================

export interface SafeFetchOptions extends RequestInit {
  /**
   * When true, requests to private/loopback/link-local/metadata hosts are
   * permitted. When false (default), such requests throw PermanentJobError
   * both at URL-classification time and (in the server impl) at DNS-resolution
   * time — defeating DNS rebinding.
   */
  readonly allowPrivate?: boolean;
}

export type SafeFetchFn = (url: string, options: SafeFetchOptions) => Promise<Response>;

// ========================================================================
// Default browser implementation
// ========================================================================

/**
 * Browser-safe default implementation. Classifies the URL statically and
 * delegates to `globalThis.fetch`. The browser controls DNS itself, so we
 * cannot defeat DNS rebinding from browser code — callers must rely on the
 * browser sandbox (CORS, same-origin) as the second layer.
 */
async function defaultSafeFetch(url: string, options: SafeFetchOptions): Promise<Response> {
  const classification = classifyUrl(url);
  if (classification.kind === "invalid") {
    throw new PermanentJobError(`Refusing to fetch invalid URL: ${classification.reason}`);
  }
  if (classification.kind === "private" && !options.allowPrivate) {
    throw new PermanentJobError(
      `Refusing to fetch private/internal URL ${url}: ${classification.reason}. ` +
        `Grant the 'network:private' entitlement to allow this request.`
    );
  }
  const { allowPrivate: _omit, ...fetchOptions } = options;
  return globalThis.fetch(url, fetchOptions);
}

// ========================================================================
// Registration
// ========================================================================

let currentImpl: SafeFetchFn = defaultSafeFetch;

/**
 * Register a platform-specific SafeFetch implementation. The Node/Bun
 * entrypoints call this at module load time to install the DNS-resolving,
 * connection-pinning implementation from `SafeFetch.server.ts`.
 */
export function registerSafeFetch(fn: SafeFetchFn): void {
  currentImpl = fn;
}

/**
 * SSRF-aware fetch. See {@link SafeFetchOptions} for the `allowPrivate` flag.
 * Throws `PermanentJobError` if the URL targets a private host without
 * permission, or (server impl) if DNS resolves to a private IP.
 */
export function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  return currentImpl(url, options);
}
