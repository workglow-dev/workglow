/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolve every workspace package specifier to its SOURCE file instead of its
 * built bundle, for the whole monorepo at once.
 *
 * Why this exists: `packages/test` reaches everything it exercises by PACKAGE
 * SPECIFIER (`@workglow/ai`), which `exports` resolves to `dist/node.js`. Under
 * v8 coverage that bundle is the file that gets instrumented, so the executed
 * lines are attributed to `packages/ai/dist/node.js` and `packages/ai/src/**`
 * reads as barely covered — a package with a large cross-package suite scores
 * WORSE the more of its behavior lives behind its public entry point. The same
 * split also produces two module identities for one symbol (bundle copy vs.
 * source copy) whenever a suite mixes package and relative imports.
 *
 * The fix is not per-package: node's own `exports` resolution already picks the
 * right conditional target, so this only has to map the resolved
 * `<workspace>/dist/<entry>.js` back to `<workspace>/src/<entry>.ts` — the
 * inverse of what the build emits, and exactly the mapping `use-source` writes
 * its stubs from. Every package, every subpath export, and every package added
 * later is covered with no list to maintain.
 *
 * This is a resolver, not a file mutation: unlike `use-source` it writes
 * nothing into `dist`, so it cannot clobber a build or leave a tree that needs
 * `use-dist` afterwards.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// `vitest/config` re-exports vite's own `Plugin`. Imported from there because
// `vite` is not a direct dependency of this workspace and does not resolve from
// the repo root — the type-aware lint would see `any` and check nothing.
import type { Plugin } from "vitest/config";
// Extensions required on both: this module is in `vitest.config.ts`'s graph,
// which Vite's native config loader resolves without extension inference.
import { isSourceStubSync } from "./sourceStubs.ts";
import { listDirs, PACKAGE_GROUPS, ROOT } from "./testDiscovery.ts";

/** Source extensions a dist entry can have come from, in resolution order. */
const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

/**
 * What a test run resolves `@workglow/*` specifiers to. `source` is the
 * default; `dist` restores `exports` resolution so the built bundles are what
 * gets exercised.
 */
export const TEST_TARGETS = ["source", "dist"] as const;

export type TestTarget = (typeof TEST_TARGETS)[number];

/**
 * `WORKGLOW_TEST_TARGET` as a value every reader agrees on.
 *
 * Unset and empty mean `source`, since that is the default a caller who set
 * nothing is asking for. Everything else THROWS naming the value: no
 * lowercasing and no prefix matching, because a `"dist "` compared against the
 * literal `"dist"` is silently a source run — the caller reproducing a
 * bundle-only failure gets a green run over the sources instead, and nothing
 * says so.
 */
export function resolveTestTarget(raw: string | undefined): TestTarget {
  const value = raw ?? "";
  // Trimmed only to decide "nothing was set"; the comparison below is against
  // the raw value, so `"dist "` is a typo that fails rather than a target.
  if (value.trim() === "") return "source";
  const match = TEST_TARGETS.find((target) => target === value);
  if (match !== undefined) return match;
  throw new Error(
    `WORKGLOW_TEST_TARGET="${raw}" is not a known test target. ` +
      `Expected one of: ${TEST_TARGETS.join(", ")} (or unset for "source").`
  );
}

export interface WorkspacePackage {
  /** Package name as published, e.g. `@workglow/util`. */
  readonly name: string;
  /** Absolute workspace directory. */
  readonly dir: string;
  /** Every name this package lists in any dependency block. */
  readonly dependencies: ReadonlySet<string>;
  /**
   * Whether this workspace ships anything to a registry — `false` only for a
   * manifest that opts out with `publishConfig.access: "none"`.
   *
   * Deliberately NOT `private`. `packages/test`, `providers/aws` and
   * `providers/cloudflare` are all `private: true` and all carry real source
   * whose coverage matters; `access: "none"` is the narrower statement that a
   * workspace publishes no API at all.
   */
  readonly publishes: boolean;
}

/** Dependency blocks that make a package resolvable from another one. */
const DEPENDENCY_BLOCKS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** Every package name a manifest declares in any dependency block. */
function declaredDependencies(manifest: Record<string, unknown>): ReadonlySet<string> {
  const names = new Set<string>();
  for (const block of DEPENDENCY_BLOCKS) {
    const value = manifest[block];
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    for (const name of Object.keys(value)) names.add(name);
  }
  return names;
}

/**
 * Every workspace package with a name, found by walking the same groups test
 * discovery walks.
 *
 * Deliberately not `scripts/lib/util.ts`'s `findWorkspaces`: that one is
 * Bun-only (`Bun.Glob`), and this module is imported by `vitest.config.ts`,
 * which Vite loads under Node.
 */
export function listWorkspacePackages(root: string = ROOT): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const group of PACKAGE_GROUPS) {
    for (const entry of listDirs(join(root, group))) {
      const dir = join(root, group, entry);
      const manifestPath = join(dir, "package.json");
      let manifest: { name?: unknown; publishConfig?: unknown };
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest;
      } catch (error) {
        // A directory with no manifest is the ordinary case — build output, an
        // editor scratch folder — and is simply not a package. Anything else
        // (malformed JSON, unreadable file) is a real fault, and swallowing it
        // drops a package from the resolver silently: the plugin then no-ops
        // for that package and its coverage collapses back onto `dist/*`,
        // which is the symptom this module exists to remove.
        if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") continue;
        throw new Error(`Cannot read workspace manifest ${manifestPath}: ${String(error)}`, {
          cause: error,
        });
      }
      if (typeof manifest.name !== "string") continue;
      const publishConfig = manifest.publishConfig;
      const access =
        typeof publishConfig === "object" && publishConfig !== null
          ? (publishConfig as { access?: unknown }).access
          : undefined;
      found.push({
        name: manifest.name,
        dir,
        dependencies: declaredDependencies(manifest as Record<string, unknown>),
        publishes: access !== "none",
      });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The coverage denominator: every workspace package's own `src`.
 *
 * Stated rather than left to vitest's default of "files loaded during the run",
 * which omits the modules no test imports at all — exactly the ones a coverage
 * report exists to surface — and makes a package's file list depend on which
 * sections happened to run.
 *
 * REPO-ROOT-RELATIVE, and every `exclude` entry that subtracts a package has to
 * be written the same way. The v8 provider matches both lists against
 * `relative(coverageRoot, file)`, so an absolute pattern matches nothing at all
 * — silently: the report comes back with `0/0` rather than an error. The
 * coverage root is the repo root for every run that reaches this, since
 * `scripts/test.ts` invokes vitest from there and passes no `--project` (which
 * would swap in the per-project roots and make these patterns miss).
 */
export function coverageIncludeGlobs(): string[] {
  return PACKAGE_GROUPS.map((group) => `${group}/*/src/**/*.{ts,tsx}`);
}

/**
 * The source file a built entry came from, or `undefined` when there is none.
 *
 * `<pkg>/dist/media-node.js` → `<pkg>/src/media-node.ts`, mirroring
 * {@link import("./sourceStubs").sourceCounterpart}. Returning `undefined` for
 * a dist path with no counterpart is what keeps generated, copied, or
 * non-TypeScript build output (wasm, assets, a `.d.ts`) on the built file.
 */
export function distToSource(id: string): string | undefined {
  const match = /^(?<pkg>.*)\/dist\/(?<entry>.+)\.(?:js|mjs|cjs)$/.exec(id);
  if (!match?.groups) return undefined;
  const { pkg, entry } = match.groups;
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = `${pkg}/src/${entry}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Verdict per file, so one entry is probed once however often it resolves. */
const stubProbeCache = new Map<string, boolean>();

/**
 * Whether a built entry is a `use-source` stub rather than a real bundle.
 *
 * The probe itself is {@link isSourceStubSync}, shared with the stub writer so
 * the two cannot drift on what a stub looks like; this only memoises it, since
 * one entry is resolved many times over a run.
 */
export function isSourceStubFile(file: string): boolean {
  const cached = stubProbeCache.get(file);
  if (cached !== undefined) return cached;
  const verdict = isSourceStubSync(file);
  stubProbeCache.set(file, verdict);
  return verdict;
}

/**
 * The workspace package a bare specifier belongs to, or `undefined` when none
 * owns it.
 *
 * Matching is on the package BOUNDARY, not on string prefix: `@workglow/util`
 * owns `@workglow/util/schema` but not a hypothetical `@workglow/utilities`.
 *
 * Relative and absolute specifiers are answered before the scan. They can never
 * name a package and they are the bulk of what a run resolves, so paying a
 * linear walk of every workspace for each one taxes the whole graph for an
 * answer known from the first character.
 */
export function ownerOf(
  packages: readonly WorkspacePackage[],
  source: string
): WorkspacePackage | undefined {
  if (source.startsWith(".") || source.startsWith("/")) return undefined;
  return packages.find((pkg) => source === pkg.name || source.startsWith(`${pkg.name}/`));
}

/**
 * The workspace package a file belongs to — the DEEPEST directory containing
 * it, so a nested workspace is not attributed to an ancestor.
 */
export function importerPackageOf(
  packages: readonly WorkspacePackage[],
  importer: string | undefined
): WorkspacePackage | undefined {
  if (importer === undefined) return undefined;
  let best: WorkspacePackage | undefined;
  for (const pkg of packages) {
    if (!importer.startsWith(`${pkg.dir}/`)) continue;
    if (best === undefined || pkg.dir.length > best.dir.length) best = pkg;
  }
  return best;
}

/** Everything the unresolved-specifier diagnostic reasons from. */
export interface UnresolvedWorkspaceContext {
  /** The specifier that resolved to nothing. */
  readonly source: string;
  /** The workspace package that owns {@link source}. */
  readonly owner: WorkspacePackage;
  /** The importing file, when Vite reported one. */
  readonly importer: string | undefined;
  /** The workspace package the importer lives in, or `undefined` outside one. */
  readonly importerPackage: WorkspacePackage | undefined;
  /**
   * Whether {@link importerPackage} lists {@link owner} in any dependency
   * block. `undefined` when the importer is outside a workspace package, where
   * the question does not apply rather than answering "no".
   */
  readonly importerDeclaresDependency: boolean | undefined;
  /** Whether the owner's `dist` holds anything at all. */
  readonly distHasBuiltEntries: boolean;
}

/**
 * The diagnostic for a workspace specifier that resolved to nothing.
 *
 * Worth building by hand because the default is actively misleading: this
 * plugin rewrites the RESULT of resolution, so resolution itself still goes
 * through the package's `exports`, which point at `./dist/*`. With no built
 * entry there, resolution fails before the rewrite can happen and the error
 * blames the manifest, naming neither this plugin nor anything to do about it.
 *
 * The causes are RANKED, because resolution fails from the IMPORTER's
 * `node_modules` and only the last two are about the owner's `dist` at all.
 * With `linker = "isolated"` an importer sees only what it declares, so an
 * undeclared workspace dependency fails while the owner's `dist` is fully
 * populated — and "never built" is confident, wrong advice there.
 *
 * Every input is passed in rather than probed here, so the message stays a pure
 * function of its inputs.
 */
export function unresolvedWorkspaceMessage(context: UnresolvedWorkspaceContext): string {
  const {
    source,
    owner,
    importer,
    importerPackage,
    importerDeclaresDependency,
    distHasBuiltEntries,
  } = context;
  const from = importer === undefined ? "" : ` (imported from ${importer})`;

  // A package never lists itself, so a self-reference (`@workglow/util`
  // imported from inside packages/util, which node's own self-reference rule
  // resolves through the package's `exports`) reads as an undeclared dependency
  // and would be answered with "add @workglow/util to @workglow/util". Its real
  // cause is always the subpath or the build, which the branches below name.
  const selfReference = importerPackage !== undefined && importerPackage.name === owner.name;

  let remedy: string;
  if (importerDeclaresDependency === false && importerPackage !== undefined && !selfReference) {
    remedy =
      `${importerPackage.name} does not list ${owner.name} in any of its dependency blocks. ` +
      `bunfig sets linker = "isolated", so a workspace package resolves only what it ` +
      `declares: nothing is linked into ${importerPackage.dir}/node_modules for this ` +
      `specifier no matter what ${owner.name} has built. Add ${owner.name} to ` +
      `${importerPackage.name}'s package.json and re-run \`bun i\`.`;
  } else if (distHasBuiltEntries) {
    remedy =
      `${owner.dir}/dist carries built entries but none for this specifier — either the ` +
      `subpath is missing from ${owner.name}'s "exports", or it was added without ` +
      `rebuilding. Check the manifest, then re-run \`bun run build\`.`;
  } else {
    remedy =
      `${owner.dir}/dist is missing or empty — ${owner.name} has never been built in this ` +
      `checkout. Run \`bun run build\`, or \`bun run use-source\` to write source stubs ` +
      `into dist.`;
  }

  return (
    `[${WORKSPACE_SOURCE_PLUGIN_NAME}] cannot resolve "${source}"${from}. ` +
    `It is owned by the workspace package ${owner.name}. Resolution goes through that ` +
    `package's "exports", which point at ./dist/*, so the built entry has to exist even ` +
    `though this plugin then rewrites it to src. ${remedy}`
  );
}

/**
 * Whether a package's `dist` holds anything at all. `bun run clean` and
 * `use-dist --no-build` both leave the directory in place but empty, which is
 * "never built" rather than "stale".
 */
function hasBuiltEntries(packageDir: string): boolean {
  try {
    return readdirSync(join(packageDir, "dist")).length > 0;
  } catch {
    return false;
  }
}

/** The part of a resolution result the rewrite reads. */
export interface WorkspaceResolvedId {
  /** Absolute path (or external id) resolution landed on. */
  readonly id: string;
  /** Externality, when the resolver reported any. */
  readonly external?: boolean | string | undefined;
}

/** The only `this.resolve` option this forwards deliberately. */
export interface WorkspaceResolveOptions {
  readonly skipSelf?: boolean | undefined;
}

/**
 * The one capability {@link resolveWorkspaceSourceId} needs from Vite's plugin
 * context, so the hook body is drivable by a plain object in a test.
 *
 * `resolve` is declared with METHOD syntax on purpose. Under
 * `strictFunctionTypes` a property-syntax function is checked contravariantly
 * in its parameters, and Vite's real `PluginContext.resolve` — whose
 * `importer`/`options` are optional and whose options type is its own — would
 * then need a cast at the one call site that matters.
 */
export interface WorkspaceResolveContext<
  TResolved extends WorkspaceResolvedId = WorkspaceResolvedId,
> {
  resolve(
    source: string,
    importer: string | undefined,
    options: WorkspaceResolveOptions
  ): Promise<TResolved | null | undefined>;
}

/**
 * Resolve one specifier, rewriting a workspace package's built entry to its
 * source file.
 *
 * Resolution runs normally first (so conditional exports still pick the
 * node/browser/bun target the runtime asked for) and only the RESULT is
 * rewritten. That ordering is the whole trick — replicating condition
 * resolution in an alias table is what a per-package fix would have to do.
 *
 * Extracted from the plugin so it can be driven directly: inside a `Plugin`
 * object literal the hook is reachable only through a Vite build.
 */
async function resolveOwnedSpecifier<TResolved extends WorkspaceResolvedId>(
  packages: readonly WorkspacePackage[],
  context: WorkspaceResolveContext<TResolved>,
  source: string,
  importer: string | undefined,
  options: object
): Promise<TResolved | null> {
  // Bare workspace specifiers only: a relative import already points at source,
  // and resolving every third-party specifier twice would tax the whole run for
  // nothing.
  const owner = ownerOf(packages, source);
  if (owner === undefined) return null;
  const resolved = await context.resolve(source, importer, { ...options, skipSelf: true });
  if (resolved) return resolved;
  // Throwing, not warning: an unresolvable @workglow/* specifier already fails
  // the run a moment later. This only replaces the message.
  const importerPackage = importerPackageOf(packages, importer);
  throw new Error(
    unresolvedWorkspaceMessage({
      source,
      owner,
      importer,
      importerPackage,
      importerDeclaresDependency: importerPackage?.dependencies.has(owner.name),
      distHasBuiltEntries: hasBuiltEntries(owner.dir),
    })
  );
}

export async function resolveWorkspaceSourceId<TResolved extends WorkspaceResolvedId>(
  packages: readonly WorkspacePackage[],
  context: WorkspaceResolveContext<TResolved>,
  source: string,
  importer: string | undefined,
  // Forwarded verbatim (`kind`, `isEntry`, `custom` all steer resolution);
  // only `skipSelf` is this function's own contribution.
  options: object
): Promise<TResolved | null> {
  const resolved = await resolveOwnedSpecifier(packages, context, source, importer, options);
  if (!resolved || resolved.external) return resolved;
  const sourceFile = distToSource(resolved.id);
  return sourceFile === undefined ? resolved : { ...resolved, id: sourceFile };
}

/**
 * The `dist` target's own hook: resolve normally, and refuse a resolution that
 * landed on a `use-source` stub.
 *
 * `use-source` (or `rebuild`) is the normal state of a working tree here, and
 * `use-dist` is rarely run — so the tree a developer reaches for
 * `WORKGLOW_TEST_TARGET=dist` on is usually one whose `dist` re-exports `src`.
 * Left unchecked the run is worse than useless: a stub collapses a package's
 * entries onto one source module, so every bundle-shaped assertion — a
 * cross-entry `instanceof`, an export-name parity check — passes for the wrong
 * reason, and the target reports a clean sweep over bundles it never loaded.
 *
 * Checked lazily, per resolution, rather than by scanning all 41 packages at
 * startup: only the entries a run actually imports can mislead it, and the
 * message can then name the file.
 */
export async function resolveWorkspaceDistId<TResolved extends WorkspaceResolvedId>(
  packages: readonly WorkspacePackage[],
  context: WorkspaceResolveContext<TResolved>,
  source: string,
  importer: string | undefined,
  options: object
): Promise<TResolved | null> {
  const resolved = await resolveOwnedSpecifier(packages, context, source, importer, options);
  if (!resolved || resolved.external) return resolved;
  if (isSourceStubFile(resolved.id)) throw new Error(stubbedBundleMessage(resolved.id));
  return resolved;
}

/** The message for a `dist` run that resolved to a `use-source` stub. */
export function stubbedBundleMessage(file: string): string {
  return (
    `[${DIST_BUNDLE_GUARD_PLUGIN_NAME}] WORKGLOW_TEST_TARGET="dist" exercises the built ` +
    `bundles, but ${file} is a \`use-source\` stub re-exporting src. Every bundle-shaped ` +
    `assertion would pass for the wrong reason, over a bundle nothing loaded. Run ` +
    `\`bun run rebuild\` for real bundles, or unset WORKGLOW_TEST_TARGET to run against ` +
    `src, which is the default.`
  );
}

/** The plugin names, so a test can assert attachment without repeating a literal. */
export const WORKSPACE_SOURCE_PLUGIN_NAME = "workglow:workspace-source";
export const DIST_BUNDLE_GUARD_PLUGIN_NAME = "workglow:dist-bundle-guard";

/**
 * Redirect workspace package imports from `dist` to `src`.
 *
 * A one-line adapter over {@link resolveWorkspaceSourceId}: every decision
 * lives in that function.
 *
 * `packages` is accepted so a caller building MANY projects can scan once and
 * share the result. `vitest.config.ts` builds one project per workspace that
 * holds tests and every one needs the plugin attached (projects are standalone
 * Vite configs, so a root-level `plugins` entry never reaches them); scanning
 * per project re-read every workspace manifest once per project, for an answer
 * that cannot differ between them. The plugin holds no per-project state, so
 * one instance serves them all.
 */
export function workspaceSourcePlugin(
  root: string = ROOT,
  packages: readonly WorkspacePackage[] = listWorkspacePackages(root)
): Plugin {
  return {
    name: WORKSPACE_SOURCE_PLUGIN_NAME,
    enforce: "pre",
    async resolveId(source, importer, options) {
      return resolveWorkspaceSourceId(packages, this, source, importer, options);
    },
  };
}

/**
 * The `dist` target's counterpart: leave every specifier on its bundle, and
 * refuse one that resolved to a `use-source` stub.
 *
 * Attached in the source plugin's place rather than alongside it, so exactly
 * one of the two owns workspace resolution at any time.
 */
export function distBundleGuardPlugin(
  root: string = ROOT,
  packages: readonly WorkspacePackage[] = listWorkspacePackages(root)
): Plugin {
  return {
    name: DIST_BUNDLE_GUARD_PLUGIN_NAME,
    enforce: "pre",
    async resolveId(source, importer, options) {
      return resolveWorkspaceDistId(packages, this, source, importer, options);
    },
  };
}
