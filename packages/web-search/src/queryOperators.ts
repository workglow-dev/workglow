/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isUsableDomain, normalizeDomain } from "./domainInput";

/**
 * Drops any entry {@link isUsableDomain} rejects — an empty normalization, or a
 * value carrying the grouping syntax this module emits, which would let
 * `"example.com) OR (site:elsewhere.com"` widen the very restriction the caller
 * asked to narrow.
 *
 * {@link WebSearchTask} refuses such an entry outright, so a run reaching here
 * has already been validated. This filter stays as the backstop that makes the
 * guarantee structural: nothing spliced into a query can restructure it,
 * whether or not a future call site remembered to validate first.
 */
function normalizeAll(domains: readonly string[] | undefined): string[] {
  return (domains ?? []).filter(isUsableDomain).map(normalizeDomain);
}

/**
 * Expresses a domain restriction as search-engine query operators, for a
 * provider whose API takes no domain list but whose engine understands `site:`.
 *
 * Several includes are OR-ed inside parentheses: appending them bare would make
 * the engine require every one of them at once, which no result can satisfy.
 */
export function applyDomainOperators(
  query: string,
  includeDomains: readonly string[] | undefined,
  excludeDomains: readonly string[] | undefined
): string {
  const includes = normalizeAll(includeDomains);
  const excludes = normalizeAll(excludeDomains);
  let result = query.trim();
  if (includes.length === 1) {
    result += ` site:${includes[0]}`;
  } else if (includes.length > 1) {
    result += ` (${includes.map((d) => `site:${d}`).join(" OR ")})`;
  }
  for (const domain of excludes) {
    result += ` -site:${domain}`;
  }
  return result;
}
