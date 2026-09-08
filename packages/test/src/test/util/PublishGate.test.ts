/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const scripts = (
  JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

/**
 * `publish-all` is the release entry point, and it lost both of its test steps
 * inside a commit whose subject read `chore: update deps` — no body, nothing in
 * the diff summary naming the gate. Three releases and 126 package versions
 * were then cut through it before anyone noticed.
 *
 * A gate that can be deleted with nothing failing will be deleted again, so the
 * gate is asserted here rather than described in prose.
 *
 * The gate is `require-green-ci` alone. Running a test slice locally as well
 * would re-run, on the publisher's machine, work the checked CI run already did
 * on that exact commit — minutes bought nothing, since the answer is the same
 * one and it is the commit, not the working tree, that consumers install.
 */
describe("the release gate on publish-all", () => {
  const publishAll = scripts["publish-all"] ?? "";

  it("checks the commit's CI run before it publishes", () => {
    // The commit is what everyone else gets, and a check that reads GitHub is
    // the half a `--no-verify`-style shortcut cannot walk around.
    expect(publishAll).toContain("require-green-ci");
  });

  it("gates before it bumps, not after", () => {
    // `bunset` writes the release commit. A CI check after it would ask about a
    // commit no workflow has ever seen, and would pass for that reason.
    const gate = publishAll.indexOf("require-green-ci");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(publishAll.indexOf("bunset"));
  });

  it("chains with && so a failing gate stops the publish", () => {
    // `;` or `&` would run the publish anyway. Nothing in the chain may use
    // either as a separator.
    expect(publishAll).not.toMatch(/;|(?<!&)&(?!&)/);
    expect(publishAll).toContain("publish-workspaces");
  });

  it("still names a script that exists", () => {
    // The gate is only as good as the script it calls: one that no longer
    // exists fails `publish-all` loudly, but one silently renamed would not be
    // caught by the string check above.
    expect(scripts["require-green-ci"]).toBeDefined();
  });
});
