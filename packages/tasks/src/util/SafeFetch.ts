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

const MAX_REDIRECT_HOPS = 20;

function assertAllowedUrl(url: string, allowPrivate: boolean | undefined): void {
  const classification = classifyUrl(url);
  if (classification.kind === "invalid") {
    throw new PermanentJobError(`Refusing to fetch invalid URL: ${classification.reason}`);
  }
  if (classification.kind === "private" && !allowPrivate) {
    throw new PermanentJobError(
      `Refusing to fetch private/internal URL ${url}: ${classification.reason}. ` +
        `Grant the 'network:private' entitlement to allow this request.`
    );
  }
}

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 || status === 302 || status === 303 || status === 307 || status === 308
  );
}

/**
 * Browser-safe default implementation. Classifies the URL statically and
 * delegates to `globalThis.fetch`. Each redirect hop is validated before
 * following so a public URL cannot redirect to a private host.
 *
 * The browser controls DNS itself, so we cannot defeat DNS rebinding from
 * browser code — callers must rely on the browser sandbox (CORS,
 * same-origin) as the second layer.
 */
async function defaultSafeFetch(url: string, options: SafeFetchOptions): Promise<Response> {
  const requestedRedirectMode = options.redirect ?? "follow";
  const { allowPrivate, redirect: _redirect, ...fetchOptions } = options;

  let currentUrl = url;
  for (let hops = 0; hops <= MAX_REDIRECT_HOPS; hops += 1) {
    assertAllowedUrl(currentUrl, allowPrivate);

    const response = await globalThis.fetch(currentUrl, {
      ...fetchOptions,
      redirect: "manual",
    });

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    if (requestedRedirectMode === "manual") {
      return response;
    }

    if (requestedRedirectMode === "error") {
      throw new TypeError(
        `Fetch for ${currentUrl} failed because redirect mode was set to 'error'.`
      );
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new PermanentJobError(
        `Refusing to follow redirect from ${currentUrl}: missing Location header.`
      );
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new PermanentJobError(`Refusing to fetch ${url}: too many redirects.`);
}

// ========================================================================
// Registration
// ========================================================================

let currentImpl: SafeFetchFn = defaultSafeFetch;

/**
 * Register a platform-specific SafeFetch implementation. The Node/Bun
 * entrypoints call this at module load time to install the DNS-resolving,
 * connection-pinning implementation from `SafeFetch.server.ts`.
 *
 * Returns the previously registered implementation so callers can safely
 * restore it after a temporary override.
 */
export function registerSafeFetch(fn: SafeFetchFn): SafeFetchFn {
  const previousImpl = currentImpl;
  currentImpl = fn;
  return previousImpl;
}

/**
 * Returns the currently registered SafeFetch implementation.
 */
export function getSafeFetchImpl(): SafeFetchFn {
  return currentImpl;
}

/**
 * Restores the default browser-safe implementation.
 */
export function resetSafeFetch(): void {
  currentImpl = defaultSafeFetch;
}

/**
 * SSRF-aware fetch. See {@link SafeFetchOptions} for the `allowPrivate` flag.
 * Throws `PermanentJobError` if the URL targets a private host without
 * permission, or (server impl) if DNS resolves to a private IP.
 */
export function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  return currentImpl(url, options);
}
