/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Affected tests calculator. Determines which tests need to run based on
 * changed files in git, using the package dependency graph and import scanning.
 *
 * Usage: bun scripts/affected-tests.ts [--base=main] [--list] [--json] [kinds...] [runners...]
 *
 * Options:
 *   --base=<ref>   Git ref to diff against (default: main)
 *   --list         Print affected test file paths, one per line
 *   --json         Print JSON output with affected packages and files
 *   --help         Show usage message
 *
 * Kinds:    unit, integration, end2end (default: all)
 * Runners:  bun, vitest (default: both)
 */

import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const TEST_BASE = join(ROOT, "packages/test/src/test");
const BINDING_BASE = join(ROOT, "packages/test/src/binding");

// ── Types ────────────────────────────────────────────────────────────────────

const KNOWN_KINDS = ["unit", "integration", "end2end"] as const;
type Kind = (typeof KNOWN_KINDS)[number];

const KNOWN_RUNNERS = ["bun", "vitest"] as const;
type Runner = (typeof KNOWN_RUNNERS)[number];

// ── Package dependency graph (dependents) ────────────────────────────────────
// Maps each package to its direct dependents (packages that depend on it).
// When package X changes, all its dependents are transitively affected.

const DEPENDENTS: Record<string, readonly string[]> = {
  "@workglow/util": [
    "@workglow/storage",
    "@workglow/job-queue",
    "@workglow/task-graph",
    "@workglow/tasks",
    "@workglow/knowledge-base",
    "@workglow/ai",
    "@workglow/ai-provider",
    "@workglow/debug",
  ],
  "@workglow/sqlite": ["@workglow/storage", "@workglow/knowledge-base"],
  "@workglow/storage": [
    "@workglow/job-queue",
    "@workglow/task-graph",
    "@workglow/tasks",
    "@workglow/knowledge-base",
    "@workglow/ai",
    "@workglow/ai-provider",
  ],
  "@workglow/job-queue": [
    "@workglow/task-graph",
    "@workglow/tasks",
    "@workglow/ai",
    "@workglow/ai-provider",
  ],
  "@workglow/task-graph": [
    "@workglow/tasks",
    "@workglow/ai",
    "@workglow/ai-provider",
    "@workglow/debug",
  ],
  "@workglow/tasks": [],
  "@workglow/knowledge-base": ["@workglow/ai"],
  "@workglow/ai": ["@workglow/ai-provider"],
  "@workglow/ai-provider": [],
  "@workglow/debug": [],
};

// Root-level files that, when changed, trigger all tests
const ROOT_CONFIG_PATTERNS = [
  "turbo.json",
  "tsconfig.json",
  "vitest.config.ts",
  "package.json",
  "bun.lock",
  ".github/",
];

// ── Git helpers ──────────────────────────────────────────────────────────────

function getChangedFiles(base: string): string[] {
  // Try three-dot diff first (branch comparison)
  let result = Bun.spawnSync(["git", "diff", "--name-only", `${base}...HEAD`], {
    cwd: ROOT,
  });

  if (result.exitCode !== 0) {
    // Fall back to two-dot diff (uncommitted or same-branch comparison)
    result = Bun.spawnSync(["git", "diff", "--name-only", base], {
      cwd: ROOT,
    });
  }

  if (result.exitCode !== 0) {
    console.error("Failed to get changed files from git");
    process.exit(1);
  }

  const output = result.stdout.toString().trim();
  if (output.length === 0) return [];
  return output.split("\n").filter((f) => f.length > 0);
}

// ── File → package mapping ───────────────────────────────────────────────────

function fileToPackage(filePath: string): string | undefined {
  const match = filePath.match(/^packages\/([^/]+)\//);
  if (!match) return undefined;
  const dirName = match[1];
  return dirName === "workglow" ? "workglow" : `@workglow/${dirName}`;
}

function isRootConfig(filePath: string): boolean {
  return ROOT_CONFIG_PATTERNS.some(
    (pattern) => filePath === pattern || filePath.startsWith(pattern)
  );
}

function isTestFile(filePath: string): boolean {
  return filePath.startsWith("packages/test/");
}

function isTestHelper(filePath: string): boolean {
  return (
    filePath.startsWith("packages/test/src/test/helpers/") ||
    filePath.startsWith("packages/test/src/binding/")
  );
}

// ── Transitive closure ───────────────────────────────────────────────────────

function getAffectedPackages(changedPackages: Set<string>): Set<string> {
  const affected = new Set(changedPackages);
  const queue = [...changedPackages];

  while (queue.length > 0) {
    const pkg = queue.pop()!;
    const deps = DEPENDENTS[pkg];
    if (!deps) continue;
    for (const dep of deps) {
      if (!affected.has(dep)) {
        affected.add(dep);
        queue.push(dep);
      }
    }
  }

  return affected;
}

// ── Import scanning ─────────────────────────────────────────────────────────

const IMPORT_RE = /from\s+["']@workglow\/([^/"']+)["']/g;

function extractWorkglowImports(filePath: string): Set<string> {
  const packages = new Set<string>();
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const match of content.matchAll(IMPORT_RE)) {
      packages.add(`@workglow/${match[1]}`);
    }
  } catch {
    // File might not exist or be unreadable
  }
  return packages;
}

// Pre-scan binding files to know which packages they pull in
function scanBindingPackages(): Map<string, Set<string>> {
  const bindingMap = new Map<string, Set<string>>();
  const glob = new Bun.Glob("*.ts");
  for (const file of glob.scanSync({ cwd: BINDING_BASE, absolute: true, onlyFiles: true })) {
    bindingMap.set(file, extractWorkglowImports(file));
  }
  return bindingMap;
}

const BINDING_IMPORT_RE = /from\s+["'](?:\.\.\/)*binding\/([^"']+)["']/g;
const HELPER_IMPORT_RE = /from\s+["'](?:\.\.\/)*helpers\/([^"']+)["']/g;

function getTestDependencies(
  testFilePath: string,
  bindingPackages: Map<string, Set<string>>
): Set<string> {
  const packages = extractWorkglowImports(testFilePath);

  // Also check if the test imports any binding files
  try {
    const content = readFileSync(testFilePath, "utf-8");

    for (const match of content.matchAll(BINDING_IMPORT_RE)) {
      const bindingName = match[1].replace(/\.ts$/, "");
      const bindingPath = join(BINDING_BASE, `${bindingName}.ts`);
      const bindingPkgs = bindingPackages.get(bindingPath);
      if (bindingPkgs) {
        for (const pkg of bindingPkgs) {
          packages.add(pkg);
        }
      }
    }
  } catch {
    // Ignore read errors
  }

  return packages;
}

// ── Test file collection ─────────────────────────────────────────────────────

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

function collectAllTestFiles(kinds: readonly Kind[]): string[] {
  const glob = new Bun.Glob("**/*.test.ts");
  const files: string[] = [];
  for (const file of glob.scanSync({ cwd: TEST_BASE, absolute: true, onlyFiles: true })) {
    if (matchesKind(file, kinds)) {
      files.push(file);
    }
  }
  return files;
}

// ── Runners ──────────────────────────────────────────────────────────────────

async function runBunTest(files: string[]): Promise<number> {
  const proc = Bun.spawn(["bun", "test", ...files], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return proc.exited;
}

async function runVitest(files: string[]): Promise<number> {
  const relFiles = files.map((f) => relative(ROOT, f));
  const args = ["npx", "vitest", "run", ...relFiles];
  if (process.env.CI) {
    args.push("--coverage");
  }
  const proc = Bun.spawn(args, {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return proc.exited;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`Usage: bun scripts/affected-tests.ts [options] [kinds...] [runners...]

Determines which tests are affected by changed files and runs them.

Options:
  --base=<ref>   Git ref to diff against (default: main)
  --list         Print affected test file paths only
  --json         Print JSON with affected packages and test files
  --help         Show this message

Kinds:    ${KNOWN_KINDS.join(", ")} (default: all)
Runners:  ${KNOWN_RUNNERS.join(", ")} (default: both)

Examples:
  bun scripts/affected-tests.ts                          # Run affected tests vs main
  bun scripts/affected-tests.ts --base=HEAD~3            # Compare against 3 commits ago
  bun scripts/affected-tests.ts --list                   # List affected test files
  bun scripts/affected-tests.ts --json                   # JSON output
  bun scripts/affected-tests.ts unit                     # Only affected unit tests
  bun scripts/affected-tests.ts --base=develop vitest    # Run with vitest against develop
`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

if (rawArgs.includes("--help")) {
  showHelp();
  process.exit(0);
}

// Parse args
let base = "main";
let listMode = false;
let jsonMode = false;
const kinds: Kind[] = [];
const runners: Runner[] = [];
const unknown: string[] = [];

for (const arg of rawArgs) {
  if (arg.startsWith("--base=")) {
    base = arg.slice("--base=".length);
  } else if (arg === "--list") {
    listMode = true;
  } else if (arg === "--json") {
    jsonMode = true;
  } else if ((KNOWN_KINDS as readonly string[]).includes(arg)) {
    kinds.push(arg as Kind);
  } else if ((KNOWN_RUNNERS as readonly string[]).includes(arg)) {
    runners.push(arg as Runner);
  } else {
    unknown.push(arg);
  }
}

if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(", ")}`);
  process.exit(1);
}

// Step 1: Get changed files
const changedFiles = getChangedFiles(base);

if (changedFiles.length === 0) {
  console.log("No changed files detected.");
  process.exit(0);
}

// Step 2: Check for root config changes (run all tests)
const rootConfigChanged = changedFiles.some(isRootConfig);

// Step 3: Map changed files to packages
const changedPackages = new Set<string>();
const changedTestFiles = new Set<string>();
let helperChanged = false;

for (const file of changedFiles) {
  if (isTestHelper(file)) {
    helperChanged = true;
  } else if (isTestFile(file) && file.endsWith(".test.ts")) {
    changedTestFiles.add(join(ROOT, file));
  } else {
    const pkg = fileToPackage(file);
    if (pkg && pkg !== "workglow" && pkg !== "@workglow/test") {
      changedPackages.add(pkg);
    }
  }
}

// Step 4: Get transitively affected packages
const affectedPackages = getAffectedPackages(changedPackages);

// Step 5: Determine affected test files
const runAll = rootConfigChanged || helperChanged;
const allTestFiles = collectAllTestFiles(kinds);
let affectedTests: string[];

if (runAll) {
  affectedTests = allTestFiles;
} else {
  // Pre-scan bindings
  const bindingPackages = scanBindingPackages();

  // Scan each test file's imports
  affectedTests = allTestFiles.filter((testFile) => {
    // Always include directly changed test files
    if (changedTestFiles.has(testFile)) return true;

    // Check if the test imports any affected package
    const testDeps = getTestDependencies(testFile, bindingPackages);
    for (const dep of testDeps) {
      if (affectedPackages.has(dep)) return true;
    }
    return false;
  });

  // Also include changed test files that might not match the kind filter
  // (they were explicitly changed, so include them regardless)
  for (const changedTest of changedTestFiles) {
    if (!affectedTests.includes(changedTest) && allTestFiles.includes(changedTest)) {
      affectedTests.push(changedTest);
    }
  }
}

// Step 6: Output
if (jsonMode) {
  console.log(
    JSON.stringify(
      {
        base,
        changedFiles: changedFiles.length,
        changedPackages: [...changedPackages].sort(),
        affectedPackages: [...affectedPackages].sort(),
        runAll,
        affectedTests: affectedTests.map((f) => relative(ROOT, f)).sort(),
      },
      null,
      2
    )
  );
  process.exit(0);
}

if (listMode) {
  for (const file of affectedTests.sort()) {
    console.log(relative(ROOT, file));
  }
  process.exit(0);
}

if (affectedTests.length === 0) {
  console.log("No affected tests found for the changed files.");
  process.exit(0);
}

const kindLabel = kinds.length > 0 ? kinds.join("+") : "all";
console.log(
  `\nRunning ${kindLabel} affected tests — ${affectedTests.length} file(s) (${affectedPackages.size} affected package(s))\n`
);

if (affectedPackages.size > 0) {
  console.log(`Affected packages: ${[...affectedPackages].sort().join(", ")}\n`);
}

// Step 7: Run tests
const runBun = runners.length === 0 || runners.includes("bun");
const runVi = runners.length === 0 || runners.includes("vitest");

if (runBun) {
  const code = await runBunTest(affectedTests);
  if (code !== 0) process.exit(code);
}

if (runVi) {
  const code = await runVitest(affectedTests);
  process.exit(code);
}
