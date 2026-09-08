/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes, timingSafeEqual } from "node:crypto";

/** Bytes of entropy behind a generated token. 32 is what a session key wants. */
const TOKEN_BYTES = 32;

/**
 * A fresh bearer token for one server process.
 *
 * base64url rather than hex or a UUID: it survives being pasted into a JSON
 * client config, a shell one-liner and a URL unescaped, which is the whole
 * journey this value makes.
 */
export function generateBearerToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** The only auth scheme this server answers to, lower-cased for comparison. */
const BEARER_SCHEME = "bearer";

/** A bare character class, so scanning for one cannot backtrack. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * The credential out of an `Authorization` header, or `undefined` when the
 * header is absent or names another scheme.
 *
 * The scheme is matched case-insensitively because RFC 9110 says it is; a
 * client sending `bearer` is not making a mistake worth a 401 nobody can read.
 *
 * Spelled out rather than as `/^bearer[ \t]+(.+)$/i`, which is quadratic on
 * this input: the separator run and the credential can both match a tab, so a
 * header the pattern ultimately rejects is re-split at every position between
 * them. Measured at 380ms for a 16 KB header — which is exactly Node's default
 * header cap — against microseconds here.
 */
export function readBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (value.length <= BEARER_SCHEME.length) return undefined;
  if (value.slice(0, BEARER_SCHEME.length).toLowerCase() !== BEARER_SCHEME) return undefined;
  // RFC 9110 puts at least one space or tab between the scheme and the
  // credential, so `Bearerabc` names no scheme this server knows.
  const separator = value[BEARER_SCHEME.length];
  if (separator !== " " && separator !== "\t") return undefined;
  const credential = value.slice(BEARER_SCHEME.length + 1);
  // The `.` this replaced never matched a line terminator, so a header
  // carrying one named no credential. A header value cannot legally hold one
  // anyway; rejecting keeps the old reading rather than trimming it away.
  if (LINE_TERMINATOR.test(credential)) return undefined;
  const token = credential.trim();
  return token.length > 0 ? token : undefined;
}

/** Compares two tokens without leaking their common prefix through timing. */
export function bearerTokenMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface BearerAuthFailure {
  readonly status: 401;
  readonly error: string;
  /** Send as `WWW-Authenticate`, which is what tells a client to retry with a token. */
  readonly wwwAuthenticate: string;
}

/**
 * Checks one request's `Authorization` header against the expected token.
 *
 * `expected` of `undefined` means the host turned authentication off, and this
 * returns `undefined` (allowed) without looking at the header at all — the
 * decision to run unauthenticated belongs to whoever started the server, not to
 * whoever sends the next request.
 */
export function authorizeBearer(
  header: string | undefined,
  expected: string | undefined
): BearerAuthFailure | undefined {
  if (expected === undefined) return undefined;
  const provided = readBearerToken(header);
  if (provided === undefined) {
    return {
      status: 401,
      error: "missing bearer token",
      wwwAuthenticate: 'Bearer error="invalid_request"',
    };
  }
  if (!bearerTokenMatches(provided, expected)) {
    return {
      status: 401,
      error: "invalid bearer token",
      wwwAuthenticate: 'Bearer error="invalid_token"',
    };
  }
  return undefined;
}
