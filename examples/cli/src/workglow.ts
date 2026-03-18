#!/usr/bin/env bun

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerAiTasks, setGlobalModelRepository } from "@workglow/ai";
import { HuggingFaceTransformersProvider } from "@workglow/ai-provider";
import { registerBaseTasks } from "@workglow/task-graph";
import { registerCommonTasks } from "@workglow/tasks";
import { program } from "commander";
import { registerAgentCommand } from "./commands/agent";
import { registerInitCommand } from "./commands/init";
import { registerMcpCommand } from "./commands/mcp";
import { registerModelCommand } from "./commands/model";
import { registerTaskCommand } from "./commands/task";
import { registerWorkflowCommand } from "./commands/workflow";
import { loadConfig } from "./config";
import { createModelRepository } from "./storage";

// Register all task types so TaskRegistry is populated
registerBaseTasks();
registerCommonTasks();
registerAiTasks();

// Set up global model repository backed by filesystem
const config = await loadConfig();
const modelRepo = createModelRepository(config);
await modelRepo.setupDatabase();
setGlobalModelRepository(modelRepo);

await new HuggingFaceTransformersProvider().register({
  mode: "worker",
  worker: new Worker(new URL("./worker_hft.ts", import.meta.url), { type: "module" }),
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
