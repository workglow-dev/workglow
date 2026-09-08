/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One `Build & Test` workflow run, as `gh run list --json` reports it.
 *
 * `status` is the lifecycle (`queued` / `in_progress` / `completed`) and
 * `conclusion` is only meaningful once it reads `completed` — an in-flight run
 * carries an empty conclusion, which is not the same as a failure and must not
 * be read as one.
 */
export interface WorkflowRun {
  readonly databaseId: number;
  readonly status: string;
  readonly conclusion: string;
  readonly url: string;
}

export type CiVerdict =
  | { readonly ok: true; readonly run: WorkflowRun }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether a commit's CI is green enough to publish from.
 *
 * Only the newest run counts. A commit can carry several — a re-run after a
 * flake, a `workflow_dispatch` beside the push — and requiring all of them to
 * be green would make a superseded red run unpublishable forever, while
 * accepting any green one would let a re-run that went red be papered over by
 * the failure it replaced. `gh run list` returns newest first.
 *
 * An empty list is refused rather than allowed. "No run for this commit" is the
 * state a brand-new commit is in, which is exactly the state the gate exists to
 * catch — the release would publish code no workflow has ever built.
 */
export function evaluateCiRuns(runs: readonly WorkflowRun[], sha: string): CiVerdict {
  const newest = runs[0];
  if (newest === undefined) {
    return {
      ok: false,
      reason:
        `No \`Build & Test\` run found for ${sha}. Push the commit and let CI ` +
        `finish before publishing from it.`,
    };
  }
  if (newest.status !== "completed") {
    return {
      ok: false,
      reason: `\`Build & Test\` for ${sha} is still ${newest.status}: ${newest.url}`,
    };
  }
  if (newest.conclusion !== "success") {
    return {
      ok: false,
      reason: `\`Build & Test\` for ${sha} concluded "${newest.conclusion}": ${newest.url}`,
    };
  }
  return { ok: true, run: newest };
}
