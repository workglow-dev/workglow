/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkLintBudget, countFindingsByRule, type LintBudget } from "./lib/lintBudget";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BUDGET: LintBudget = {
  rules: { "typescript/no-base-to-string": 79, "typescript/no-misused-spread": 3 },
};

describe("checkLintBudget", () => {
  it("passes when every rule is at its budget", () => {
    const r = checkLintBudget(
      { "typescript/no-base-to-string": 79, "typescript/no-misused-spread": 3 },
      BUDGET
    );
    expect(r.regressions).toEqual([]);
    expect(r.unbudgeted).toEqual([]);
  });

  it("fails on growth", () => {
    const r = checkLintBudget({ "typescript/no-base-to-string": 80 }, BUDGET);
    expect(r.regressions).toEqual([
      { rule: "typescript/no-base-to-string", budget: 79, actual: 80 },
    ]);
  });

  it("reports shrinkage without failing, so the number gets lowered deliberately", () => {
    const r = checkLintBudget({ "typescript/no-base-to-string": 70 }, BUDGET);
    expect(r.regressions).toEqual([]);
    expect(r.improvements).toContainEqual({
      rule: "typescript/no-base-to-string",
      budget: 79,
      actual: 70,
    });
  });

  it("names a rule that has reached zero as ready to retire", () => {
    const r = checkLintBudget({ "typescript/no-base-to-string": 79 }, BUDGET);
    expect(r.clean).toEqual(["typescript/no-misused-spread"]);
  });

  it("fails on a rule the budget does not carry", () => {
    // Staging a rule off in .oxlintrc.json and forgetting the budget entry
    // would otherwise buy an exemption with no count attached — which is the
    // state the budget replaces.
    const r = checkLintBudget({ "typescript/no-unsafe-argument": 12 }, BUDGET);
    expect(r.unbudgeted).toEqual([
      { rule: "typescript/no-unsafe-argument", budget: 0, actual: 12 },
    ]);
  });
});

describe("countFindingsByRule", () => {
  it("buckets oxlint's real output shape by rule", () => {
    const output = [
      "packages/ai/src/a.ts:12:7: warning typescript(no-base-to-string): Invalid type of template literal expression.",
      "packages/ai/src/b.ts:3:1: warning typescript(no-base-to-string): Invalid type of template literal expression.",
      "packages/util/src/c.ts:9:2: warning typescript(await-thenable): Unexpected await of a non-Promise.",
      "",
      "Found 3 warnings.",
    ].join("\n");

    expect(countFindingsByRule(output)).toEqual({
      "typescript/no-base-to-string": 2,
      "typescript/await-thenable": 1,
    });
  });

  it("counts nothing in a clean run", () => {
    expect(countFindingsByRule("")).toEqual({});
  });

  it("does not count a summary line as a finding", () => {
    expect(countFindingsByRule("Found 0 warnings and 0 errors.")).toEqual({});
  });
});

/**
 * The budget and `.oxlintrc.json` are two lists of the same rules. A rule
 * staged off with no budget entry is an exemption with no count; a budget entry
 * for a rule that is on measures nothing. Either drift makes the ratchet a
 * decoration.
 */
describe("the budget and the config agree", () => {
  const budget = JSON.parse(
    readFileSync(join(ROOT, "scripts", "lint-budget.json"), "utf8")
  ) as LintBudget;
  const config = readFileSync(join(ROOT, ".oxlintrc.json"), "utf8");

  it.each(Object.keys(budget.rules))("%s is staged off in .oxlintrc.json", (rule) => {
    expect(config).toContain(`"${rule}": "off"`);
  });

  it("carries every rule .oxlintrc.json marks `// budgeted`, and no others", () => {
    // The marker is what separates staged-off-with-debt from off-by-policy
    // (`no-explicit-any`, `no-duplicate-type-constituents`), which have no
    // count and are not meant to reach zero.
    const marked = [
      ...config.matchAll(/"([a-z-]+\/[a-z0-9-]+)":\s*"off",?\s*\/\/\s*budgeted/g),
    ].map((m) => m[1]);
    expect(marked.length).toBeGreaterThan(0);
    expect(Object.keys(budget.rules).sort()).toEqual(marked.sort());
  });
});
