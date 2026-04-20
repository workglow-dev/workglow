/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Runtime duck-typing check that a value looks like a Supabase client.
 * The `unknown` parameter in our Supabase storage constructors trades
 * compile-time version pinning for flexibility across minor versions of
 * @supabase/supabase-js; this helper restores a fail-fast runtime guard
 * so a wrongly-shaped client throws at construction rather than at the
 * first query.
 */
export function assertSupabaseLike(client: unknown): SupabaseClient {
  const c = client as { from?: unknown; rpc?: unknown } | null | undefined;
  if (!c || typeof c.from !== "function" || typeof c.rpc !== "function") {
    throw new TypeError(
      "Expected a Supabase client (object with .from() and .rpc() methods)."
    );
  }
  return client as SupabaseClient;
}
