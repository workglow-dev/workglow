/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** Findings allowed per staged-off rule, persisted to `scripts/lint-budget.json`. */
export interface LintBudget {
  readonly rules: Readonly<Record<string, number>>;
}

/** One rule whose finding count moved away from its budget. */
export interface LintDrift {
  readonly rule: string;
  readonly budget: number;
  readonly actual: number;
}

export interface LintBudgetResult {
  /** Rules that grew. These fail the gate. */
  readonly regressions: readonly LintDrift[];
  /** Rules that shrank. These do not fail — they ask for the budget to be lowered. */
  readonly improvements: readonly LintDrift[];
  /** Budgeted rules oxlint reported nothing for. Ready to turn back on. */
  readonly clean: readonly string[];
  /** Rules oxlint reported that the budget does not carry. These fail the gate. */
  readonly unbudgeted: readonly LintDrift[];
}

/**
 * Compares measured findings against the budget.
 *
 * A ratchet, not a target: growth fails, shrinkage is reported so the number can
 * be lowered deliberately, and a rule that reaches zero is named as ready to
 * retire to `"error"`. An unbudgeted rule fails too — otherwise staging a new
 * rule off in `.oxlintrc.json` and forgetting the budget entry would buy an
 * exemption with no count attached, which is the state this replaces.
 */
export function checkLintBudget(
  counts: Readonly<Record<string, number>>,
  budget: LintBudget
): LintBudgetResult {
  const regressions: LintDrift[] = [];
  const improvements: LintDrift[] = [];
  const clean: string[] = [];

  for (const [rule, allowed] of Object.entries(budget.rules)) {
    const actual = counts[rule] ?? 0;
    if (actual > allowed) regressions.push({ rule, budget: allowed, actual });
    else if (actual < allowed) {
      improvements.push({ rule, budget: allowed, actual });
      if (actual === 0) clean.push(rule);
    }
  }

  const unbudgeted = Object.entries(counts)
    .filter(([rule, actual]) => actual > 0 && !Object.hasOwn(budget.rules, rule))
    .map(([rule, actual]) => ({ rule, budget: 0, actual }));

  return { regressions, improvements, clean, unbudgeted };
}

/**
 * Buckets oxlint's output by rule.
 *
 * oxlint names the rule on every diagnostic line — `warning typescript(x): …` —
 * so one pass with every budgeted rule enabled as a warning is enough. Nine
 * separate `-D <rule>` passes would each pay the full type-aware walk, roughly
 * 100s apiece on a built tree.
 */
export function countFindingsByRule(output: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of output.matchAll(/^\s*\S+:\d+:\d+:\s+\w+\s+([a-z-]+)\(([a-z0-9-]+)\)/gm)) {
    const rule = `${match[1]}/${match[2]}`;
    counts[rule] = (counts[rule] ?? 0) + 1;
  }
  return counts;
}
