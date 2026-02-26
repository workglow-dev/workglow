/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test runner script. Supports filtering by kind and section.
 *
 * Usage: bun scripts/test.ts [kinds...] [sections...] [--bun-only] [--vitest-only] [--help]
 *
 * Kinds:    unit, integration, end2end (default: all)
 * Sections: graph, task, storage, queue, util, ai, provider, mcp, rag (default: all)
 */

import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const TEST_BASE = join(ROOT, "packages/test/src/test");

const KNOWN_KINDS = ["unit", "integration", "end2end"] as const;
type Kind = (typeof KNOWN_KINDS)[number];

const KNOWN_SECTIONS = [
  "graph",
  "task",
  "storage",
  "queue",
  "util",
  "ai",
  "provider",
  "mcp",
  "rag",
] as const;
type Section = (typeof KNOWN_SECTIONS)[number];

const SECTION_DIRS: Record<Section, string[]> = {
  graph: [
    join(TEST_BASE, "task-graph"),
    join(TEST_BASE, "task-graph-job-queue"),
    join(TEST_BASE, "task-graph-output-cache"),
    join(TEST_BASE, "task-graph-storage"),
  ],
  task: [join(TEST_BASE, "task")],
  storage: [
    join(TEST_BASE, "storage-kv"),
    join(TEST_BASE, "storage-tabular"),
    join(TEST_BASE, "storage-util"),
    join(TEST_BASE, "vector"),
  ],
  queue: [join(TEST_BASE, "job-queue")],
  util: [join(TEST_BASE, "util")],
  ai: [join(TEST_BASE, "ai-model")],
  provider: [join(TEST_BASE, "ai-provider")],
  mcp: [join(TEST_BASE, "mcp")],
  rag: [join(TEST_BASE, "rag")],
};

function showHelp(): void {
  console.log(`Usage: bun scripts/test.ts [kinds...] [sections...] [options]

Kinds:    ${KNOWN_KINDS.join(", ")} (default: all)
Sections: ${KNOWN_SECTIONS.join(", ")} (default: all)

Options:
  --help         Show this usage message
  --bun-only     Only run bun test (skip vitest)
  --vitest-only  Only run vitest (skip bun test)

Examples:
  bun scripts/test.ts                       # Run all tests
  bun scripts/test.ts unit                  # Run only unit tests
  bun scripts/test.ts integration           # Run only integration tests
  bun scripts/test.ts storage               # Run only storage tests
  bun scripts/test.ts storage unit          # Run only unit tests in storage dirs
  bun scripts/test.ts graph task unit       # Run unit tests in graph + task dirs
`);
}

function matchesKind(filePath: string, kinds: readonly Kind[]): boolean {
  if (kinds.length === 0) return true;
  const base = filePath.split("/").pop() ?? filePath;
  for (const kind of kinds) {
    if (kind === "unit" && !base.includes(".integration.") && !base.includes(".e2e.")) return true;
    if (kind === "integration" && base.includes(".integration.test.ts")) return true;
    if (kind === "end2end" && base.includes(".e2e.test.ts")) return true;
  }
  return false;
}

function collectFiles(dirs: string[], kinds: readonly Kind[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  const glob = new Bun.Glob("**/*.test.ts");
  for (const dir of dirs) {
    for (const file of glob.scanSync({ cwd: dir, absolute: true, onlyFiles: true })) {
      if (!seen.has(file) && matchesKind(file, kinds)) {
        seen.add(file);
        files.push(file);
      }
    }
  }
  return files;
}

async function runBunTest(files: string[]): Promise<number> {
  const proc = Bun.spawn(["bun", "test", ...files], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return proc.exited;
}

async function runVitest(files: string[]): Promise<number> {
  // Pass relative paths from root as positional args — vitest treats them as name filters
  const relFiles = files.map((f) => relative(ROOT, f));
  const proc = Bun.spawn(["npx", "vitest", "run", "--silent=true", ...relFiles], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return proc.exited;
}

// ── Parse args ────────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

if (rawArgs.includes("--help")) {
  showHelp();
  process.exit(0);
}

const KNOWN_RUNNERS = ["bun", "vitest"] as const;

const bunOnly = rawArgs.includes("bun");
const vitestOnly = rawArgs.includes("vitest");
const runners: (typeof KNOWN_RUNNERS)[number][] = [];
const kinds: Kind[] = [];
const sections: Section[] = [];
const unknown: string[] = [];

for (const arg of rawArgs) {
  if ((KNOWN_KINDS as readonly string[]).includes(arg)) {
    kinds.push(arg as Kind);
  } else if ((KNOWN_SECTIONS as readonly string[]).includes(arg)) {
    sections.push(arg as Section);
  } else if (KNOWN_RUNNERS.includes(arg as (typeof KNOWN_RUNNERS)[number])) {
    runners.push(arg as (typeof KNOWN_RUNNERS)[number]);
  } else {
    unknown.push(arg);
  }
}

if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(", ")}`);
  console.error(`Valid kinds:    ${KNOWN_KINDS.join(", ")}`);
  console.error(`Valid sections: ${KNOWN_SECTIONS.join(", ")}`);
  console.error(`Valid runners: ${KNOWN_RUNNERS.join(", ")}`);

  process.exit(1);
}

// ── Collect test files ────────────────────────────────────────────────────────

const dirs =
  sections.length > 0
    ? sections.flatMap((s) => SECTION_DIRS[s])
    : Object.values(SECTION_DIRS).flat();

const files = collectFiles(dirs, kinds);

if (files.length === 0) {
  const kindLabel = kinds.length > 0 ? kinds.join("+") : "all";
  const sectionLabel = sections.length > 0 ? sections.join("+") : "all";
  console.log(`No test files found for kind=${kindLabel} section=${sectionLabel}`);
  process.exit(0);
}

const kindLabel = kinds.length > 0 ? kinds.join("+") : "all";
const sectionLabel = sections.length > 0 ? sections.join("+") : "all";
console.log(
  `\nRunning ${kindLabel} tests in sections [${sectionLabel}] — ${files.length} file(s)\n`
);

// ── Execute ───────────────────────────────────────────────────────────────────

if (!vitestOnly) {
  const code = await runBunTest(files);
  if (code !== 0) process.exit(code);
}

if (!bunOnly) {
  const code = await runVitest(files);
  process.exit(code);
}
