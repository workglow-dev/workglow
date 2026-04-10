/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server-side SafeFetch implementation.
 *
 * Combines:
 *   1. Static URL classification (shared with the browser impl).
 *   2. DNS pre-resolution of every A/AAAA record for the hostname.
 *   3. Rejection if any resolved address is private/link-local/metadata
 *      (unless `allowPrivate` is set).
 *   4. Connection pinning via an undici Agent whose `connect.lookup` hook
 *      returns the pre-resolved IP — this prevents a second DNS lookup at
 *      connect time and defeats DNS rebinding (TOCTOU).
 *
 * Registered at module load from `packages/tasks/src/node.ts` and
 * `packages/tasks/src/bun.ts` via `registerSafeFetch`.
 */

import { PermanentJobError } from "@workglow/job-queue";
import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import { classifyIpLiteral, classifyUrl } from "./UrlClassifier";
import { registerSafeFetch, type SafeFetchFn, type SafeFetchOptions } from "./SafeFetch";

interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/**
 * Resolve the hostname to all A/AAAA records. Rejects with a PermanentJobError
 * on any DNS failure (NXDOMAIN, SERVFAIL, etc.) so the caller doesn't fall
 * back to letting the OS resolver re-run at connect time.
 */
async function resolveAll(hostname: string): Promise<readonly ResolvedAddress[]> {
  try {
    const addrs = await dnsLookup(hostname, { all: true, verbatim: true });
    if (!Array.isArray(addrs) || addrs.length === 0) {
      throw new PermanentJobError(`DNS lookup returned no addresses for '${hostname}'`);
    }
    return addrs.map((a) => ({ address: a.address, family: a.family as 4 | 6 }));
  } catch (err) {
    if (err instanceof PermanentJobError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new PermanentJobError(`DNS lookup failed for '${hostname}': ${msg}`);
  }
}

function isLiteralHost(host: string): boolean {
  // Literal IPv4 if it looks numeric/dotted, or IPv6 if it contains a colon.
  if (host.includes(":")) return true;
  return /^[0-9a-fA-FxX.]+$/.test(host);
}

export const serverSafeFetch: SafeFetchFn = async (url, options) => {
  const opts: SafeFetchOptions = options ?? {};
  const classification = classifyUrl(url);
  if (classification.kind === "invalid") {
    throw new PermanentJobError(`Refusing to fetch invalid URL: ${classification.reason}`);
  }
  if (classification.kind === "private" && !opts.allowPrivate) {
    throw new PermanentJobError(
      `Refusing to fetch private/internal URL ${url}: ${classification.reason}. ` +
        `Grant the 'network:private' entitlement to allow this request.`
    );
  }

  const parsed = new URL(url);
  const host = classification.host ?? parsed.hostname.toLowerCase();

  let pinned: ResolvedAddress;

  if (isLiteralHost(host) && classification.literalIp !== undefined) {
    // Host is already an IP literal — no DNS lookup needed. Classification
    // already decided whether it's allowed.
    pinned = {
      address: classification.literalIp,
      family: classification.literalIp.includes(":") ? 6 : 4,
    };
  } else {
    // Resolve DNS and reject on any private/rebinding result.
    const addrs = await resolveAll(host);
    for (const addr of addrs) {
      const ipClass = classifyIpLiteral(addr.address);
      if (ipClass === undefined) {
        throw new PermanentJobError(
          `DNS resolved '${host}' to an unparseable address '${addr.address}'`
        );
      }
      if (ipClass.kind === "private" && !opts.allowPrivate) {
        throw new PermanentJobError(
          `Refusing to fetch ${url}: hostname '${host}' resolved to private address ` +
            `${addr.address} (${ipClass.reason}). This may indicate DNS rebinding. ` +
            `Grant the 'network:private' entitlement to allow this request.`
        );
      }
    }
    pinned = addrs[0]!;
  }

  // Pin the TCP connection to the pre-resolved IP. Undici will call our
  // `lookup` hook during connect and receive back the exact address we've
  // already validated, so a concurrent DNS change cannot redirect the
  // request between our check and the socket open.
  const pinnedAddress = pinned.address;
  const pinnedFamily = pinned.family;
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, _lookupOptions, cb) => {
        cb(null, pinnedAddress, pinnedFamily);
      },
    },
  });

  const { allowPrivate: _omit, ...fetchInit } = opts;
  try {
    const response = await undiciFetch(url, {
      ...(fetchInit as Parameters<typeof undiciFetch>[1]),
      dispatcher,
    });
    // Undici's Response is structurally compatible with the global Response.
    return response as unknown as Response;
  } catch (err) {
    // Make sure the dispatcher is closed promptly on failure.
    await dispatcher.close().catch(() => {});
    throw err;
  }
};

// Register at module load — the Node/Bun entrypoint re-exports this file
// which triggers registration.
registerSafeFetch(serverSafeFetch);
