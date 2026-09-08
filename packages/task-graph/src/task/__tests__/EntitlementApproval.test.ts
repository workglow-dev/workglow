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

  it("honours a caller-supplied ambient set", () => {
    const beyond = entitlementsBeyond(
      [{ id: Entitlements.NETWORK_HTTP }, { id: Entitlements.STORAGE_READ }],
      new Set([Entitlements.NETWORK_HTTP])
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

  it("says so plainly when nothing is reached beyond a model", () => {
    expect(describeTaskClassReach(taskClass([{ id: Entitlements.AI_MODEL }]))).toBe(
      "(nothing beyond running a model)"
    );
  });

  it("does not report a composed class as reaching nothing", () => {
    const described = describeTaskClassReach(taskClass([], true));
    expect(described).not.toBe("(nothing beyond running a model)");
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
