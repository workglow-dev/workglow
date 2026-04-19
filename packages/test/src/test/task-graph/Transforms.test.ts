/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BROKEN_TRANSFORM_ID,
  CoalesceTransform,
  Dataflow,
  IndexTransform,
  LowercaseTransform,
  NumberToStringTransform,
  ParseJsonTransform,
  PickTransform,
  StringifyTransform,
  SubstringTransform,
  Task,
  TaskGraph,
  ToBooleanTransform,
  TransformRegistry,
  TruncateTransform,
  UnixToIsoDateTransform,
  UppercaseTransform,
  registerBuiltInTransforms,
  resolveTransform,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeAll, describe, expect, it } from "vitest";

class SourceTask extends Task<{ x: number }, { customer: { created_at: number; name: string } }> {
  static override readonly type = "TransformSourceTask";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { x: { type: "number" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        customer: {
          type: "object",
          properties: {
            created_at: { type: "number" },
            name: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async execute(): Promise<{ customer: { created_at: number; name: string } }> {
    return { customer: { created_at: 1700000000, name: "Alice" } };
  }
}

class TargetTask extends Task<{ date: string }, { ok: boolean }> {
  static override readonly type = "TransformTargetTask";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        date: { type: "string", format: "date-time" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { ok: { type: "boolean" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async execute(input: { date: string }): Promise<{ ok: boolean }> {
    return { ok: typeof input.date === "string" && input.date.includes("T") };
  }
}

describe("Transforms", () => {
  beforeAll(() => {
    registerBuiltInTransforms();
  });

  describe("built-in transforms", () => {
    it("pick traverses dot paths", () => {
      const value = { customer: { created_at: 1700000000 } };
      expect(PickTransform.apply(value, { path: "customer.created_at" })).toBe(1700000000);
      expect(PickTransform.apply(value, { path: "customer.missing" })).toBeUndefined();
    });

    it("pick infers output schema at path", () => {
      const schema = {
        type: "object",
        properties: {
          customer: {
            type: "object",
            properties: { created_at: { type: "number" } },
          },
        },
      };
      expect(PickTransform.inferOutputSchema(schema, { path: "customer.created_at" })).toEqual({
        type: "number",
      });
    });

    it("index applies and infers schema", () => {
      expect(IndexTransform.apply([10, 20, 30], { index: 1 })).toBe(20);
      expect(IndexTransform.apply([10, 20], { index: -1 })).toBe(20);
      const schema = { type: "array", items: { type: "string" } };
      expect(IndexTransform.inferOutputSchema(schema, { index: 0 })).toEqual({ type: "string" });
    });

    it("coalesce replaces null/undefined", () => {
      expect(CoalesceTransform.apply(null, { defaultValue: "x" })).toBe("x");
      expect(CoalesceTransform.apply(undefined, { defaultValue: 0 })).toBe(0);
      expect(CoalesceTransform.apply("keep", { defaultValue: "x" })).toBe("keep");
    });

    it("uppercase / lowercase cast to string then change case", () => {
      expect(UppercaseTransform.apply("hello", {})).toBe("HELLO");
      expect(LowercaseTransform.apply("HELLO", {})).toBe("hello");
    });

    it("truncate and substring", () => {
      expect(TruncateTransform.apply("abcdef", { max: 3 })).toBe("abc");
      expect(TruncateTransform.apply("ab", { max: 5 })).toBe("ab");
      expect(SubstringTransform.apply("abcdef", { start: 1, end: 4 })).toBe("bcd");
    });

    it("unixToIsoDate converts seconds and ms", () => {
      expect(UnixToIsoDateTransform.apply(1700000000, { unit: "s" })).toBe(
        "2023-11-14T22:13:20.000Z"
      );
      expect(UnixToIsoDateTransform.apply(1700000000000, { unit: "ms" })).toBe(
        "2023-11-14T22:13:20.000Z"
      );
      expect(() => UnixToIsoDateTransform.apply("not-a-number", { unit: "s" })).toThrow();
    });

    it("numberToString, parseJson, stringify, toBoolean", () => {
      expect(NumberToStringTransform.apply(42, {})).toBe("42");
      expect(ParseJsonTransform.apply('{"a":1}', {})).toEqual({ a: 1 });
      expect(StringifyTransform.apply({ a: 1 }, {})).toBe('{"a":1}');
      expect(ToBooleanTransform.apply("yes", {})).toBe(true);
      expect(ToBooleanTransform.apply(0, {})).toBe(false);
    });

    it("suggestFromSchemas: unixToIsoDate bridges number -> date-time string", () => {
      const source = { type: "number" };
      const target = { type: "string", format: "date-time" };
      const hit = UnixToIsoDateTransform.suggestFromSchemas!(source, target);
      expect(hit?.score).toBeGreaterThan(0.8);
      expect(hit?.params.unit).toBe("s");
    });

    it("suggestFromSchemas: pick bridges object -> matching scalar", () => {
      const source = {
        type: "object",
        properties: { created_at: { type: "number" }, name: { type: "string" } },
      };
      const target = { type: "number" };
      const hit = PickTransform.suggestFromSchemas!(source, target);
      expect(hit).toBeDefined();
      expect(hit!.params.path).toBe("created_at");
    });
  });

  describe("registry & BrokenTransform", () => {
    it("registers built-ins idempotently", () => {
      registerBuiltInTransforms();
      registerBuiltInTransforms();
      expect(TransformRegistry.all.get("pick")).toBe(PickTransform);
      expect(TransformRegistry.all.get("unixToIsoDate")).toBe(UnixToIsoDateTransform);
    });

    it("unknown ids resolve to BrokenTransform that throws on apply", () => {
      const { def, params } = resolveTransform({ id: "does-not-exist" });
      expect(def.id).toBe(BROKEN_TRANSFORM_ID);
      expect(() => def.apply(42, params)).toThrow(/Unknown transform: does-not-exist/);
    });
  });

  describe("Dataflow transforms", () => {
    it("toJSON round-trips transforms when present", () => {
      const df = new Dataflow("s", "customer", "t", "date");
      df.setTransforms([
        { id: "pick", params: { path: "created_at" } },
        { id: "unixToIsoDate", params: { unit: "s" } },
      ]);
      const json = df.toJSON();
      expect(json.transforms).toEqual([
        { id: "pick", params: { path: "created_at" } },
        { id: "unixToIsoDate", params: { unit: "s" } },
      ]);
    });

    it("toJSON omits transforms when empty", () => {
      const df = new Dataflow("s", "a", "t", "b");
      expect(df.toJSON().transforms).toBeUndefined();
    });

    it("mutators invalidate compatibility cache", () => {
      const df = new Dataflow("s", "a", "t", "b");
      // Prime the cache with a dummy value
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (df as any)._compatibilityCache = "static";
      df.addTransform({ id: "uppercase" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((df as any)._compatibilityCache).toBeUndefined();
    });

    it("applyTransforms folds chain over dataflow value", async () => {
      const df = new Dataflow("s", "customer", "t", "date");
      df.value = { created_at: 1700000000 };
      df.setTransforms([
        { id: "pick", params: { path: "created_at" } },
        { id: "unixToIsoDate", params: { unit: "s" } },
      ]);
      await df.applyTransforms();
      expect(df.value).toBe("2023-11-14T22:13:20.000Z");
    });

    it("applyTransforms sets FAILED and rethrows on failure", async () => {
      const df = new Dataflow("s", "value", "t", "date");
      df.value = "not-a-number";
      df.setTransforms([{ id: "unixToIsoDate", params: { unit: "s" } }]);
      await expect(df.applyTransforms()).rejects.toThrow();
      expect(df.error).toBeDefined();
    });

    it("composeSourceSchema folds chain through schemas", () => {
      const df = new Dataflow("s", "customer", "t", "date");
      df.setTransforms([
        { id: "pick", params: { path: "created_at" } },
        { id: "unixToIsoDate", params: { unit: "s" } },
      ]);
      const sourceSchema = {
        type: "object",
        properties: {
          created_at: { type: "number" },
          name: { type: "string" },
        },
      };
      const effective = df.composeSourceSchema(sourceSchema);
      expect(effective).toEqual({ type: "string", format: "date-time" });
    });

    it("semanticallyCompatible considers the transform chain", () => {
      const graph = new TaskGraph();
      const source = new SourceTask({ id: "src" });
      const target = new TargetTask({ id: "tgt" });
      graph.addTask(source);
      graph.addTask(target);
      const df = new Dataflow("src", "customer", "tgt", "date");
      graph.addDataflow(df);

      // Without transforms, object -> date string is incompatible
      expect(df.semanticallyCompatible(graph, df)).not.toBe("static");

      df.setTransforms([
        { id: "pick", params: { path: "created_at" } },
        { id: "unixToIsoDate", params: { unit: "s" } },
      ]);
      const result = df.semanticallyCompatible(graph, df);
      expect(["static", "runtime"]).toContain(result);
    });
  });
});
