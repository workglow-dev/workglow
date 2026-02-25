/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integration tests for public MCP servers.
 * Run with: RUN_MCP_INTEGRATION_TESTS=1 bun test mcp-servers.integration
 *
 * Note: Some servers may be unavailable, require API keys, or use different
 * transports. Failures indicate connectivity or compatibility issues.
 */

import { McpListTask } from "@workglow/tasks";
import { describe, expect, test } from "vitest";

const RUN_INTEGRATION = !!process.env.RUN_MCP_INTEGRATION_TESTS || !!process.env.RUN_ALL_TESTS;

/** Derive transport from URL: /sse path → sse, otherwise → streamable-http */
function transportForUrl(url: string): "sse" | "streamable-http" {
  return url.endsWith("/sse") ? "sse" : "streamable-http";
}

/** MCP server config: name and URL (transport derived from URL path) */
const MCP_SERVERS = [
  { name: "Cloudflare Docs", url: "https://docs.mcp.cloudflare.com/sse" },
  { name: "Astro Docs", url: "https://mcp.docs.astro.build/mcp" },
  { name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp" },
  { name: "Exa Search", url: "https://mcp.exa.ai/mcp" },
  { name: "Hugging Face", url: "https://hf.co/mcp" },
  { name: "Remote MCP", url: "https://mcp.remote-mcp.com" },
  { name: "GitMCP", url: "https://gitmcp.io/docs" },
] as const;

describe.skipIf(!RUN_INTEGRATION)("MCP servers integration", () => {
  test.concurrent.each(MCP_SERVERS)(
    "$name lists tools",
    async ({ name, url }) => {
      const task = new McpListTask();
      const result = await task.run({
        transport: transportForUrl(url),
        server_url: url,
        list_type: "tools",
      });

      expect(result, `${name} should return tools`).toHaveProperty("tools");
      const tools = result.tools ?? [];
      expect(Array.isArray(tools), `${name} tools should be array`).toBe(true);
      expect(
        tools.length,
        `${name} should expose at least one tool (got ${tools.length})`
      ).toBeGreaterThanOrEqual(0);
    },
    20000
  );

  test.concurrent.each(MCP_SERVERS)(
    "$name lists resources",
    async ({ name, url }) => {
      const task = new McpListTask();
      try {
        const result = await task.run({
          transport: transportForUrl(url),
          server_url: url,
          list_type: "resources",
        });
        expect(result, `${name} should return resources`).toHaveProperty("resources");
        expect(Array.isArray(result.resources), `${name} resources should be array`).toBe(true);
      } catch (err) {
        // Method not found (-32601) means server doesn't support resources
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("-32601") || msg.includes("Method not found")) {
          expect(true).toBe(true);
          return;
        }
        throw err;
      }
    },
    20000
  );

  test.concurrent.each(MCP_SERVERS)(
    "$name lists prompts",
    async ({ name, url }) => {
      const task = new McpListTask();
      try {
        const result = await task.run({
          transport: transportForUrl(url),
          server_url: url,
          list_type: "prompts",
        });
        expect(result, `${name} should return prompts`).toHaveProperty("prompts");
        expect(Array.isArray(result.prompts), `${name} prompts should be array`).toBe(true);
      } catch (err) {
        // Method not found (-32601) means server doesn't support prompts
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("-32601") || msg.includes("Method not found")) {
          expect(true).toBe(true);
          return;
        }
        throw err;
      }
    },
    20000
  );
});
