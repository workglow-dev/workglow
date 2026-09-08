/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const workspaceRoots = ["packages", "providers"] as const;

/**
 * No `exports` entry anywhere in the monorepo carries a `"bun"` condition, so
 * Bun resolves the default `"import"` everywhere and loads the node build.
 *
 * Nothing was given up to get here. Both of the entries that used to qualify —
 * `@workglow/util`'s `"."` and `"./worker"` — existed for `Worker.bun.ts`,
 * which was byte-identical to `Worker.browser.ts`: Bun ran the web `Worker`
 * API while Node ran `node:worker_threads`. Bun implements worker threads over
 * the same primitive as its web `Worker`, so a thread spawned either way is
 * reachable through `parentPort`, and one `Worker.node.ts` now serves both.
 * `@workglow/sqlite`'s `./storage` had gone the same way earlier, when both
 * runtimes moved onto the shared `node:sqlite` driver.
 *
 * The browser keeps its own build for the one reason Bun never had: a static
 * `node:worker_threads` import cannot be bundled for it.
 *
 * This fixture is deliberately exact, so it fails in both directions: on any
 * `"bun"` condition added back, and — via the resolution test below — on
 * either util entry being pointed somewhere other than the node build.
 *
 * Changing it means changing prose too — the same rule is stated in
 * `.claude/CLAUDE.md` ("No `bun` export condition") and twice in
 * `docs/technical/19-build-system.md` (the "Standard Two-Target Pattern" rule
 * and the "Extended Pattern (util)" build table).
 * `docs/technical/18-multi-runtime-abstraction.md` describes the same split.
 */
const EXPECTED_BUN_CONDITIONS: readonly string[] = [];

interface ExportsNode {
  readonly [condition: string]: string | ExportsNode | undefined;
}

const isExportsNode = (value: unknown): value is ExportsNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasBunCondition = (node: unknown): boolean => {
  if (!isExportsNode(node)) return false;
  if (Object.prototype.hasOwnProperty.call(node, "bun")) return true;
  return Object.values(node).some((child) => hasBunCondition(child));
};

const collectBunConditions = (): string[] => {
  const found: string[] = [];
  for (const workspaceRoot of workspaceRoots) {
    const rootDir = join(repoRoot, workspaceRoot);
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(rootDir, entry.name, "package.json");
      let manifest: { name?: string; exports?: unknown };
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch {
        continue; // no package.json in this directory
      }
      const { name, exports } = manifest;
      if (typeof name !== "string" || !isExportsNode(exports)) continue;
      for (const [subpath, target] of Object.entries(exports)) {
        if (hasBunCondition(target)) found.push(`${name} ${subpath}`);
      }
    }
  }
  return found.sort();
};

describe("bun export conditions", () => {
  it("exist only where the Bun implementation genuinely differs", () => {
    expect(collectBunConditions()).toEqual([...EXPECTED_BUN_CONDITIONS]);
  });

  it("scans every workspace, so an empty result cannot pass vacuously", () => {
    const manifestCount = workspaceRoots.reduce((total, workspaceRoot) => {
      const rootDir = join(repoRoot, workspaceRoot);
      return (
        total +
        readdirSync(rootDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
      );
    }, 0);
    expect(manifestCount).toBeGreaterThan(20);
  });

  it("routes Bun to the node build on the entries that used to fork", () => {
    const utilExports = JSON.parse(
      readFileSync(join(repoRoot, "packages/util/package.json"), "utf8")
    ).exports;
    const sqliteExports = JSON.parse(
      readFileSync(join(repoRoot, "providers/sqlite/package.json"), "utf8")
    ).exports;

    // The inverse of the old assertions, kept rather than deleted: each entry
    // must carry NO `bun` condition and still resolve to the node build, which
    // is what makes Bun and Node share one worker implementation and one
    // `node:sqlite` driver. Dropping these with the conditions would leave the
    // whole point unpinned — a reintroduced bun branch would then only trip the
    // exact-set test above, with nothing saying which bundle Bun actually loads.
    expect(utilExports["."].bun).toBeUndefined();
    expect(utilExports["."].import).toBe("./dist/node.js");
    expect(utilExports["./worker"].bun).toBeUndefined();
    expect(utilExports["./worker"].import).toBe("./dist/worker-node.js");

    expect(sqliteExports["./storage"].bun).toBeUndefined();
    expect(sqliteExports["./storage"].import).toBe("./dist/storage/node.js");
  });

  it("keeps the browser build separate, which is the split that remains", () => {
    const utilExports = JSON.parse(
      readFileSync(join(repoRoot, "packages/util/package.json"), "utf8")
    ).exports;

    expect(utilExports["."].browser.import).toBe("./dist/browser.js");
    expect(utilExports["./worker"].browser.import).toBe("./dist/worker-browser.js");
  });
});
