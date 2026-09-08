/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import { beforeEach, describe, expect, it } from "vitest";
import { registerBuiltInWebSearchProviders, registerWebSearchTasks } from "../common";
import { WebSearchProviderRegistry } from "../WebSearchProviderRegistry";
import { WebSearchTask } from "../WebSearchTask";

describe("web-search entries", () => {
  beforeEach(() => WebSearchProviderRegistry.clear());

  it("registers the task class under its type name", () => {
    registerWebSearchTasks();
    expect(TaskRegistry.all.get(WebSearchTask.type)).toBe(WebSearchTask);
  });

  it("registers Brave and Tavily without configuration", () => {
    registerBuiltInWebSearchProviders();
    const names = WebSearchProviderRegistry.list().map((p) => p.name);
    expect(names).toContain("brave");
    expect(names).toContain("tavily");
  });

  it("registers SearXNG only when a base url is supplied", () => {
    // The env var is cleared for the negative half: it is exactly what the
    // SearXNG integration test asks an operator to set, and left in place it
    // registers the provider here and fails an assertion about its absence.
    const previous = process.env.WEB_SEARCH_SEARXNG_URL;
    delete process.env.WEB_SEARCH_SEARXNG_URL;
    try {
      registerBuiltInWebSearchProviders();
      expect(WebSearchProviderRegistry.get("searxng")).toBeUndefined();
      WebSearchProviderRegistry.clear();
      registerBuiltInWebSearchProviders({ searxngBaseUrl: "https://searx.example" });
      expect(WebSearchProviderRegistry.get("searxng")).toBeDefined();
    } finally {
      if (previous !== undefined) process.env.WEB_SEARCH_SEARXNG_URL = previous;
    }
  });

  it("reads the SearXNG base url from the environment when not passed", () => {
    const previous = process.env.WEB_SEARCH_SEARXNG_URL;
    process.env.WEB_SEARCH_SEARXNG_URL = "https://searx.env.example";
    try {
      registerBuiltInWebSearchProviders();
      expect(WebSearchProviderRegistry.get("searxng")?.endpoint).toBe(
        "https://searx.env.example/search"
      );
    } finally {
      if (previous === undefined) delete process.env.WEB_SEARCH_SEARXNG_URL;
      else process.env.WEB_SEARCH_SEARXNG_URL = previous;
    }
  });
});
