/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describeTaskClassReach,
  entitlementsBeyond,
  Entitlements,
  GraphAsTask,
  INFERENCE_ENTITLEMENTS,
  MapTask,
  Task,
  taskClassNeedsApproval,
  taskClassReach,
  type EntitlementDeclaringTaskClass,
  type TaskEntitlement,
  type TaskEntitlements,
} from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

/** Minimal stand-in for a task class; only the statics the rule reads. */
function taskClass(
  entitlements: readonly TaskEntitlement[],
  entitlementsFromChildren = false
): EntitlementDeclaringTaskClass {
  return {
    entitlementsFromChildren,
    entitlements: (): TaskEntitlements => ({ entitlements }),
  };
}

describe("INFERENCE_ENTITLEMENTS", () => {
  it("is exactly the three ids a running model already implies", () => {
    expect([...INFERENCE_ENTITLEMENTS].sort()).toEqual(["ai", "ai:inference", "ai:model"]);
    // Frozen: the gate must not be widenable by a stray push at run time.
    expect(Object.isFrozen(INFERENCE_ENTITLEMENTS)).toBe(true);
  });
});

describe("entitlementsBeyond", () => {
  it("drops the ambient ids and keeps everything else", () => {
    const beyond = entitlementsBeyond([
      { id: Entitlements.AI },
      { id: Entitlements.AI_MODEL },
      { id: Entitlements.AI_INFERENCE },
      { id: Entitlements.NETWORK_HTTP },
    ]);
    expect(beyond.map((e) => e.id)).toEqual(["network:http"]);
  });

  it("keeps an id the ambient set does not name, even under an ambient prefix", () => {
    // The allowlist is the whole rule and matching is exact, NOT hierarchical:
    // an entitlement added to the taxonomy later must gate the tasks declaring
    // it rather than inherit a pass from its parent. This is the property the
    // whole gate exists for, so it is asserted directly.
    const beyond = entitlementsBeyond([{ id: "ai:autonomous-egress" }]);
    expect(beyond.map((e) => e.id)).toEqual(["ai:autonomous-egress"]);
  });

  it("accepts a Set as well as an array", () => {
    // The parameter is an Iterable, and a Set is the shape a caller reaches
    // for first; passing one must not re-wrap it into a different answer.
    const beyond = entitlementsBeyond(
      [{ id: Entitlements.NETWORK_HTTP }, { id: Entitlements.STORAGE_READ }],
      new Set([Entitlements.NETWORK_HTTP])
    );
    expect(beyond.map((e) => e.id)).toEqual(["storage:read"]);
  });

  it("honours a caller-supplied ambient set", () => {
    const beyond = entitlementsBeyond(
      [{ id: Entitlements.NETWORK_HTTP }, { id: Entitlements.STORAGE_READ }],
      [Entitlements.NETWORK_HTTP]
    );
    expect(beyond.map((e) => e.id)).toEqual(["storage:read"]);
  });

  it("returns an empty list for an empty declaration", () => {
    expect(entitlementsBeyond([])).toEqual([]);
  });
});

describe("taskClassReach", () => {
  it("reports the declared entitlements that are not ambient", () => {
    const cls = taskClass([
      { id: Entitlements.AI_INFERENCE },
      { id: Entitlements.NETWORK_HTTP, reason: "Fetches data from URLs" },
    ]);
    expect(taskClassReach(cls).map((e) => e.id)).toEqual(["network:http"]);
  });

  it("is empty for a class declaring nothing", () => {
    expect(taskClassReach(taskClass([]))).toEqual([]);
  });
});

describe("taskClassNeedsApproval", () => {
  it("gates a class that reaches past the ambient set", () => {
    expect(taskClassNeedsApproval(taskClass([{ id: Entitlements.NETWORK_HTTP }]))).toBe(true);
  });

  it("clears a class that declares nothing and cannot widen", () => {
    expect(taskClassNeedsApproval(taskClass([]))).toBe(false);
  });

  it("clears a class that only runs a model", () => {
    expect(taskClassNeedsApproval(taskClass([{ id: Entitlements.AI_INFERENCE }]))).toBe(false);
  });

  it("gates an empty declaration whose reach lives in contained tasks", () => {
    // The hole this closes: a composed task's reach lives in its children, so
    // its own static declaration is empty and would otherwise certify as pure.
    expect(taskClassNeedsApproval(taskClass([], true))).toBe(true);
  });

  it("does NOT gate a task that merely refines what it already declares", () => {
    // Every AI task sets `hasDynamicEntitlements` so it can attach the resolved
    // model id to `ai:model`. Reading that flag as "the declaration cannot be
    // trusted" would put an approval in front of running a model at all — the
    // one thing a caller holding INFERENCE_ENTITLEMENTS was always going to do.
    const refinesOwnFamily: EntitlementDeclaringTaskClass = {
      hasDynamicEntitlements: true,
      entitlements: (): TaskEntitlements => ({
        entitlements: [{ id: Entitlements.AI_INFERENCE }],
      }),
    } as EntitlementDeclaringTaskClass & { hasDynamicEntitlements: boolean };
    expect(taskClassNeedsApproval(refinesOwnFamily)).toBe(false);
  });

  it("gates a class that cannot be asked what it declares", () => {
    // Catalogs populate `taskClass` by cast, so a class without the static is
    // reachable here. Reading that as an empty declaration is indistinguishable
    // from a task that genuinely reaches nothing — the reading this prevents.
    expect(taskClassNeedsApproval({} as EntitlementDeclaringTaskClass)).toBe(true);
  });

  it("treats a declaration missing its entitlements array as declaring nothing", () => {
    // `entitlements()` is typed to return { entitlements }, but a hand-rolled
    // or cast class can return a bare object; reading undefined.length there
    // would throw inside the gate.
    const malformed = { entitlements: () => ({}) } as unknown as EntitlementDeclaringTaskClass;
    expect(taskClassReach(malformed)).toEqual([]);
    expect(taskClassNeedsApproval(malformed)).toBe(false);
  });

  it("gates a class whose declaration throws rather than letting the gate crash", () => {
    const throws: EntitlementDeclaringTaskClass = {
      entitlements: () => {
        throw new Error("registry lookup failed");
      },
    };
    expect(() => taskClassNeedsApproval(throws)).not.toThrow();
    expect(taskClassNeedsApproval(throws)).toBe(true);
  });

  it("gates GraphAsTask, whose reach is only knowable from its subgraph", () => {
    expect(GraphAsTask.entitlements().entitlements).toEqual([]);
    expect(GraphAsTask.entitlementsFromChildren).toBe(true);
    expect(taskClassNeedsApproval(GraphAsTask)).toBe(true);
  });

  it("gates MapTask, which inherits that shape", () => {
    expect(taskClassNeedsApproval(MapTask)).toBe(true);
  });

  it("clears a plain task, which inherits the safe default", () => {
    expect(Task.entitlementsFromChildren).toBe(false);
    expect(taskClassNeedsApproval(Task)).toBe(false);
  });
});

describe("describeTaskClassReach", () => {
  it("names each entitlement with its reason and resources", () => {
    const cls = taskClass([
      { id: Entitlements.NETWORK_HTTP, reason: "Fetches data from URLs" },
      { id: Entitlements.FILESYSTEM_READ, resources: ["/tmp/*"] },
    ]);
    expect(describeTaskClassReach(cls)).toBe(
      "network:http (Fetches data from URLs); filesystem:read → /tmp/*"
    );
  });

  it("marks an optional entitlement as one the task may take", () => {
    // Kept rather than skipped (unlike evaluatePolicy, which is deciding
    // whether to allow a run, not what to tell a person before they approve).
    const described = describeTaskClassReach(
      taskClass([{ id: Entitlements.NETWORK_HTTP, optional: true }])
    );
    expect(described).toBe("may use network:http");
  });

  it("does not claim a class reaches nothing when it cannot be asked", () => {
    expect(describeTaskClassReach({} as EntitlementDeclaringTaskClass)).toContain(
      "not declared up front"
    );
  });

  it("says so plainly when nothing is reached beyond a model", () => {
    expect(describeTaskClassReach(taskClass([{ id: Entitlements.AI_MODEL }]))).toBe(
      "(nothing beyond what the caller already holds)"
    );
  });

  it("does not report a composed class as reaching nothing", () => {
    const described = describeTaskClassReach(taskClass([], true));
    expect(described).not.toBe("(nothing beyond what the caller already holds)");
    expect(described).toContain("not declared up front");
  });

  it("keeps the caveat when a composed class ALSO declares reach statically", () => {
    // What such a class declares is its wrapper's share, not the whole answer,
    // so printing only the list is the same misleading reading as reporting the
    // empty set — the caveat is appended rather than chosen between.
    const described = describeTaskClassReach(
      taskClass([{ id: Entitlements.NETWORK_HTTP, reason: "Fetches data from URLs" }], true)
    );
    expect(described).toContain("network:http (Fetches data from URLs)");
    expect(described).toContain("not declared up front");
  });
});
