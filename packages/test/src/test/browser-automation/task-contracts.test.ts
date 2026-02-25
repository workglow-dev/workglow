/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import {
  BrowserNavigateTask,
  BrowserClickTask,
  BrowserTypeTask,
  BrowserExtractTask,
  BrowserWaitTask,
  BrowserScreenshotTask,
  BrowserCloseTask,
  BrowserEvaluateTask,
} from "@workglow/browser-automation";

const allTasks = [
  BrowserNavigateTask,
  BrowserClickTask,
  BrowserTypeTask,
  BrowserExtractTask,
  BrowserWaitTask,
  BrowserScreenshotTask,
  BrowserCloseTask,
  BrowserEvaluateTask,
];

describe("Browser task contracts", () => {
  for (const TaskClass of allTasks) {
    describe(TaskClass.type, () => {
      it("has a unique type name", () => {
        expect(TaskClass.type).toBeTruthy();
        expect(typeof TaskClass.type).toBe("string");
      });

      it("belongs to Browser category", () => {
        expect(TaskClass.category).toBe("Browser");
      });

      it("is not cacheable", () => {
        expect(TaskClass.cacheable).toBe(false);
      });

      it("has valid input schema", () => {
        const schema = TaskClass.inputSchema();
        expect(schema).toBeTruthy();
        expect((schema as any).type).toBe("object");
        expect((schema as any).properties).toBeTruthy();
      });

      it("has valid output schema", () => {
        const schema = TaskClass.outputSchema();
        expect(schema).toBeTruthy();
        expect((schema as any).type).toBe("object");
        expect((schema as any).properties).toBeTruthy();
      });

      it("output schema includes context", () => {
        const schema = TaskClass.outputSchema();
        expect(((schema as any).properties as Record<string, unknown>).context).toBeTruthy();
      });

      it("has title and description", () => {
        expect(TaskClass.title).toBeTruthy();
        expect(TaskClass.description).toBeTruthy();
      });
    });
  }

  it("all tasks have unique type names", () => {
    const types = allTasks.map((t) => t.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  describe("BrowserNavigateTask schema", () => {
    it("requires url input", () => {
      const schema = BrowserNavigateTask.inputSchema();
      expect((schema as any).required).toContain("url");
    });

    it("output includes url and title", () => {
      const schema = BrowserNavigateTask.outputSchema();
      expect((schema as any).required).toContain("url");
      expect((schema as any).required).toContain("title");
    });
  });

  describe("BrowserClickTask schema", () => {
    it("requires locator input", () => {
      const schema = BrowserClickTask.inputSchema();
      expect((schema as any).required).toContain("locator");
    });
  });

  describe("BrowserTypeTask schema", () => {
    it("requires locator and text inputs", () => {
      const schema = BrowserTypeTask.inputSchema();
      expect((schema as any).required).toContain("locator");
      expect((schema as any).required).toContain("text");
    });
  });

  describe("BrowserExtractTask schema", () => {
    it("requires kind input", () => {
      const schema = BrowserExtractTask.inputSchema();
      expect((schema as any).required).toContain("kind");
    });

    it("output includes data", () => {
      const schema = BrowserExtractTask.outputSchema();
      expect((schema as any).required).toContain("data");
    });
  });

  describe("BrowserWaitTask schema", () => {
    it("requires mode input", () => {
      const schema = BrowserWaitTask.inputSchema();
      expect((schema as any).required).toContain("mode");
    });
  });

  describe("BrowserScreenshotTask schema", () => {
    it("output includes mime and base64", () => {
      const schema = BrowserScreenshotTask.outputSchema();
      expect((schema as any).required).toContain("mime");
      expect((schema as any).required).toContain("base64");
    });
  });

  describe("BrowserCloseTask schema", () => {
    it("output includes closed flag", () => {
      const schema = BrowserCloseTask.outputSchema();
      expect((schema as any).required).toContain("closed");
    });
  });

  describe("BrowserEvaluateTask schema", () => {
    it("requires script input", () => {
      const schema = BrowserEvaluateTask.inputSchema();
      expect((schema as any).required).toContain("script");
    });
  });
});
