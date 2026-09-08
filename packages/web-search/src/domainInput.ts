/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { trimTrailingSlashes } from "./urlText";

/**
 * Characters that would let a value change the STRUCTURE of a query it is
 * spliced into rather than restrict it: whitespace separates one operator from
 * the next, and the parentheses and quotes are the grouping syntax
 * {@link applyDomainOperators} itself emits.
 *
 * None of these can appear in a host or a path prefix, so a value carrying one
 * is not a malformed domain — it is not a domain. There is nothing to rescue by
 * quoting it, and no portable `site:` quoting across engines to rescue it with.
 */
const UNSAFE_IN_QUERY_OPERATOR = /[\s()"']/;

/**
 * Reduces a caller-supplied domain to the bare host (plus any path prefix) that
 * a `site:` operator accepts. A scheme, a `www.` prefix, or a trailing slash
 * would each make the operator match nothing.
 */
export function normalizeDomain(domain: string): string {
  let value = domain.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.replace(/^www\./, "");
  value = trimTrailingSlashes(value);
  return value;
}

/**
 * Whether a domain survives normalization as something a filter can express.
 *
 * Judged on the NORMALIZED value, not the raw entry: `" https://a.com/ "` is a
 * perfectly good domain whose raw form carries whitespace, and rejecting it
 * would refuse input every provider accepts today.
 */
export function isUsableDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return normalized.length > 0 && !UNSAFE_IN_QUERY_OPERATOR.test(normalized);
}

/**
 * The caller's own entries, in their original spelling, that name no domain.
 * Reported unnormalized because the caller has to find them in the input they
 * wrote, not in the form this module reduced them to.
 */
export function unusableDomainEntries(domains: readonly string[] | undefined): string[] {
  return (domains ?? []).filter((d) => !isUsableDomain(d));
}
