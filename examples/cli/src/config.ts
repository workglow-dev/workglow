/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { parse } from "smol-toml";

export interface CliConfig {
  readonly directories: {
    readonly models: string;
    readonly workflows: string;
    readonly agents: string;
    readonly cache: string;
  };
}

const DEFAULT_BASE = join(homedir(), ".workglow");

export const DEFAULT_CONFIG: CliConfig = {
  directories: {
    models: join(DEFAULT_BASE, "definition", "model"),
    workflows: join(DEFAULT_BASE, "definition", "workflow"),
    agents: join(DEFAULT_BASE, "definition", "agent"),
    cache: join(DEFAULT_BASE, "cache"),
  },
};

export const CONFIG_PATH = join(homedir(), ".workglow.toml");

function resolvePath(p: string): string {
  if (p.startsWith("~")) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

export async function loadConfig(): Promise<CliConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = parse(raw) as {
      directories?: {
        models?: string;
        workflows?: string;
        agents?: string;
        cache?: string;
      };
    };

    const dirs = parsed.directories;
    return {
      directories: {
        models: resolvePath(dirs?.models ?? DEFAULT_CONFIG.directories.models),
        workflows: resolvePath(dirs?.workflows ?? DEFAULT_CONFIG.directories.workflows),
        agents: resolvePath(dirs?.agents ?? DEFAULT_CONFIG.directories.agents),
        cache: resolvePath(dirs?.cache ?? DEFAULT_CONFIG.directories.cache),
      },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
