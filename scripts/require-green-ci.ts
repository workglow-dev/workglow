#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Refuses to continue unless `Build & Test` is green for the commit at HEAD.
 *
 * `publish-all` runs a local test slice too, but that proves the publisher's
 * working tree — which is not what consumers install. This proves the commit,
 * and it is the half a `--no-verify`-style shortcut cannot walk around: the
 * answer comes from GitHub rather than from the machine doing the publishing.
 *
 * It runs BEFORE `bunset`, deliberately. `bunset` writes the release commit, so
 * afterwards HEAD names something no workflow has ever seen and the check would
 * pass for the wrong reason.
 */
import { spawnSync } from "node:child_process";
import { evaluateCiRuns, type WorkflowRun } from "./lib/ciGate";

/** Escape hatch, for a machine with no `gh` or an offline publish. */
const OVERRIDE = "WORKGLOW_SKIP_CI_GATE";
const WORKFLOW = "test.yml";

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  console.error(
    `  This gate exists because \`publish-all\` lost its test steps inside a\n` +
      `  \`chore: update deps\` commit and three releases went out ungated.\n` +
      `  To publish anyway, set ${OVERRIDE}=1 — deliberately, and say why in the\n` +
      `  release notes.\n`
  );
  process.exit(1);
}

function main(): void {
  if (process.env[OVERRIDE] === "1") {
    console.warn(`⚠ ${OVERRIDE}=1 — publishing without checking CI for this commit.`);
    return;
  }

  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0) fail(`Could not read HEAD: ${head.stderr.trim()}`);
  const sha = head.stdout.trim();

  const listed = spawnSync(
    "gh",
    [
      "run",
      "list",
      "--commit",
      sha,
      "--workflow",
      WORKFLOW,
      "--json",
      "databaseId,status,conclusion,url",
    ],
    { encoding: "utf8" }
  );

  // A missing `gh` refuses rather than warns. Warning would make "no gh
  // installed" a silent way past the gate, which is the failure this replaces.
  if (listed.error !== undefined && (listed.error as NodeJS.ErrnoException).code === "ENOENT") {
    fail(`\`gh\` is not installed, so the CI status for ${sha} cannot be read.`);
  }
  if (listed.status !== 0) fail(`\`gh run list\` failed: ${listed.stderr.trim()}`);

  let runs: WorkflowRun[];
  try {
    runs = JSON.parse(listed.stdout) as WorkflowRun[];
  } catch {
    fail(`\`gh run list\` returned output that is not JSON: ${listed.stdout.slice(0, 200)}`);
  }

  const verdict = evaluateCiRuns(runs, sha);
  if (!verdict.ok) fail(verdict.reason);

  // Says what was actually checked, so a green line in the publish log is
  // evidence rather than reassurance.
  console.log(`✔ Build & Test is green for ${sha}: ${verdict.run.url}`);

  const dirty = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  if (dirty.status === 0 && dirty.stdout.trim() !== "") {
    // Not fatal — `publish-all` runs `format` and `rebuild` ahead of this, so a
    // dirty tree is expected. But the run above tested the commit, not the tree
    // about to be packed, and that difference is worth naming.
    console.warn(
      `⚠ Working tree is not clean; the run above tested ${sha.slice(0, 7)}, not what is on disk.`
    );
  }
}

main();
