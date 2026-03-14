/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import type { Command } from "commander";
import { loadConfig } from "../config";
import { createModelRepository } from "../storage";
import { formatTable, readStdin } from "../util";

export function registerModelCommand(program: Command): void {
  const model = program.command("model").description("Manage models");

  model
    .command("list")
    .description("List all registered models")
    .action(async () => {
      const config = await loadConfig();
      const repo = createModelRepository(config);
      await repo.setupDatabase();

      const models = await repo.enumerateAllModels();
      if (!models || models.length === 0) {
        console.log("No models found.");
        return;
      }

      const rows = models.map((m) => ({
        model_id: m.model_id,
        provider: m.provider,
        title: m.title ?? "",
        description: m.description ?? "",
      }));
      console.log(formatTable(rows, ["model_id", "provider", "title", "description"]));
    });

  model
    .command("add")
    .description("Add a model from stdin JSON")
    .action(async () => {
      const config = await loadConfig();
      const repo = createModelRepository(config);
      await repo.setupDatabase();

      const input = await readStdin();
      if (!input) {
        console.error("No input provided. Pipe a JSON model record to stdin.");
        process.exit(1);
      }

      let record: ModelRecord;
      try {
        record = JSON.parse(input);
      } catch {
        console.error("Invalid JSON input.");
        process.exit(1);
      }

      if (!record.model_id || !record.provider) {
        console.error("Model record must have at least model_id and provider.");
        process.exit(1);
      }

      await repo.addModel(record);
      console.log(`Model "${record.model_id}" added.`);
    });

  model
    .command("remove")
    .argument("<id>", "model ID to remove")
    .description("Remove a model by ID")
    .action(async (id: string) => {
      const config = await loadConfig();
      const repo = createModelRepository(config);
      await repo.setupDatabase();

      try {
        await repo.removeModel(id);
        console.log(`Model "${id}" removed.`);
      } catch (e: unknown) {
        console.error((e as Error).message);
        process.exit(1);
      }
    });
}
