#!/usr/bin/env bun

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerAiTasks, setGlobalModelRepository } from "@workglow/ai";
import { registerHuggingFaceTransformers } from "@workglow/ai-provider/hf-transformers";
import { registerBaseTasks } from "@workglow/task-graph";
import { registerCommonTasks } from "@workglow/tasks";
import {
  ChainedCredentialStore,
  EnvCredentialStore,
  InMemoryCredentialStore,
  setGlobalCredentialStore,
} from "@workglow/util";
import { program } from "commander";
import path from "node:path";
import { registerAgentCommand } from "./commands/agent";
import { registerInitCommand } from "./commands/init";
import { registerMcpCommand } from "./commands/mcp";
import { registerModelCommand } from "./commands/model";
import { registerTaskCommand } from "./commands/task";
import { registerWorkflowCommand } from "./commands/workflow";
import { loadConfig } from "./config";
import { createModelRepository } from "./storage";
import { detectCliTheme, setCliTheme } from "./terminal/detectTerminalTheme";

// Register all task types so TaskRegistry is populated
registerBaseTasks();
registerCommonTasks();
registerAiTasks();

// Set up global credential store: in-memory (for OAuth token persistence) + env var fallback
setGlobalCredentialStore(
  new ChainedCredentialStore([new InMemoryCredentialStore(), new EnvCredentialStore()])
);

// Set up global model repository backed by filesystem
const config = await loadConfig();
setCliTheme(await detectCliTheme());
const modelRepo = createModelRepository(config);
await modelRepo.setupDatabase();
setGlobalModelRepository(modelRepo);

// Expose model cache path to the HFT worker via env var
process.env.WORKGLOW_MODEL_CACHE = path.join(config.directories.cache, "onnx");

await registerHuggingFaceTransformers({
  worker: () => new Worker(new URL("./worker_hft.ts", import.meta.url), { type: "module" }),
});

program.version("2.0.0").description("Workglow CLI — manage models, workflows, agents, and tasks");

registerInitCommand(program);
registerModelCommand(program);
registerMcpCommand(program);
registerWorkflowCommand(program);
registerAgentCommand(program);
registerTaskCommand(program);

await program.parseAsync(process.argv);
process.exit(0);
