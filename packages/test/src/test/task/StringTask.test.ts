/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  StringConcatTask,
  StringIncludesTask,
  StringJoinTask,
  StringLengthTask,
  StringLowerCaseTask,
  StringReplaceTask,
  StringSliceTask,
  StringTemplateTask,
  StringTrimTask,
  StringUpperCaseTask,
} from "@workglow/tasks";
import { describe, expect, test } from "vitest";

describe("StringConcatTask", () => {
  test("concatenates two strings", async () => {
    const task = new StringConcatTask();
    const result = await task.run({ a: "hello", b: " world" });
    expect(result.result).toBe("hello world");
  });

  test("concatenates empty strings", async () => {
    const task = new StringConcatTask();
    const result = await task.run({ a: "", b: "" });
    expect(result.result).toBe("");
  });
});

describe("StringJoinTask", () => {
  test("joins strings with separator", async () => {
    const task = new StringJoinTask();
    const result = await task.run({ values: ["a", "b", "c"], separator: ", " });
    expect(result.result).toBe("a, b, c");
  });

  test("joins with default empty separator", async () => {
    const task = new StringJoinTask();
    const result = await task.run({ values: ["a", "b", "c"] });
    expect(result.result).toBe("abc");
  });

  test("joins single element", async () => {
    const task = new StringJoinTask();
    const result = await task.run({ values: ["only"], separator: "-" });
    expect(result.result).toBe("only");
  });
});

describe("StringUpperCaseTask", () => {
  test("converts to upper case", async () => {
    const task = new StringUpperCaseTask();
    const result = await task.run({ value: "hello world" });
    expect(result.result).toBe("HELLO WORLD");
  });
});

describe("StringLowerCaseTask", () => {
  test("converts to lower case", async () => {
    const task = new StringLowerCaseTask();
    const result = await task.run({ value: "HELLO WORLD" });
    expect(result.result).toBe("hello world");
  });
});

describe("StringTrimTask", () => {
  test("trims whitespace", async () => {
    const task = new StringTrimTask();
    const result = await task.run({ value: "  hello  " });
    expect(result.result).toBe("hello");
  });

  test("trims tabs and newlines", async () => {
    const task = new StringTrimTask();
    const result = await task.run({ value: "\n\thello\n\t" });
    expect(result.result).toBe("hello");
  });
});

describe("StringReplaceTask", () => {
  test("replaces all occurrences", async () => {
    const task = new StringReplaceTask();
    const result = await task.run({ value: "foo bar foo", search: "foo", replace: "baz" });
    expect(result.result).toBe("baz bar baz");
  });

  test("replaces with empty string", async () => {
    const task = new StringReplaceTask();
    const result = await task.run({ value: "hello world", search: " ", replace: "" });
    expect(result.result).toBe("helloworld");
  });
});

describe("StringSliceTask", () => {
  test("slices from start to end", async () => {
    const task = new StringSliceTask();
    const result = await task.run({ value: "hello world", start: 0, end: 5 });
    expect(result.result).toBe("hello");
  });

  test("slices from start without end", async () => {
    const task = new StringSliceTask();
    const result = await task.run({ value: "hello world", start: 6 });
    expect(result.result).toBe("world");
  });

  test("supports negative indexing", async () => {
    const task = new StringSliceTask();
    const result = await task.run({ value: "hello world", start: -5 });
    expect(result.result).toBe("world");
  });
});

describe("StringLengthTask", () => {
  test("returns string length", async () => {
    const task = new StringLengthTask();
    const result = await task.run({ value: "hello" });
    expect(result.result).toBe(5);
  });

  test("returns 0 for empty string", async () => {
    const task = new StringLengthTask();
    const result = await task.run({ value: "" });
    expect(result.result).toBe(0);
  });
});

describe("StringIncludesTask", () => {
  test("returns true when substring is found", async () => {
    const task = new StringIncludesTask();
    const result = await task.run({ value: "hello world", search: "world" });
    expect(result.result).toBe(true);
  });

  test("returns false when substring is not found", async () => {
    const task = new StringIncludesTask();
    const result = await task.run({ value: "hello world", search: "xyz" });
    expect(result.result).toBe(false);
  });
});

describe("StringTemplateTask", () => {
  test("replaces placeholders", async () => {
    const task = new StringTemplateTask();
    const result = await task.run({
      template: "Hello, {{name}}!",
      values: { name: "World" },
    });
    expect(result.result).toBe("Hello, World!");
  });

  test("replaces multiple placeholders", async () => {
    const task = new StringTemplateTask();
    const result = await task.run({
      template: "{{greeting}}, {{name}}!",
      values: { greeting: "Hi", name: "Alice" },
    });
    expect(result.result).toBe("Hi, Alice!");
  });

  test("handles missing values", async () => {
    const task = new StringTemplateTask();
    const result = await task.run({
      template: "Hello, {{name}}!",
      values: {},
    });
    expect(result.result).toBe("Hello, {{name}}!");
  });
});
