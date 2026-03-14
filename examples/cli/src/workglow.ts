#!/usr/bin/env bun

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerAiTasks, setGlobalModelRepository } from "@workglow/ai";
import { registerBaseTasks } from "@workglow/task-graph";
import { registerCommonTasks } from "@workglow/tasks";
import { program } from "commander";
import { loadConfig } from "./config";
import { registerAgentCommand } from "./commands/agent";
import { registerInitCommand } from "./commands/init";
import { registerModelCommand } from "./commands/model";
import { registerTaskCommand } from "./commands/task";
import { registerWorkflowCommand } from "./commands/workflow";
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

program
  .version("2.0.0")
  .description("Workglow CLI — manage models, workflows, agents, and tasks");

registerInitCommand(program);
registerModelCommand(program);
registerWorkflowCommand(program);
registerAgentCommand(program);
registerTaskCommand(program);

await program.parseAsync(process.argv);
process.exit(0);
