#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lint budget guard.
 *
 * `.oxlintrc.json` stages several type-aware rules off because the tree does
 * not pass them yet. Off with no enforcement is an exemption: the counts lived
 * only in `//` comments, and three of the nine had already drifted upward with
 * nothing to notice. This runs those rules as warnings and fails when any one
 * grows past its committed number, so the debt can shrink and cannot grow.
 *
 * One oxlint pass with every budgeted rule enabled, not one pass per rule.
 * oxlint names the rule on each diagnostic, so the output buckets cleanly, and
 * the type-aware walk is ~100s that nine passes would pay nine times.
 *
 * Usage:
 *   bun scripts/lint-budget.ts             # check, exit 1 on growth
 *   bun scripts/lint-budget.ts --update    # rewrite the budget from what is measured
 *   bun scripts/lint-budget.ts --json      # emit measured counts as JSON
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLintBudget, countFindingsByRule, type LintBudget } from "./lib/lintBudget";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET_FILE = join(ROOT, "scripts", "lint-budget.json");
const TARGETS = ["packages", "providers", "examples"] as const;

function readBudget(): LintBudget {
  return JSON.parse(readFileSync(BUDGET_FILE, "utf8")) as LintBudget;
}

function measure(rules: readonly string[]): Record<string, number> {
  const args = ["--type-aware", ...rules.flatMap((rule) => ["-W", rule]), ...TARGETS];
  const run = spawnSync(join(ROOT, "node_modules", ".bin", "oxlint"), args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // oxlint exits non-zero when it reports; that is the expected path here, so
  // only a failure to run at all is fatal.
  if (run.error !== undefined) {
    console.error(`Could not run oxlint: ${run.error.message}`);
    process.exit(1);
  }
  return countFindingsByRule(`${run.stdout}\n${run.stderr}`);
}

function main(): void {
  const budget = readBudget();
  const rules = Object.keys(budget.rules);
  if (rules.length === 0) {
    console.log("No budgeted rules — nothing to check.");
    return;
  }

  const counts = measure(rules);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(counts, null, 2));
    return;
  }

  if (process.argv.includes("--update")) {
    const updated: Record<string, number> = {};
    for (const rule of rules) updated[rule] = counts[rule] ?? 0;
    writeFileSync(BUDGET_FILE, `${JSON.stringify({ rules: updated }, null, 2)}\n`);
    console.log(`Updated ${BUDGET_FILE}`);
    return;
  }

  const { regressions, improvements, clean, unbudgeted } = checkLintBudget(counts, budget);

  for (const { rule, budget: allowed, actual } of improvements) {
    console.log(`↓ ${rule}: ${actual} (budget ${allowed}) — lower it with --update`);
  }
  for (const rule of clean) {
    console.log(`✔ ${rule} reports nothing — ready to set to "error" in .oxlintrc.json`);
  }

  if (regressions.length === 0 && unbudgeted.length === 0) {
    console.log(`Lint budget holds across ${rules.length} staged-off rules.`);
    return;
  }

  for (const { rule, budget: allowed, actual } of regressions) {
    console.error(`✖ ${rule}: ${actual} findings, budget ${allowed} (+${actual - allowed})`);
  }
  for (const { rule, actual } of unbudgeted) {
    console.error(`✖ ${rule}: ${actual} findings and no budget entry`);
  }
  console.error(
    `\n  These rules are staged off in .oxlintrc.json, which means their count may\n` +
      `  shrink and never grow. Fix the new findings, or run\n` +
      `  \`bun scripts/lint-budget.ts --update\` deliberately and say why.\n`
  );
  process.exit(1);
}

main();
