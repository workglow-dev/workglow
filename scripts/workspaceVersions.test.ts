/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Two version invariants, one file, because they are the same question asked
 * about the two halves of the tree.
 *
 * **Everything published moves together.** One version across every published
 * workspace, matched by the workspace root and by the single tag the cut
 * writes, so any two packages a consumer installs are the pair that were built
 * and tested together. The release cut is `--all` for that reason, and this
 * measures the result rather than trusting the flag: a hand-edited version, a
 * half-applied bump, or a cut that quietly ran `--changed` all land here.
 *
 * **Four workspaces are never published** — `@workglow/test`, `@workglow/aws`,
 * `@workglow/cloudflare` and `@workglow/web` — and they sit outside that
 * lockstep entirely. Until 0.4.9 the cut versioned them anyway, since
 * `bunset --all` enumerates the root `workspaces` globs and read no `private`
 * flag, so all four rode from 0.3.x to 0.4.9: thirteen consecutive bumps, each
 * adding an empty section to a CHANGELOG for a release that never shipped.
 * `publish-workspaces.ts` skipped them the whole time, so no version of any of
 * them has ever been installable.
 *
 * The decision is to leave them unpublished and stop versioning them. Newer
 * bunset skips a private workspace by default, so nothing on the release
 * script says so — which is exactly why this guard exists: it pins the two
 * facts that silent default depends on.
 *
 * **Unpublished means `private: true`.** The repo's own publish predicate is
 * `publishConfig.access === "public"` (`findWorkspaces`, `scripts/lib/util.ts`), and
 * `examples/web` used to satisfy "never published" by that rule while carrying
 * no `private` flag — a package a `private`-keyed skip would walk straight
 * past. The two spellings have to agree or the skip covers three of four.
 *
 * **A frozen version stays frozen.** {@link FROZEN_VERSIONS} is the recorded
 * decision, not a measurement: a diff here means something versioned a package
 * nobody can install, which is the failure this guard exists to name. Publishing
 * one of them later is a deliberate edit — give it `publishConfig.access:
 * "public"`, drop `private`, and delete its entry here.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./lib/testDiscovery";

/**
 * Versions the never-published workspaces are held at, keyed by workspace
 * directory. 0.4.9 is where the last `--all` cut left them.
 */
const FROZEN_VERSIONS: Readonly<Record<string, string>> = {
  "packages/test": "0.4.9",
  "providers/aws": "0.4.9",
  "providers/cloudflare": "0.4.9",
  "examples/web": "0.4.9",
};

interface Manifest {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly publishConfig?: { readonly access?: string };
}

interface Workspace {
  /** Directory relative to the repo root, e.g. `providers/aws`. */
  readonly dir: string;
  readonly manifest: Manifest;
}

/**
 * Every workspace, expanded from the same root `workspaces` globs the release
 * script's package enumeration walks. Reading the array rather than restating
 * the three group names is the point: a fourth group added there is covered
 * here on the same commit.
 */
function readRootManifest(): {
  readonly version?: string;
  readonly workspaces?: readonly string[];
} {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    version?: string;
    workspaces?: readonly string[];
  };
}

function readWorkspaces(): Workspace[] {
  const root = readRootManifest();
  const workspaces: Workspace[] = [];

  for (const pattern of root.workspaces ?? []) {
    const group = pattern.replace(/^\.\//, "").replace(/\/\*$/, "");
    // Only `./group/*` is understood. Anything else would be silently skipped,
    // narrowing the guard without saying so, so make it a failure instead.
    if (group === "" || group.includes("*")) {
      throw new Error(`Unsupported workspace pattern for this guard: ${pattern}`);
    }
    for (const dir of readdirSync(join(ROOT, group))) {
      const abs = join(ROOT, group, dir);
      if (!statSync(abs).isDirectory()) continue;
      let text: string;
      try {
        text = readFileSync(join(abs, "package.json"), "utf8");
      } catch {
        continue;
      }
      workspaces.push({ dir: `${group}/${dir}`, manifest: JSON.parse(text) as Manifest });
    }
  }

  return workspaces.sort((a, b) => a.dir.localeCompare(b.dir));
}

const WORKSPACES = readWorkspaces();
const ROOT_VERSION = readRootManifest().version;
const isPublishable = (w: Workspace): boolean => w.manifest.publishConfig?.access === "public";

describe("published workspaces", () => {
  // The root is the reference because the cut bumps it in the same step it
  // bumps the packages, and it is the one version a reader can check by eye.
  it("all carry the workspace root's version", () => {
    const adrift = WORKSPACES.filter(isPublishable)
      .filter((w) => w.manifest.version !== ROOT_VERSION)
      .map((w) => `${w.dir}@${w.manifest.version} (root is ${ROOT_VERSION})`);
    expect(adrift).toEqual([]);
  });
});

describe("never-published workspaces", () => {
  it("are exactly the ones with a frozen version", () => {
    const unpublished = WORKSPACES.filter((w) => !isPublishable(w)).map((w) => w.dir);
    expect(unpublished).toEqual(Object.keys(FROZEN_VERSIONS).sort());
  });

  it("are marked private, so the release cut's skip reaches them", () => {
    const notPrivate = WORKSPACES.filter((w) => !isPublishable(w) && w.manifest.private !== true);
    expect(notPrivate.map((w) => w.dir)).toEqual([]);
  });

  it("hold the version they were frozen at", () => {
    const actual = Object.fromEntries(
      WORKSPACES.filter((w) => w.dir in FROZEN_VERSIONS).map((w) => [w.dir, w.manifest.version])
    );
    expect(actual).toEqual(FROZEN_VERSIONS);
  });

  // The inverse mistake: `private: true` on a package that IS published stops
  // the release versioning it while `publish-workspaces.ts` still tries to ship
  // it, and `bun publish` refuses a private manifest.
  it("do not include anything the publish step ships", () => {
    const privatePublishable = WORKSPACES.filter((w) => isPublishable(w) && w.manifest.private);
    expect(privatePublishable.map((w) => w.dir)).toEqual([]);
  });
});
