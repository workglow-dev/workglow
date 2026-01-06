/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DownloadModelTask, getGlobalModelRepository } from "@workglow/ai";
import { JsonTaskItem, TaskGraph, Workflow } from "@workglow/task-graph";
import { DelayTask, JsonTask } from "@workglow/tasks";
import type { Command } from "commander";
import { runTasks } from "./TaskGraphToUI";

export function AddBaseCommands(program: Command) {
  program
    .command("download")
    .description("download models")
    .requiredOption("--model <name>", "model to download")
    .action(async (options) => {
      const graph = new TaskGraph();
      if (options.model) {
        const model = await getGlobalModelRepository().findByName(options.model);
        if (model) {
          graph.addTask(new DownloadModelTask({ model: model.model_id }));
        } else {
          program.error(`Unknown model ${options.model}`);
        }
      }
      try {
        await runTasks(graph);
      } catch (error) {
        console.error("Error running download task:", error);
      }
    });

  program
    .command("embedding")
    .description("get a embedding vector for a piece of text")
    .argument("<text>", "text to embed")
    .option("--model <name>", "model to use")
    .action(async (text: string, options) => {
      const model = options.model
        ? (await getGlobalModelRepository().findByName(options.model))?.model_id
        : (await getGlobalModelRepository().findModelsByTask("TextEmbeddingTask"))?.map(
            (m) => m.model_id
          )?.[0];

      if (!model) {
        program.error(`Unknown model ${options.model}`);
      } else {
        const workflow = new Workflow();
        workflow.textEmbedding({ model, text });
        try {
          await runTasks(workflow);
        } catch (error) {
          console.error("Error running embedding task:", error);
        }
      }
    });

  program
    .command("summarize")
    .description("summarize text")
    .argument("<text>", "text to embed")
    .option("--model <name>", "model to use")
    .action(async (text, options) => {
      const model = options.model
        ? (await getGlobalModelRepository().findByName(options.model))?.model_id
        : (await getGlobalModelRepository().findModelsByTask("TextSummaryTask"))?.map(
            (m) => m.model_id
          )?.[0];
      if (!model) {
        program.error(`Unknown model ${options.model}`);
      } else {
        const workflow = new Workflow();
        workflow.textSummary({ model, text });
        try {
          await runTasks(workflow);
        } catch (error) {
          console.error("Error running summary task:", error);
        }
      }
    });

  program
    .command("rewrite")
    .description("rewrite text")
    .argument("<text>", "text to rewrite")
    .option("--prompt <prompt>", "instruction for how to rewrite", "")
    .option("--model <name>", "model to use")
    .action(async (text, options) => {
      const model = options.model
        ? (await getGlobalModelRepository().findByName(options.model))?.model_id
        : (await getGlobalModelRepository().findModelsByTask("TextRewriterTask"))?.map(
            (m) => m.model_id
          )?.[0];
      if (!model) {
        program.error(`Unknown model ${options.model}`);
      } else {
        const workflow = new Workflow();
        workflow.textRewriter({ model, text, prompt: options.prompt });
        try {
          await runTasks(workflow);
        } catch (error) {
          console.error("Error running rewriter task:", error);
        }
      }
    });

  program
    .command("json")
    .description("run based on json input")
    .argument("[json]", "json text to rewrite and vectorize")
    .action(async (json) => {
      if (!json) {
        const exampleJson: JsonTaskItem[] = [
          {
            id: "1",
            type: "DownloadModelTask",
            name: "Download Model",
            defaults: {
              model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
            },
          },
          {
            id: "2",
            type: "TextRewriterTask",
            name: "Rewrite Text",
            defaults: {
              text: "The quick brown fox jumps over the lazy dog at the party.",
              prompt: "Rewrite the following text in reverse:",
            },
            dependencies: {
              model: {
                id: "1",
                output: "model",
              },
            },
          },
        ];
        json = JSON.stringify(exampleJson);
      }
      const task = new JsonTask({ json }, { name: "JSON Task Example" });
      const graph = task.subGraph;
      if (!graph) {
        program.error("Task has no sub-graph");
      }
      try {
        await runTasks(graph);
      } catch (error) {
        console.error("Error running JSON task:", error);
      }
    });

  program
    .command("workflow")
    .description("run based on workflow")
    .action(async () => {
      const workflow = new Workflow();
      workflow
        .downloadModel({ model: "onnx:Xenova/LaMini-Flan-T5-783M:q8" })
        .textGeneration({
          prompt: "Where in the sky is the sun?",
        })
        .rename("*", "console")
        .debugLog();

      try {
        await runTasks(workflow);
      } catch (error) {
        console.error("Error running workflow:", error);
      }
    });

  program
    .command("delay")
    .description("delay for a given number of seconds")
    .option("--seconds <seconds>", "time to delay")
    .action(async (options) => {
      const task = new DelayTask({ delay: parseInt(options.seconds) || 2000 });
      try {
        await runTasks(task);
      } catch (error) {
        console.error("Error running delay task:", error);
      }
    });
}
