/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { DataPortSchema } from "@workglow/util/schema";
import { Task } from "../../task/Task";
import { autoConnect } from "../autoConnect";
import { TaskGraph } from "../TaskGraph";
import { Workflow } from "../Workflow";

// ---------------------------------------------------------------------------
// Minimal test task definitions (follow CLAUDE.md test-task pattern)
// ---------------------------------------------------------------------------

// Scenario 1: exact port-name + compatible-schema match (string → string)
class ExactSrcTask extends Task<Record<string, never>, { customer: string }> {
  static override readonly type = "AutoConnectExactSrc";
  static override readonly category = "Test";
  static override readonly title = "Exact Src";
  static override readonly description = "";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {} } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { customer: { type: "string" } },
    } as const satisfies DataPortSchema;
  }
  override async execute() {
    return { customer: "acme" };
  }
}

class ExactTgtTask extends Task<{ customer: string }, Record<string, never>> {
  static override readonly type = "AutoConnectExactTgt";
  static override readonly category = "Test";
  static override readonly title = "Exact Tgt";
  static override readonly description = "";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { customer: { type: "string" } },
      required: ["customer"],
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return { type: "object", properties: {} } as const satisfies DataPortSchema;
  }
  override async execute(input: { customer: string }) {
    return {};
  }
}

// Scenario 2: no match — incompatible schema types
class NoMatchSrcTask extends Task<Record<string, never>, { score: number }> {
  static override readonly type = "AutoConnectNoMatchSrc";
  static override readonly category = "Test";
  static override readonly title = "No Match Src";
  static override readonly description = "";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {} } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { score: { type: "number" } },
    } as const satisfies DataPortSchema;
  }
  override async execute() {
    return { score: 42 };
  }
}

class NoMatchTgtTask extends Task<{ name: string }, Record<string, never>> {
  static override readonly type = "AutoConnectNoMatchTgt";
  static override readonly category = "Test";
  static override readonly title = "No Match Tgt";
  static override readonly description = "";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return { type: "object", properties: {} } as const satisfies DataPortSchema;
  }
  override async execute(input: { name: string }) {
    return {};
  }
}

// Scenario 3: format-specific match (both ports carry format:"date-time", different names)
class DateSrcTask extends Task<Record<string, never>, { created: string }> {
  static override readonly type = "AutoConnectDateSrc";
  static override readonly category = "Test";
  static override readonly title = "Date Src";
  static override readonly description = "";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {} } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { created: { type: "string", format: "date-time" } },
    } as const satisfies DataPortSchema;
  }
  override async execute() {
    return { created: new Date().toISOString() };
  }
}

class DateTgtTask extends Task<{ updated: string }, Record<string, never>> {
  static override readonly type = "AutoConnectDateTgt";
  static override readonly category = "Test";
  static override readonly title = "Date Tgt";
  static override readonly description = "";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { updated: { type: "string", format: "date-time" } },
      required: ["updated"],
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return { type: "object", properties: {} } as const satisfies DataPortSchema;
  }
  override async execute(input: { updated: string }) {
    return {};
  }
}

// Scenario 4: required vs optional — source satisfies required port, optional unmatched
class ReqOptSrcTask extends Task<Record<string, never>, { value: number }> {
  static override readonly type = "AutoConnectReqOptSrc";
  static override readonly category = "Test";
  static override readonly title = "ReqOpt Src";
  static override readonly description = "";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {} } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "number" } },
    } as const satisfies DataPortSchema;
  }
  override async execute() {
    return { value: 1 };
  }
}

class ReqOptTgtTask extends Task<{ value: number; label?: string }, Record<string, never>> {
  static override readonly type = "AutoConnectReqOptTgt";
  static override readonly category = "Test";
  static override readonly title = "ReqOpt Tgt";
  static override readonly description = "";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        value: { type: "number" },
        label: { type: "string" },
      },
      required: ["value"],
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return { type: "object", properties: {} } as const satisfies DataPortSchema;
  }
  override async execute(input: { value: number; label?: string }) {
    return {};
  }
}

// Scenario 5: earlierTasks — target's required port matched by an earlier task, not the source
class EarlierSrcTask extends Task<Record<string, never>, { irrelevant: boolean }> {
  static override readonly type = "AutoConnectEarlierSrc";
  static override readonly category = "Test";
  static override readonly title = "Earlier Src";
  static override readonly description = "";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {} } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { irrelevant: { type: "boolean" } },
    } as const satisfies DataPortSchema;
  }
  override async execute() {
    return { irrelevant: true };
  }
}

class EarlierMiddleTask extends Task<Record<string, never>, { payload: string }> {
  static override readonly type = "AutoConnectEarlierMiddle";
  static override readonly category = "Test";
  static override readonly title = "Earlier Middle";
  static override readonly description = "";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {} } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { payload: { type: "string" } },
    } as const satisfies DataPortSchema;
  }
  override async execute() {
    return { payload: "hello" };
  }
}

class EarlierTgtTask extends Task<{ payload: string }, Record<string, never>> {
  static override readonly type = "AutoConnectEarlierTgt";
  static override readonly category = "Test";
  static override readonly title = "Earlier Tgt";
  static override readonly description = "";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { payload: { type: "string" } },
      required: ["payload"],
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return { type: "object", properties: {} } as const satisfies DataPortSchema;
  }
  override async execute(input: { payload: string }) {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Helper to normalise results for stable comparison
// ---------------------------------------------------------------------------

function normalise(result: ReturnType<typeof autoConnect>) {
  return {
    matches: Array.from(result.matches.entries()).sort(),
    unmatched: [...result.unmatchedRequired].sort(),
    error: result.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const scenarios: Array<{
  name: string;
  build: () => [[TaskGraph, ExactSrcTask | any, ExactTgtTask | any], [TaskGraph, any, any]];
}> = [
  {
    name: "exact port-name match (string → string)",
    build: () => {
      const build = () => {
        const g = new TaskGraph();
        const src = new ExactSrcTask({ id: "ac-exact-src" } as any);
        const tgt = new ExactTgtTask({ id: "ac-exact-tgt" } as any);
        g.addTask(src);
        g.addTask(tgt);
        return [g, src, tgt] as const;
      };
      return [build(), build()] as any;
    },
  },
  {
    name: "no match — incompatible schemas",
    build: () => {
      const build = () => {
        const g = new TaskGraph();
        const src = new NoMatchSrcTask({ id: "ac-nomatch-src" } as any);
        const tgt = new NoMatchTgtTask({ id: "ac-nomatch-tgt" } as any);
        g.addTask(src);
        g.addTask(tgt);
        return [g, src, tgt] as const;
      };
      return [build(), build()] as any;
    },
  },
  {
    name: "format-specific match (date-time format, different port names)",
    build: () => {
      const build = () => {
        const g = new TaskGraph();
        const src = new DateSrcTask({ id: "ac-date-src" } as any);
        const tgt = new DateTgtTask({ id: "ac-date-tgt" } as any);
        g.addTask(src);
        g.addTask(tgt);
        return [g, src, tgt] as const;
      };
      return [build(), build()] as any;
    },
  },
  {
    name: "required vs optional target ports",
    build: () => {
      const build = () => {
        const g = new TaskGraph();
        const src = new ReqOptSrcTask({ id: "ac-reqopt-src" } as any);
        const tgt = new ReqOptTgtTask({ id: "ac-reqopt-tgt" } as any);
        g.addTask(src);
        g.addTask(tgt);
        return [g, src, tgt] as const;
      };
      return [build(), build()] as any;
    },
  },
  {
    name: "earlierTasks — required port matched by an earlier task",
    build: () => {
      const build = () => {
        const g = new TaskGraph();
        const earlier = new EarlierMiddleTask({ id: "ac-earlier-middle" } as any);
        const src = new EarlierSrcTask({ id: "ac-earlier-src" } as any);
        const tgt = new EarlierTgtTask({ id: "ac-earlier-tgt" } as any);
        g.addTask(earlier);
        g.addTask(src);
        g.addTask(tgt);
        return [g, src, tgt, earlier] as const;
      };
      const b1 = build();
      const b2 = build();
      return [
        [b1[0], b1[1], b1[2], b1[3]],
        [b2[0], b2[1], b2[2], b2[3]],
      ] as any;
    },
  },
];

// Workflow.autoConnect is a one-line delegate to autoConnect, so the
// comparison below is a delegation smoke-test plus behavioural coverage of
// each named scenario (exact match, dotted paths, optional/required inputs,
// etc.), not a proof of refactor equivalence.
describe("autoConnect covers key scenarios (via Workflow.autoConnect delegation)", () => {
  for (const s of scenarios) {
    it(`matches for: ${s.name}`, () => {
      const [pair1, pair2] = s.build() as any;
      const [g1, src1, tgt1, earlier1] = pair1;
      const [g2, src2, tgt2, earlier2] = pair2;

      const options1 =
        earlier1 !== undefined ? { earlierTasks: [earlier1] as readonly any[] } : undefined;
      const options2 =
        earlier2 !== undefined ? { earlierTasks: [earlier2] as readonly any[] } : undefined;

      const clsResult = Workflow.autoConnect(g1, src1, tgt1, options1);
      const fnResult = autoConnect(g2, src2, tgt2, options2);

      expect(normalise(fnResult)).toEqual(normalise(clsResult));
    });
  }
});
