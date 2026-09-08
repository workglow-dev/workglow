/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  authorizeBearer,
  bearerTokenMatches,
  generateBearerToken,
  readBearerToken,
} from "../bearerAuth";

describe("generateBearerToken", () => {
  it("is url-safe, so it survives a JSON config, a shell line and a URL", () => {
    expect(generateBearerToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 20 }, generateBearerToken));
    expect(tokens.size).toBe(20);
  });
});

describe("readBearerToken", () => {
  it("reads the credential out of the header", () => {
    expect(readBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("accepts the scheme in any case, as RFC 9110 requires", () => {
    expect(readBearerToken("bearer abc123")).toBe("abc123");
    expect(readBearerToken("BEARER abc123")).toBe("abc123");
  });

  it("tolerates surrounding and separating whitespace", () => {
    expect(readBearerToken("  Bearer \t abc123  ")).toBe("abc123");
  });

  it("is undefined for another scheme, an empty credential or no header", () => {
    expect(readBearerToken("Basic abc123")).toBeUndefined();
    expect(readBearerToken("Bearer")).toBeUndefined();
    expect(readBearerToken("Bearer ")).toBeUndefined();
    expect(readBearerToken(undefined)).toBeUndefined();
  });
});

describe("bearerTokenMatches", () => {
  it("matches only the same token", () => {
    expect(bearerTokenMatches("abc", "abc")).toBe(true);
    expect(bearerTokenMatches("abc", "abd")).toBe(false);
  });

  it("rejects a prefix rather than throwing on the length mismatch", () => {
    expect(bearerTokenMatches("ab", "abc")).toBe(false);
    expect(bearerTokenMatches("abcd", "abc")).toBe(false);
  });
});

describe("authorizeBearer", () => {
  it("allows a request carrying the expected token", () => {
    expect(authorizeBearer("Bearer secret", "secret")).toBeUndefined();
  });

  it("names a missing token and an invalid one differently", () => {
    expect(authorizeBearer(undefined, "secret")).toMatchObject({
      status: 401,
      error: "missing bearer token",
    });
    expect(authorizeBearer("Bearer wrong", "secret")).toMatchObject({
      status: 401,
      error: "invalid bearer token",
    });
  });

  it("sends WWW-Authenticate, which is what tells a client to retry with a token", () => {
    expect(authorizeBearer(undefined, "secret")?.wwwAuthenticate).toContain("Bearer");
  });

  it("allows everything when the host turned authentication off", () => {
    // The decision belongs to whoever started the server: a request carrying a
    // wrong token must not be treated as a reason to start checking.
    expect(authorizeBearer(undefined, undefined)).toBeUndefined();
    expect(authorizeBearer("Bearer anything", undefined)).toBeUndefined();
  });
});
