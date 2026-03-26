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
  setGlobalCredentialStore,
} from "@workglow/util";
import { EncryptedKvCredentialStore, FsFolderJsonKvStorage } from "@workglow/storage";
import { program } from "commander";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
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

// Resolve or generate a persistent passphrase for the encrypted credential store.
// Priority: WORKGLOW_CREDENTIAL_PASSPHRASE env var → persisted key file → generate and save.
const workglowDir = path.join(homedir(), ".workglow");
const credentialsDir = path.join(workglowDir, "credentials");
const credentialKeyPath = path.join(workglowDir, ".credential-key");

async function resolveCredentialPassphrase(): Promise<string> {
  if (process.env.WORKGLOW_CREDENTIAL_PASSPHRASE) {
    return process.env.WORKGLOW_CREDENTIAL_PASSPHRASE;
  }
  try {
    return (await readFile(credentialKeyPath, "utf-8")).trim();
  } catch {
    // Key file doesn't exist yet — generate and persist a new random key.
    const key = randomBytes(32).toString("hex");
    await mkdir(path.dirname(credentialKeyPath), { recursive: true });
    await writeFile(credentialKeyPath, key, { mode: 0o600 });
    return key;
  }
}

// Set up global credential store: encrypted file-based (for persistent credential storage) + env var fallback
const credentialPassphrase = await resolveCredentialPassphrase();
const encryptedStore = new EncryptedKvCredentialStore(
  new FsFolderJsonKvStorage(credentialsDir),
  credentialPassphrase
);
setGlobalCredentialStore(new ChainedCredentialStore([encryptedStore, new EnvCredentialStore()]));

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
