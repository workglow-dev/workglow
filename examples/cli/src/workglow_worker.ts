#!/usr/bin/env bun

import { HuggingFaceTransformersProvider } from "@workglow/ai-provider";
import { getTaskQueueRegistry } from "@workglow/task-graph";
import { registerHuggingfaceLocalModels } from "@workglow/test";
import { program } from "commander";
import { AddBaseCommands } from "./TaskCLI";

program.version("1.0.0").description("A CLI to run tasks.");

AddBaseCommands(program);

await registerHuggingfaceLocalModels();
await new HuggingFaceTransformersProvider().register({
  mode: "worker",
  worker: new Worker(new URL("./worker_hft.ts", import.meta.url), { type: "module" }),
});

await program.parseAsync(process.argv);

getTaskQueueRegistry().stopQueues();
