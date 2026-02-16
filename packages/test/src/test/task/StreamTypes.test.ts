/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type {
  StreamEvent,
  StreamFinish,
  StreamMode,
  StreamSnapshot,
  StreamTextDelta,
  StreamError,
} from "@workglow/task-graph";

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
});
