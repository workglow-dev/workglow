/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { beforeEach, describe, expect, it } from "vitest";
import {
  annotateCommandTree,
  matchPathSpecificity,
  registerCommandAnnotation,
  registerCommandFieldAnnotations,
  resetWebAnnotationsForTesting,
  resolveCommandAnnotation,
  resolveFieldAnnotations,
} from "./annotations";
import { resolveCommandFields } from "./commandFields";
import { buildCommandTree, findCommandNode } from "./commandTree";

beforeEach(() => resetWebAnnotationsForTesting());

describe("path matching", () => {
  it("scores a literal match by how much of it is literal", () => {
    expect(matchPathSpecificity(["query", "facts"], ["query", "facts"])).toBe(2);
    expect(matchPathSpecificity(["query", "*"], ["query", "facts"])).toBe(1);
    expect(matchPathSpecificity(["query", "**"], ["query", "facts"])).toBe(1);
  });

  it("refuses a pattern that does not cover the whole path", () => {
    expect(matchPathSpecificity(["query"], ["query", "facts"])).toBe(-1);
    expect(matchPathSpecificity(["query", "facts"], ["query"])).toBe(-1);
    expect(matchPathSpecificity(["spac", "*"], ["query", "facts"])).toBe(-1);
  });

  it("matches the rest of a path with a trailing wildcard", () => {
    expect(matchPathSpecificity(["version", "**"], ["version", "coverage", "resolver"])).toBe(1);
    expect(matchPathSpecificity(["**"], ["anything", "at", "all"])).toBe(0);
  });

  /**
   * `**` means "the rest", so a segment after it is one the author expected to
   * constrain the match and that nothing can honor. Matching anyway would apply
   * the annotation far wider than the pattern reads; matching nothing is caught
   * by the guard that every registered pattern must reach a real command.
   */
  it("refuses a `**` that is not the last segment", () => {
    expect(matchPathSpecificity(["a", "**", "b"], ["a", "b"])).toBe(-1);
    expect(matchPathSpecificity(["a", "**", "b"], ["a", "x", "b"])).toBe(-1);
    expect(matchPathSpecificity(["a", "**", "b"], ["a", "anything", "at", "all"])).toBe(-1);
  });
});

describe("command annotations", () => {
  it("unions the badges of every matching pattern", () => {
    registerCommandAnnotation({ path: ["sync", "**"], source: "sec", badges: ["network", "slow"] });
    registerCommandAnnotation({ path: ["sync", "spacs"], source: "sec", badges: ["ai"] });
    expect([...resolveCommandAnnotation(["sync", "spacs"]).badges].sort()).toEqual([
      "ai",
      "network",
      "slow",
    ]);
  });

  /**
   * A downstream re-registers the same paths on purpose: a superset that adds
   * commands after the base CLI's registration pass has to re-run it over the
   * fuller tree, which re-states every path the first pass already covered.
   * Replacing rather than appending is what makes that safe, so it is asserted
   * rather than left to the reader of the two-line function.
   */
  it("replaces an annotation registered again for the same path", () => {
    registerCommandAnnotation({ path: ["db", "reset"], source: "sec", badges: ["writes"] });
    registerCommandAnnotation({
      path: ["db", "reset"],
      source: "sec",
      badges: ["destructive"],
      confirm: "This drops tables.",
    });
    const annotation = resolveCommandAnnotation(["db", "reset"]);
    // Not a union with the superseded registration: the second call is the
    // whole truth about that path, so the earlier `writes` is gone.
    expect(annotation.badges).toEqual(["destructive"]);
    expect(annotation.confirm).toBe("This drops tables.");
  });

  it("lets the more specific note and confirmation win", () => {
    registerCommandAnnotation({ path: ["db", "**"], source: "sec", note: "touches the database" });
    registerCommandAnnotation({
      path: ["db", "reset"],
      source: "sec",
      note: "drops every table this CLI owns",
      confirm: "This deletes stored data.",
    });
    const annotation = resolveCommandAnnotation(["db", "reset"]);
    expect(annotation.note).toBe("drops every table this CLI owns");
    expect(annotation.confirm).toBe("This deletes stored data.");
    // The group's note still applies where nothing more specific does.
    expect(resolveCommandAnnotation(["db", "status"]).confirm).toBeUndefined();
  });

  it("decorates a tree without disturbing a command nobody annotated", () => {
    registerCommandAnnotation({ path: ["db", "reset"], source: "sec", badges: ["destructive"] });
    const program = new Command();
    const db = program.command("db");
    db.command("reset").description("Drop tables");
    db.command("status").description("Report state");

    const tree = annotateCommandTree(buildCommandTree(program));
    expect(findCommandNode(tree, ["db", "reset"])?.badges).toEqual(["destructive"]);
    expect(findCommandNode(tree, ["db", "status"])?.badges).toBeUndefined();
    // Annotation is additive: the command's own reading of itself survives.
    expect(findCommandNode(tree, ["db", "status"])?.description).toBe("Report state");
  });
});

/** A group whose `all` runs two of the three commands beside it. */
function syncProgram(): Command {
  const program = new Command();
  const sync = program.command("sync");
  sync.command("all").description("Run every leaf in order");
  sync.command("submissions").description("EDGAR indexes");
  sync.command("forms").description("Form sweeps");
  sync.command("types").description("Ad-hoc form-type sweep");
  return program;
}

describe("an `all` that runs its siblings", () => {
  beforeEach(() => {
    registerCommandAnnotation({
      path: ["sync", "all"],
      source: "sec",
      runs: [{ name: "submissions" }, { name: "forms", when: "only with --forms" }],
    });
  });

  it("tells each member which step of which command runs it", () => {
    const tree = annotateCommandTree(buildCommandTree(syncProgram()));
    expect(findCommandNode(tree, ["sync", "submissions"])?.runsIn).toEqual({
      command: "all",
      step: 1,
      of: 2,
      // One sibling — `types` — is left out, which is what makes marking the
      // members worth the ink; the client reads this to decide.
      skipped: 1,
    });
    expect(findCommandNode(tree, ["sync", "forms"])?.runsIn).toEqual({
      command: "all",
      step: 2,
      of: 2,
      skipped: 1,
      when: "only with --forms",
    });
  });

  /**
   * The half the name argues against, and the reason the marker exists: a
   * sibling nobody named is one `all` will never run, and only the tree it
   * sits in can say which those are.
   */
  it("names the siblings it does not run", () => {
    const tree = annotateCommandTree(buildCommandTree(syncProgram()));
    const order = findCommandNode(tree, ["sync", "all"])?.runsInOrder;
    expect(order?.members.map((member) => member.name)).toEqual(["submissions", "forms"]);
    expect(order?.skipped).toEqual(["types"]);
    expect(findCommandNode(tree, ["sync", "types"])?.runsIn).toBeUndefined();
  });

  /**
   * A member is matched by name among the siblings, so a command since renamed
   * silently marks nothing. It is kept in the order — where it reads as a step
   * that runs nothing — and named here, which is what a downstream guard test
   * asserts is empty rather than discovering by looking at the console.
   */
  it("reports a member that names no sibling instead of dropping it", () => {
    registerCommandAnnotation({
      path: ["sync", "all"],
      source: "sec",
      runs: [{ name: "submissions" }, { name: "renamed-away" }],
    });
    const order = annotateCommandTree(buildCommandTree(syncProgram()))
      .flatMap((node) => node.children)
      .find((node) => node.name === "all")?.runsInOrder;
    expect(order?.unrunMembers).toEqual(["renamed-away"]);
    // The position of the members behind it is what the numbering promises.
    expect(order?.skipped).toEqual(["forms", "types"]);
  });

  it("stamps a nested order from the sibling set it belongs to", () => {
    registerCommandAnnotation({
      path: ["sync", "forms", "all"],
      source: "sec",
      runs: [{ name: "portals" }],
    });
    const program = syncProgram();
    const forms = program.commands[0]!.commands.find((command) => command.name() === "forms")!;
    forms.command("all").description("Every form domain");
    forms.command("portals").description("CFPORTAL");
    forms.command("types").description("Ad-hoc");

    const tree = annotateCommandTree(buildCommandTree(program));
    expect(findCommandNode(tree, ["sync", "forms", "portals"])?.runsIn?.step).toBe(1);
    expect(findCommandNode(tree, ["sync", "forms", "portals"])?.runsIn?.skipped).toBe(1);
    expect(findCommandNode(tree, ["sync", "forms", "all"])?.runsInOrder?.skipped).toEqual([
      "types",
    ]);
    // The group is both a member of one order and the runner of another.
    expect(findCommandNode(tree, ["sync", "forms"])?.runsIn?.command).toBe("all");
  });

  /**
   * The other half of the same field: an `all` that runs its whole group has
   * nothing left over, so its members carry a zero and the console can stop
   * repeating a chip down every row under a count that already says twelve of
   * twelve.
   */
  it("counts nothing skipped when the order covers the whole group", () => {
    registerCommandAnnotation({
      path: ["sync", "all"],
      source: "sec",
      runs: [{ name: "submissions" }, { name: "forms" }, { name: "types" }],
    });
    const tree = annotateCommandTree(buildCommandTree(syncProgram()));
    expect(findCommandNode(tree, ["sync", "forms"])?.runsIn?.skipped).toBe(0);
    expect(findCommandNode(tree, ["sync", "all"])?.runsInOrder?.skipped).toEqual([]);
  });

  it("leaves a group with no `all` exactly as it was", () => {
    resetWebAnnotationsForTesting();
    const tree = annotateCommandTree(buildCommandTree(syncProgram()));
    for (const name of ["all", "submissions", "forms", "types"]) {
      const node = findCommandNode(tree, ["sync", name]);
      expect(node?.runsIn, name).toBeUndefined();
      expect(node?.runsInOrder, name).toBeUndefined();
    }
  });
});

describe("field annotations", () => {
  it("gives a positional argument a picker the command could not declare", async () => {
    registerCommandFieldAnnotations({
      path: ["query", "**"],
      source: "sec",
      fields: { cik: { format: "sec:cik", placeholder: "name or CIK" } },
    });
    const program = new Command();
    program.command("query").command("facts").argument("<cik>", "Issuer CIK");

    const node = findCommandNode(buildCommandTree(program), ["query", "facts"]);
    const fields = await resolveCommandFields(node!, []);
    const cik = fields.find((field) => field.key === "cik");
    expect(cik?.format).toBe("sec:cik");
    expect(cik?.placeholder).toBe("name or CIK");
    expect(cik?.required).toBe(true);
    expect(cik?.source).toBe("argument");
  });

  it("annotates a flag, and turns a stated vocabulary into an enum", async () => {
    registerCommandFieldAnnotations({
      path: ["**"],
      source: "sec",
      fields: { format: { choices: ["table", "json", "csv"] } },
    });
    const program = new Command();
    program.command("entities").option("--format <format>", "Output format", "table");

    const node = findCommandNode(buildCommandTree(program), ["entities"]);
    const fields = await resolveCommandFields(node!, []);
    const format = fields.find((field) => field.key === "format");
    expect(format?.choices).toEqual(["table", "json", "csv"]);
    expect(format?.type).toBe("enum");
  });

  it("merges per key, most specific last", () => {
    registerCommandFieldAnnotations({
      path: ["**"],
      source: "sec",
      fields: { cik: { format: "sec:cik", description: "any filer" } },
    });
    registerCommandFieldAnnotations({
      path: ["spac", "report"],
      source: "sec",
      fields: { cik: { format: "sec:spac-cik" } },
    });
    const merged = resolveFieldAnnotations(["spac", "report"]);
    expect(merged.get("cik")).toEqual({ format: "sec:spac-cik", description: "any filer" });
  });

  /**
   * The same property on the field side, which the format re-run relies on.
   *
   * The second registration DROPS a key the first had, which is the only shape
   * that distinguishes replace from append here: two entries at one path merge
   * in registration order, so a re-registration that merely changes a value
   * looks identical either way — it is the field the re-run no longer claims
   * that an appended duplicate would resurrect.
   */
  it("replaces field annotations registered again for the same path", () => {
    registerCommandFieldAnnotations({
      path: ["query", "entities"],
      source: "sec",
      fields: { format: { choices: ["table"] }, cik: { format: "sec:cik" } },
    });
    registerCommandFieldAnnotations({
      path: ["query", "entities"],
      source: "sec",
      fields: { format: { choices: ["table", "json", "csv"] } },
    });
    const merged = resolveFieldAnnotations(["query", "entities"]);
    expect(merged.get("format")?.choices).toEqual(["table", "json", "csv"]);
    expect(merged.get("cik")).toBeUndefined();
  });

  it("leaves an unannotated command exactly as it was", async () => {
    const program = new Command();
    program.command("plain").argument("<name>", "A name");
    const node = findCommandNode(buildCommandTree(program), ["plain"]);
    const fields = await resolveCommandFields(node!, []);
    expect(fields[0].format).toBeUndefined();
    expect(fields[0].placeholder).toBeUndefined();
  });
});
