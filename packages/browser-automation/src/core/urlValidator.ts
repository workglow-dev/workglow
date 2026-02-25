/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskConfigurationError } from "@workglow/task-graph";
import type { NavigationPolicy } from "./types";

/** Only these URL schemes are ever permitted for browser navigation. */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/**
 * Returns true if the hostname maps to a private, loopback, or link-local
 * address that should be blocked by default to prevent SSRF.
 *
 * Covers:
 *   - "localhost"
 *   - IPv4 loopback:    127.0.0.0/8
 *   - IPv4 private:     10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   - IPv4 link-local:  169.254.0.0/16  (includes AWS metadata 169.254.169.254)
 *   - IPv6 loopback:    ::1
 *   - IPv6 link-local:  fe80::/10
 *   - IPv6 unique-local: fc00::/7  (fc::/8 and fd::/8)
 */
function isPrivateHost(hostname: string): boolean {
  // Strip IPv6 brackets that some URL parsers leave in
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (h === "localhost") return true;

  // IPv6: loopback, link-local, unique-local
  if (h === "::1") return true;
  if (h.startsWith("fe80:")) return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;

  // IPv4: must be exactly four decimal octets
  const parts = h.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16  (link-local + AWS metadata)
  }

  return false;
}

/**
 * Returns true when `hostname` matches `pattern`.
 *  - Pattern without leading dot: exact match only  ("example.com" → "example.com")
 *  - Pattern with leading dot:    exact OR suffix    (".example.com" → "example.com", "sub.example.com")
 */
function hostMatches(hostname: string, pattern: string): boolean {
  if (pattern.startsWith(".")) {
    return hostname === pattern.slice(1) || hostname.endsWith(pattern);
  }
  return hostname === pattern;
}

/**
 * Validates a navigation URL against the given policy.
 * Throws `TaskConfigurationError` if the URL is not permitted.
 *
 * **Always enforced** (regardless of registered policy):
 *  - URL must be syntactically valid.
 *  - Only `http:` and `https:` schemes are allowed.
 *
 * **Default enforcement** (when `allowPrivateNetworkAccess` is not `true`):
 *  - Private, loopback, and link-local hosts are blocked.
 *
 * **Optional policy controls** (via NAVIGATION_POLICY service token):
 *  - `allowPrivateNetworkAccess: true`  — opt-in to private network access.
 *  - `allowedHosts`                     — restrict to an explicit allowlist.
 *  - `blockedHosts`                     — additional explicit blocklist.
 */
export function validateNavigationUrl(rawUrl: string, policy: NavigationPolicy): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new TaskConfigurationError(`Navigation blocked: invalid URL "${rawUrl}".`);
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new TaskConfigurationError(
      `Navigation blocked: scheme "${parsed.protocol}" is not allowed. ` +
        "Only http: and https: are permitted."
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  if (!policy.allowPrivateNetworkAccess && isPrivateHost(hostname)) {
    throw new TaskConfigurationError(
      `Navigation blocked: "${hostname}" resolves to a private or loopback address. ` +
        "Register a NavigationPolicy with allowPrivateNetworkAccess: true to allow this."
    );
  }

  if (policy.blockedHosts?.some((h) => hostMatches(hostname, h.toLowerCase()))) {
    throw new TaskConfigurationError(
      `Navigation blocked: "${hostname}" is in the blocked hosts list.`
    );
  }

  if (policy.allowedHosts && policy.allowedHosts.length > 0) {
    const allowed = policy.allowedHosts.some((h) => hostMatches(hostname, h.toLowerCase()));
    if (!allowed) {
      throw new TaskConfigurationError(
        `Navigation blocked: "${hostname}" is not in the allowed hosts list.`
      );
    }
  }
}
