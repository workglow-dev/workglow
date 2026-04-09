/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task, TaskRegistry } from "@workglow/task-graph";
import { afterEach, describe, expect, it } from "vitest";
import { DataPortSchema } from "@workglow/util/schema";

// Minimal task classes used only for TaskRegistry registration tests

class TaskA extends Task {
  static override readonly type = "TaskRegistryTestA";
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  static override outputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  async run() {
    return {};
  }
}

class TaskB extends Task {
  static override readonly type = "TaskRegistryTestA"; // same type as TaskA — used to test conflict
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  static override outputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  async run() {
    return {};
  }
}

describe("TaskRegistry", () => {
  afterEach(() => {
    // Clean up any registrations made during the test
    TaskRegistry.unregisterTask(TaskA.type);
  });

  it("registers a task constructor", () => {
    TaskRegistry.registerTask(TaskA);
    expect(TaskRegistry.all.get(TaskA.type)).toBe(TaskA);
  });

  it("re-registering the same class is idempotent (no throw)", () => {
    TaskRegistry.registerTask(TaskA);
    expect(() => TaskRegistry.registerTask(TaskA)).not.toThrow();
    expect(TaskRegistry.all.get(TaskA.type)).toBe(TaskA);
  });

  it("throws when a different constructor is registered for the same type", () => {
    TaskRegistry.registerTask(TaskA);
    expect(() => TaskRegistry.registerTask(TaskB)).toThrow(
      `Task type "${TaskA.type}" is already registered. Unregister it first to replace.`
    );
  });

  it("allows replacement after unregisterTask()", () => {
    TaskRegistry.registerTask(TaskA);
    const removed = TaskRegistry.unregisterTask(TaskA.type);
    expect(removed).toBe(true);
    expect(() => TaskRegistry.registerTask(TaskB)).not.toThrow();
    expect(TaskRegistry.all.get(TaskA.type)).toBe(TaskB);
    // restore state for afterEach
    TaskRegistry.unregisterTask(TaskA.type);
  });

  it("unregisterTask returns false when the type was not registered", () => {
    expect(TaskRegistry.unregisterTask("NonExistentType")).toBe(false);
  });
});
