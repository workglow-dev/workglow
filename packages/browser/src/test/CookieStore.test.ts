/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { CookieStore, type Cookie } from "../context/CookieStore";

describe("CookieStore", () => {
  let store: CookieStore;

  beforeEach(() => {
    store = new CookieStore();
  });

  describe("set and get", () => {
    it("should store and retrieve a cookie", () => {
      const cookie: Cookie = {
        name: "session",
        value: "abc123",
        domain: "example.com",
        path: "/",
      };

      store.set(cookie);
      const retrieved = store.get("session", "example.com");

      expect(retrieved).toEqual(cookie);
    });

    it("should return undefined for non-existent cookie", () => {
      const retrieved = store.get("nonexistent");
      expect(retrieved).toBeUndefined();
    });

    it("should update existing cookie", () => {
      const cookie1: Cookie = {
        name: "session",
        value: "abc123",
        domain: "example.com",
        path: "/",
      };

      const cookie2: Cookie = {
        name: "session",
        value: "xyz789",
        domain: "example.com",
        path: "/",
      };

      store.set(cookie1);
      store.set(cookie2);

      const retrieved = store.get("session", "example.com");
      expect(retrieved?.value).toBe("xyz789");
    });
  });

  describe("getAll", () => {
    it("should return all valid cookies", () => {
      const cookie1: Cookie = {
        name: "session",
        value: "abc123",
        domain: "example.com",
        path: "/",
      };

      const cookie2: Cookie = {
        name: "tracking",
        value: "xyz789",
        domain: "example.com",
        path: "/",
      };

      store.set(cookie1);
      store.set(cookie2);

      const all = store.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContainEqual(cookie1);
      expect(all).toContainEqual(cookie2);
    });

    it("should filter out expired cookies", () => {
      const expiredCookie: Cookie = {
        name: "expired",
        value: "old",
        domain: "example.com",
        path: "/",
        expires: Date.now() - 1000, // Expired 1 second ago
      };

      const validCookie: Cookie = {
        name: "valid",
        value: "new",
        domain: "example.com",
        path: "/",
        expires: Date.now() + 1000000, // Expires in the future
      };

      store.set(expiredCookie);
      store.set(validCookie);

      const all = store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("valid");
    });
  });

  describe("getForDomain", () => {
    it("should return cookies for exact domain", () => {
      const cookie: Cookie = {
        name: "session",
        value: "abc123",
        domain: "example.com",
        path: "/",
      };

      store.set(cookie);
      const cookies = store.getForDomain("example.com");

      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toEqual(cookie);
    });

    it("should return cookies for subdomain", () => {
      const cookie: Cookie = {
        name: "session",
        value: "abc123",
        domain: ".example.com",
        path: "/",
      };

      store.set(cookie);
      const cookies = store.getForDomain("sub.example.com");

      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toEqual(cookie);
    });

    it("should not return cookies from different domain", () => {
      const cookie: Cookie = {
        name: "session",
        value: "abc123",
        domain: "example.com",
        path: "/",
      };

      store.set(cookie);
      const cookies = store.getForDomain("other.com");

      expect(cookies).toHaveLength(0);
    });
  });

  describe("delete", () => {
    it("should delete a specific cookie", () => {
      const cookie: Cookie = {
        name: "session",
        value: "abc123",
        domain: "example.com",
        path: "/",
      };

      store.set(cookie);
      store.delete("session", "example.com");

      const retrieved = store.get("session", "example.com");
      expect(retrieved).toBeUndefined();
    });

    it("should delete all cookies with same name", () => {
      const cookie1: Cookie = {
        name: "session",
        value: "abc123",
        domain: "example.com",
        path: "/",
      };

      const cookie2: Cookie = {
        name: "session",
        value: "xyz789",
        domain: "other.com",
        path: "/",
      };

      store.set(cookie1);
      store.set(cookie2);
      store.delete("session");

      const all = store.getAll();
      expect(all).toHaveLength(0);
    });
  });

  describe("serialization", () => {
    it("should serialize to JSON", () => {
      const cookie1: Cookie = {
        name: "session",
        value: "abc123",
        domain: "example.com",
        path: "/",
      };

      const cookie2: Cookie = {
        name: "tracking",
        value: "xyz789",
        domain: "example.com",
        path: "/",
      };

      store.set(cookie1);
      store.set(cookie2);

      const json = store.toJSON();
      expect(json).toHaveLength(2);
      expect(json).toContainEqual(cookie1);
      expect(json).toContainEqual(cookie2);
    });

    it("should deserialize from JSON", () => {
      const cookies: Cookie[] = [
        {
          name: "session",
          value: "abc123",
          domain: "example.com",
          path: "/",
        },
        {
          name: "tracking",
          value: "xyz789",
          domain: "example.com",
          path: "/",
        },
      ];

      store.fromJSON(cookies);

      const all = store.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContainEqual(cookies[0]);
      expect(all).toContainEqual(cookies[1]);
    });

    it("should create from JSON", () => {
      const cookies: Cookie[] = [
        {
          name: "session",
          value: "abc123",
          domain: "example.com",
          path: "/",
        },
      ];

      const newStore = CookieStore.fromJSON(cookies);
      const all = newStore.getAll();

      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(cookies[0]);
    });
  });

  describe("clone", () => {
    it("should create independent copy", () => {
      const cookie: Cookie = {
        name: "session",
        value: "abc123",
        domain: "example.com",
        path: "/",
      };

      store.set(cookie);
      const cloned = store.clone();

      // Modify original
      store.delete("session");

      // Clone should still have the cookie
      const clonedCookies = cloned.getAll();
      expect(clonedCookies).toHaveLength(1);
      expect(clonedCookies[0]).toEqual(cookie);
    });
  });
});
