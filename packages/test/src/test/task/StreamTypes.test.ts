/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StreamError,
  StreamEvent,
  StreamFinish,
  StreamMode,
  StreamSnapshot,
  StreamTextDelta,
} from "@workglow/task-graph";
import {
  edgeNeedsAccumulation,
  getOutputStreamMode,
  getPortStreamMode,
  isTaskStreamable,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util";
import { describe, expect, it } from "vitest";

describe("StreamTypes", () => {
  describe("StreamMode", () => {
    it("should accept 'none' as a valid StreamMode", () => {
      const mode: StreamMode = "none";
      expect(mode).toBe("none");
    });

    it("should accept 'append' as a valid StreamMode", () => {
      const mode: StreamMode = "append";
      expect(mode).toBe("append");
    });

    it("should accept 'replace' as a valid StreamMode", () => {
      const mode: StreamMode = "replace";
      expect(mode).toBe("replace");
    });
  });

  describe("StreamTextDelta", () => {
    it("should create a valid text-delta event", () => {
      const delta: StreamTextDelta = {
        type: "text-delta",
        textDelta: "Hello",
      };
      expect(delta.type).toBe("text-delta");
      expect(delta.textDelta).toBe("Hello");
    });

    it("should handle empty text-delta", () => {
      const delta: StreamTextDelta = {
        type: "text-delta",
        textDelta: "",
      };
      expect(delta.type).toBe("text-delta");
      expect(delta.textDelta).toBe("");
    });
  });

  describe("StreamSnapshot", () => {
    it("should create a valid snapshot event", () => {
      const snapshot: StreamSnapshot<{ text: string }> = {
        type: "snapshot",
        data: { text: "Hello world" },
      };
      expect(snapshot.type).toBe("snapshot");
      expect(snapshot.data).toEqual({ text: "Hello world" });
    });

    it("should support complex output types", () => {
      const snapshot: StreamSnapshot<{ text: string; target_lang: string }> = {
        type: "snapshot",
        data: { text: "Bonjour le monde", target_lang: "fr" },
      };
      expect(snapshot.type).toBe("snapshot");
      expect(snapshot.data.text).toBe("Bonjour le monde");
      expect(snapshot.data.target_lang).toBe("fr");
    });
  });

  describe("StreamFinish", () => {
    it("should create a valid finish event with data", () => {
      const finish: StreamFinish<{ text: string }> = {
        type: "finish",
        data: { text: "Complete output" },
      };
      expect(finish.type).toBe("finish");
      expect(finish.data).toEqual({ text: "Complete output" });
    });

    it("should create a finish event with empty data (append mode, cache off)", () => {
      const finish: StreamFinish = {
        type: "finish",
        data: {},
      };
      expect(finish.type).toBe("finish");
      expect(finish.data).toEqual({});
    });
  });

  describe("StreamError", () => {
    it("should create a valid error event", () => {
      const error: StreamError = {
        type: "error",
        error: new Error("Something went wrong"),
      };
      expect(error.type).toBe("error");
      expect(error.error).toBeInstanceOf(Error);
      expect(error.error.message).toBe("Something went wrong");
    });
  });

  describe("StreamEvent discriminated union", () => {
    it("should discriminate text-delta events", () => {
      const event: StreamEvent = { type: "text-delta", textDelta: "hi" };
      expect(event.type).toBe("text-delta");
      if (event.type === "text-delta") {
        expect(event.textDelta).toBe("hi");
      }
    });

    it("should discriminate snapshot events", () => {
      const event: StreamEvent<{ text: string }> = {
        type: "snapshot",
        data: { text: "hello" },
      };
      expect(event.type).toBe("snapshot");
      if (event.type === "snapshot") {
        expect(event.data.text).toBe("hello");
      }
    });

    it("should discriminate finish events", () => {
      const event: StreamEvent<{ text: string }> = {
        type: "finish",
        data: { text: "done" },
      };
      expect(event.type).toBe("finish");
      if (event.type === "finish") {
        expect(event.data.text).toBe("done");
      }
    });

    it("should discriminate error events", () => {
      const event: StreamEvent = {
        type: "error",
        error: new Error("fail"),
      };
      expect(event.type).toBe("error");
      if (event.type === "error") {
        expect(event.error.message).toBe("fail");
      }
    });

    it("should work correctly in a switch statement", () => {
      const events: StreamEvent<{ text: string }>[] = [
        { type: "text-delta", textDelta: "a" },
        { type: "text-delta", textDelta: "b" },
        { type: "snapshot", data: { text: "ab" } },
        { type: "finish", data: { text: "ab" } },
      ];

      let deltas = 0;
      let snapshots = 0;
      let finishes = 0;

      for (const event of events) {
        switch (event.type) {
          case "text-delta":
            deltas++;
            break;
          case "snapshot":
            snapshots++;
            break;
          case "finish":
            finishes++;
            break;
          case "error":
            break;
        }
      }

      expect(deltas).toBe(2);
      expect(snapshots).toBe(1);
      expect(finishes).toBe(1);
    });
  });

  // ===========================================================================
  // Port-level helper functions
  // ===========================================================================

  describe("getPortStreamMode", () => {
    it("should return 'none' when x-stream is absent", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string" } },
      };
      expect(getPortStreamMode(schema, "text")).toBe("none");
    });

    it("should return 'append' when x-stream is 'append'", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "append" } },
      };
      expect(getPortStreamMode(schema, "text")).toBe("append");
    });

    it("should return 'replace' when x-stream is 'replace'", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "replace" } },
      };
      expect(getPortStreamMode(schema, "text")).toBe("replace");
    });

    it("should return 'none' for a missing port", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "append" } },
      };
      expect(getPortStreamMode(schema, "missing")).toBe("none");
    });

    it("should return 'none' for a boolean schema", () => {
      expect(getPortStreamMode(true as any, "text")).toBe("none");
      expect(getPortStreamMode(false as any, "text")).toBe("none");
    });

    it("should return 'none' when properties is empty", () => {
      const schema: DataPortSchema = { type: "object", properties: {} };
      expect(getPortStreamMode(schema, "text")).toBe("none");
    });
  });

  describe("getOutputStreamMode", () => {
    it("should return 'none' when no port has x-stream", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string" } },
      };
      expect(getOutputStreamMode(schema)).toBe("none");
    });

    it("should return 'append' when a port has x-stream append", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "append" } },
      };
      expect(getOutputStreamMode(schema)).toBe("append");
    });

    it("should return 'replace' when a port has x-stream replace", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "replace" } },
      };
      expect(getOutputStreamMode(schema)).toBe("replace");
    });

    it("should prioritize 'append' over 'replace' when both exist", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          text: { type: "string", "x-stream": "replace" },
          summary: { type: "string", "x-stream": "append" },
        },
      };
      expect(getOutputStreamMode(schema)).toBe("append");
    });

    it("should return 'none' for boolean schema", () => {
      expect(getOutputStreamMode(true as any)).toBe("none");
    });
  });

  describe("isTaskStreamable", () => {
    it("should return true when output has x-stream and executeStream exists", () => {
      const task = {
        outputSchema: () =>
          ({
            type: "object",
            properties: { text: { type: "string", "x-stream": "append" } },
          }) as DataPortSchema,
        executeStream: async function* () {},
      };
      expect(isTaskStreamable(task)).toBe(true);
    });

    it("should return false when output has x-stream but no executeStream", () => {
      const task = {
        outputSchema: () =>
          ({
            type: "object",
            properties: { text: { type: "string", "x-stream": "append" } },
          }) as DataPortSchema,
      };
      expect(isTaskStreamable(task)).toBe(false);
    });

    it("should return false when executeStream exists but no x-stream on output", () => {
      const task = {
        outputSchema: () =>
          ({
            type: "object",
            properties: { text: { type: "string" } },
          }) as DataPortSchema,
        executeStream: async function* () {},
      };
      expect(isTaskStreamable(task)).toBe(false);
    });
  });

  describe("edgeNeedsAccumulation", () => {
    const appendSchema: DataPortSchema = {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
    };
    const replaceSchema: DataPortSchema = {
      type: "object",
      properties: { text: { type: "string", "x-stream": "replace" } },
    };
    const noneSchema: DataPortSchema = {
      type: "object",
      properties: { text: { type: "string" } },
    };

    it("should return false when source has no x-stream", () => {
      expect(edgeNeedsAccumulation(noneSchema, "text", noneSchema, "text")).toBe(false);
    });

    it("should return false when source and target match (append-append)", () => {
      expect(edgeNeedsAccumulation(appendSchema, "text", appendSchema, "text")).toBe(false);
    });

    it("should return false when source and target match (replace-replace)", () => {
      expect(edgeNeedsAccumulation(replaceSchema, "text", replaceSchema, "text")).toBe(false);
    });

    it("should return true when source is append but target has no x-stream", () => {
      expect(edgeNeedsAccumulation(appendSchema, "text", noneSchema, "text")).toBe(true);
    });

    it("should return true when source is replace but target has no x-stream", () => {
      expect(edgeNeedsAccumulation(replaceSchema, "text", noneSchema, "text")).toBe(true);
    });

    it("should return true when source is append but target is replace", () => {
      expect(edgeNeedsAccumulation(appendSchema, "text", replaceSchema, "text")).toBe(true);
    });
  });
});
