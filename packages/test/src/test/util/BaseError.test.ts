/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseError } from "@workglow/util";
import { describe, expect, it } from "vitest";

describe("BaseError", () => {
  it("should set message", () => {
    const err = new BaseError("something went wrong");
    expect(err.message).toBe("something went wrong");
  });

  it("should set name from static type", () => {
    const err = new BaseError("test");
    expect(err.name).toBe("BaseError");
  });

  it("should have a stack trace", () => {
    const err = new BaseError("test");
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe("string");
  });

  it("should format toString correctly", () => {
    const err = new BaseError("oops");
    expect(err.toString()).toBe("BaseError: oops");
  });

  it("should default to empty message", () => {
    const err = new BaseError();
    expect(err.message).toBe("");
  });

  it("should use subclass static type for name", () => {
    class CustomError extends BaseError {
      public static type = "CustomError";
    }
    const err = new CustomError("custom");
    expect(err.name).toBe("CustomError");
    expect(err.toString()).toBe("CustomError: custom");
  });
});
