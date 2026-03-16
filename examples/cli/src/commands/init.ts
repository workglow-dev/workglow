/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { writeFile, mkdir } from "fs/promises";
import { stringify } from "smol-toml";
import { CONFIG_PATH, DEFAULT_CONFIG, type CliConfig } from "../config";

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
      });

      await writeFile(CONFIG_PATH, tomlContent, "utf-8");
      console.log(`Config written to ${CONFIG_PATH}`);

      const dirs = DEFAULT_CONFIG.directories;
      for (const dir of Object.values(dirs)) {
        await mkdir(dir, { recursive: true });
        console.log(`Created ${dir}`);
      }

      console.log("Workglow initialized.");
    });
}
