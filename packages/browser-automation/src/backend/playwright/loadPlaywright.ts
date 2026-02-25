/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

let cachedPlaywright: typeof import("playwright") | undefined;

/**
 * Lazily loads the `playwright` module.
 * Throws a descriptive error if the optional peer dependency is not installed.
 */
export async function loadPlaywright(): Promise<typeof import("playwright")> {
  if (cachedPlaywright) return cachedPlaywright;
  try {
    cachedPlaywright = await import("playwright");
    return cachedPlaywright;
  } catch {
    throw new Error(
      "Playwright is required for browser automation but was not found. " +
        "Install it with: bun add playwright && bunx playwright install"
    );
  }
}
