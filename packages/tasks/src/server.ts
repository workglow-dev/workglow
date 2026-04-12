/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PlaywrightBackend } from "./task/browser/PlaywrightBackend";
import { registerBrowserDeps } from "./util/BrowserTaskDeps";
import { mcpClientFactory, mcpServerConfigSchema } from "./util/McpClientUtil";
import type { McpServerConfig } from "./util/McpTaskDeps";
import { registerMcpTaskDeps } from "./util/McpTaskDeps";

export function registerMcpTaskDepsServer(): void {
  registerMcpTaskDeps({
    mcpClientFactory,
    mcpServerConfigSchema,
    createStdioTransport: (config: McpServerConfig) =>
      Promise.resolve(
        new StdioClientTransport({
          command: config.command!,
          args: config.args,
          env: config.env,
        })
      ),
  });
}

export function registerBrowserDepsServer(): void {
  registerBrowserDeps({
    createContext: (_options) => new PlaywrightBackend(),
    availableBackends: ["local", "cloud"],
    defaultBackend: "local",
    profileStorage: {
      async save(projectId, profileName, state) {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const dir = path.join(process.cwd(), ".workglow", "browser-profiles", projectId);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, `${profileName}.json`), state, "utf-8");
      },
      async load(projectId, profileName) {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        try {
          return await fs.readFile(
            path.join(
              process.cwd(),
              ".workglow",
              "browser-profiles",
              projectId,
              `${profileName}.json`
            ),
            "utf-8"
          );
        } catch {
          return null;
        }
      },
      async delete(projectId, profileName) {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        try {
          await fs.unlink(
            path.join(
              process.cwd(),
              ".workglow",
              "browser-profiles",
              projectId,
              `${profileName}.json`
            )
          );
        } catch {
          /* ignore */
        }
      },
    },
  });
}
