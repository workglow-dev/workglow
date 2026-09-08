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
 * gate is asserted here rather than described in prose. These tests are
 * themselves in the `unit` slice, which is the slice `publish-all` runs — so
 * removing the step also removes what would have caught its removal only if you
 * also delete this file, which is a different kind of commit to write.
 */
describe("the release gate on publish-all", () => {
  const publishAll = scripts["publish-all"] ?? "";

  it("runs a test slice before it publishes", () => {
    expect(publishAll).toContain("test:vitest:unit");
  });

  it("checks the commit's CI run before it publishes", () => {
    // The local slice proves the publisher's checkout; this proves the commit
    // everyone else will get. A `--no-verify`-style shortcut cannot walk around
    // a check that reads GitHub.
    expect(publishAll).toContain("require-green-ci");
  });

  it("gates before it bumps, not after", () => {
    // `bunset` writes the release commit. A CI check after it would ask about a
    // commit no workflow has ever seen, and would pass for that reason.
    const gate = Math.max(
      publishAll.indexOf("test:vitest:unit"),
      publishAll.indexOf("require-green-ci")
    );
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(publishAll.indexOf("bunset"));
  });

  it("chains with && so a failing gate stops the publish", () => {
    // `;` or `&` would run the publish anyway. Nothing in the chain may use
    // either as a separator.
    expect(publishAll).not.toMatch(/;|(?<!&)&(?!&)/);
    expect(publishAll).toContain("publish-workspaces");
  });

  it("still names the slice it runs", () => {
    // The gate is only as good as the script it calls: a `test:vitest:unit`
    // that no longer exists would fail `publish-all` loudly, but one silently
    // renamed would not be caught by the string check above.
    expect(scripts["test:vitest:unit"]).toBeDefined();
    expect(scripts["require-green-ci"]).toBeDefined();
  });
});
