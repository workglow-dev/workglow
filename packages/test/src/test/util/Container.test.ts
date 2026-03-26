/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Container } from "@workglow/util";
import { describe, expect, it, beforeEach } from "vitest";

describe("Container", () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe("register and get", () => {
    it("should register and retrieve a singleton service", () => {
      let callCount = 0;
      container.register("counter", () => {
        callCount++;
        return { value: callCount };
      });

      const first = container.get("counter");
      const second = container.get("counter");
      expect(first).toBe(second);
      expect(callCount).toBe(1);
    });

    it("should create new instances for non-singleton services", () => {
      let callCount = 0;
      container.register(
        "transient",
        () => {
          callCount++;
          return { value: callCount };
        },
        false
      );

      const first = container.get<{ value: number }>("transient");
      const second = container.get<{ value: number }>("transient");
      expect(first).not.toBe(second);
      expect(first.value).toBe(1);
      expect(second.value).toBe(2);
    });

    it("should throw for unregistered service", () => {
      expect(() => container.get("unknown")).toThrow("Service not registered: unknown");
    });
  });

  describe("registerInstance", () => {
    it("should register and retrieve an instance directly", () => {
      const instance = { name: "test" };
      container.registerInstance("myService", instance);
      expect(container.get("myService")).toBe(instance);
    });

    it("should always return the same instance", () => {
      const instance = { name: "test" };
      container.registerInstance("myService", instance);
      expect(container.get("myService")).toBe(container.get("myService"));
    });
  });

  describe("has", () => {
    it("should return false for unregistered service", () => {
      expect(container.has("unknown")).toBe(false);
    });

    it("should return true for registered factory", () => {
      container.register("svc", () => ({}));
      expect(container.has("svc")).toBe(true);
    });

    it("should return true for registered instance", () => {
      container.registerInstance("svc", {});
      expect(container.has("svc")).toBe(true);
    });
  });

  describe("remove", () => {
    it("should remove a registered service", () => {
      container.register("svc", () => ({}));
      expect(container.has("svc")).toBe(true);
      container.remove("svc");
      expect(container.has("svc")).toBe(false);
    });

    it("should remove an instance service", () => {
      container.registerInstance("svc", { x: 1 });
      container.remove("svc");
      expect(container.has("svc")).toBe(false);
    });
  });

  describe("createChildContainer", () => {
    it("should inherit factory registrations from parent", () => {
      container.register("svc", () => ({ value: "parent" }));
      const child = container.createChildContainer();
      expect(child.has("svc")).toBe(true);
      expect(child.get<{ value: string }>("svc").value).toBe("parent");
    });

    it("should inherit singleton instances from parent", () => {
      const instance = { value: "shared" };
      container.registerInstance("svc", instance);
      const child = container.createChildContainer();
      expect(child.get("svc")).toBe(instance);
    });

    it("should not affect parent when child registers new service", () => {
      const child = container.createChildContainer();
      child.register("childOnly", () => ({ x: 1 }));
      expect(child.has("childOnly")).toBe(true);
      expect(container.has("childOnly")).toBe(false);
    });
  });
});
