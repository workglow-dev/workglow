/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { mkdir, writeFile } from "fs/promises";
import { stringify } from "smol-toml";
import { CONFIG_PATH, DEFAULT_CONFIG, loadConfig } from "../config";
import { ensureChatSample } from "../samples/chatSample";
import { createWorkflowRepository } from "../storage";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize workglow configuration and directories")
    .action(async () => {
      const tomlContent = stringify({
        directories: {
          models: DEFAULT_CONFIG.directories.models,
          workflows: DEFAULT_CONFIG.directories.workflows,
          agents: DEFAULT_CONFIG.directories.agents,
          mcps: DEFAULT_CONFIG.directories.mcps,
          cache: DEFAULT_CONFIG.directories.cache,
        },
        browser: {
          backend: "bun-webview",
          headless: true,
        },
      });

      await writeFile(CONFIG_PATH, tomlContent, "utf-8");
      console.log(`Config written to ${CONFIG_PATH}`);

      const dirs = DEFAULT_CONFIG.directories;
      for (const dir of Object.values(dirs)) {
        await mkdir(dir, { recursive: true });
        console.log(`Created ${dir}`);
      }

      const config = await loadConfig();
      const workflowRepo = createWorkflowRepository(config);
      await workflowRepo.setupDatabase();
      await ensureChatSample(workflowRepo);
      console.log(`Seeded sample workflow: chat`);

      console.log("Workglow initialized.");
    });
}
