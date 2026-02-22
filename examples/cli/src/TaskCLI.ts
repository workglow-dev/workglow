/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DownloadModelTask,
  getGlobalModelRepository,
  registerAiTasks,
  type ModelConfig,
} from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider";
import { JsonTaskItem, registerBaseTasks, TaskGraph, Workflow } from "@workglow/task-graph";
import { DelayTask, JsonTask, registerCommonTasks } from "@workglow/tasks";
import type { Command } from "commander";
import { readFile, writeFile } from "fs/promises";
import { runTasks } from "./TaskGraphToUI";
/**
 * Read image input from file or stdin
 */
async function readImageInput(filePath?: string): Promise<string> {
  let buffer: Buffer;

  if (filePath) {
    // Read from file
    buffer = await readFile(filePath);
  } else {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    buffer = Buffer.concat(chunks);
  }

  // Detect MIME type from file extension or default to png
  let mimeType = "image/png";
  if (filePath) {
    const ext = filePath.toLowerCase().split(".").pop();
    const mimeTypes: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
    };
    mimeType = mimeTypes[ext || ""] || "image/png";
  }

  // Convert to data URI
  const base64 = buffer.toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Read text input from stdin
 */
async function readTextInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

/**
 * Write output to file or stdout
 */
async function writeOutput(
  data: any,
  outFile?: string,
  format: "json" | "text" | "image" = "json"
): Promise<void> {
  let output: string | Buffer;

  if (format === "json") {
    // If data has a single 'text' property, output just the text value
    if (data && typeof data === "object" && "text" in data && Object.keys(data).length === 1) {
      output = data.text;
    } else {
      output = JSON.stringify(data, null, 2);
    }
  } else if (format === "image") {
    // Decode base64 image data
    if (typeof data === "string") {
      // Remove data URI prefix if present
      const base64Data = data.replace(/^data:image\/\w+;base64,/, "");
      output = Buffer.from(base64Data, "base64");
    } else {
      throw new Error("Image data must be a string");
    }
  } else {
    // text format
    output = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  }

  if (outFile) {
    await writeFile(outFile, output);
  } else {
    if (Buffer.isBuffer(output)) {
      process.stdout.write(output);
    } else {
      console.log(output);
    }
  }
}

/**
 * Get default pipeline for a given command and provider
 */
function getDefaultPipeline(commandName: string, provider: string): string | null {
  const mapping: Record<string, Record<string, string>> = {
    embedding: {
      [HF_TRANSFORMERS_ONNX]: "feature-extraction",
    },
    summarize: {
      [HF_TRANSFORMERS_ONNX]: "summarization",
    },
    rewrite: {
      [HF_TRANSFORMERS_ONNX]: "text2text-generation",
    },
    download: {
      [HF_TRANSFORMERS_ONNX]: "feature-extraction",
    },
    "text-classification": {
      [HF_TRANSFORMERS_ONNX]: "text-classification",
    },
    "text-fill-mask": {
      [HF_TRANSFORMERS_ONNX]: "fill-mask",
    },
    "text-ner": {
      [HF_TRANSFORMERS_ONNX]: "token-classification",
    },
    "text-qa": {
      [HF_TRANSFORMERS_ONNX]: "question-answering",
    },
    "image-background-removal": {
      [HF_TRANSFORMERS_ONNX]: "background-removal",
    },
    "image-object-detection": {
      [HF_TRANSFORMERS_ONNX]: "object-detection",
    },
    "image-classification": {
      [HF_TRANSFORMERS_ONNX]: "image-classification",
    },
    "image-embedding": {
      [HF_TRANSFORMERS_ONNX]: "image-feature-extraction",
    },
    "image-segmentation": {
      [HF_TRANSFORMERS_ONNX]: "image-segmentation",
    },
    "image-to-text": {
      [HF_TRANSFORMERS_ONNX]: "image-to-text",
    },
  };
  return mapping[commandName]?.[provider] || null;
}

/**
 * Resolve model from options - either from repository by name or construct ModelConfig
 */
async function resolveModelFromOptions(
  commandName: string,
  options: any,
  program: Command,
  requiresDimensions = false
): Promise<string | ModelConfig> {
  // If --model is provided, look it up in the repository
  if (options.model) {
    const modelRecord = await getGlobalModelRepository().findByName(options.model);
    if (modelRecord) {
      return modelRecord.model_id;
    } else {
      program.error(`Unknown model ${options.model}`);
    }
  }

  // If --model is not provided, construct ModelConfig from other options
  if (!options.modelProvider || !options.modelPath) {
    program.error("Either --model OR (--model-provider and --model-path) must be provided");
  }

  const provider = options.modelProvider;

  // Determine pipeline
  const inferredPipeline = getDefaultPipeline(commandName, provider);
  const pipeline = options.modelPipeline || inferredPipeline;

  if (!pipeline) {
    program.error(
      `Unable to infer pipeline for command '${commandName}' with provider '${provider}'. Please specify --model-pipeline`
    );
  }

  // Build provider_config based on provider type
  const providerConfig: any = {
    model_path: options.modelPath,
    pipeline,
  };

  // Add dtype for HF_TRANSFORMERS_ONNX
  if (provider === HF_TRANSFORMERS_ONNX) {
    providerConfig.dtype = options.modelDtype || "auto";

    // Add native_dimensions if required (for embedding tasks)
    if (requiresDimensions) {
      if (!options.modelDimensions) {
        program.error(
          `--model-dimensions is required when building ModelConfig for embedding tasks with ${provider}`
        );
      }
      providerConfig.native_dimensions = parseInt(options.modelDimensions, 10);
    }
  }

  const modelConfig: ModelConfig = {
    provider,
    provider_config: providerConfig,
  };

  return modelConfig;
}

export function AddBaseCommands(program: Command) {
  program
    .command("download")
    .description("download models")
    .option("--model <name>", "model to download")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .action(async (options) => {
      const graph = new TaskGraph();

      const model = await resolveModelFromOptions("download", options, program);
      graph.addTask(new DownloadModelTask({ model }));

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
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .option("--model-dimensions <number>", "model embedding dimensions ")
    .action(async (text: string, options) => {
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("embedding", options, program, true);
      } else {
        // Fallback to finding a model by task type
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("TextEmbeddingTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No embedding model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const workflow = new Workflow();
      workflow.textEmbedding({ model, text });
      try {
        const graphResult = await runTasks(workflow);
        const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;
        await writeOutput(result, options.outFile, "json");
      } catch (error) {
        console.error("Error running embedding task:", error);
      }
    });

  program
    .command("summarize")
    .description("summarize text")
    .argument("<text>", "text to summarize")
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .option("--stream", "enable streaming output")
    .action(async (text, options) => {
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("summarize", options, program);
      } else {
        // Fallback to finding a model by task type
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("TextSummaryTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No summary model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const workflow = new Workflow();
      workflow.textSummary({ model, text });
      try {
        const graphResult = await runTasks(workflow);
        const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;
        await writeOutput(result, options.outFile, "json");
      } catch (error) {
        console.error("Error running summary task:", error);
      }
    });

  program
    .command("rewrite")
    .description("rewrite text")
    .argument("<text>", "text to rewrite")
    .option("--prompt <prompt>", "instruction for how to rewrite", "")
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .option("--stream", "enable streaming output")
    .action(async (text, options) => {
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("rewrite", options, program);
      } else {
        // Fallback to finding a model by task type
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("TextRewriterTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No rewriter model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const workflow = new Workflow();
      workflow.textRewriter({ model, text, prompt: options.prompt });
      try {
        const graphResult = await runTasks(workflow);
        const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;
        await writeOutput(result, options.outFile, "json");
      } catch (error) {
        console.error("Error running rewriter task:", error);
      }
    });

  program
    .command("text-classification")
    .description("Classify text into categories")
    .argument("<text>", "text to classify")
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .option("--candidate-labels <labels...>", "list of candidate labels (space-separated)")
    .option("--max-categories <number>", "maximum number of categories to return", "5")
    .action(async (text, options) => {
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("text-classification", options, program);
      } else {
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("TextClassificationTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No text classification model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const taskInput: any = { model, text };
      if (options.candidateLabels) {
        taskInput.candidateLabels = options.candidateLabels;
      }
      if (options.maxCategories) {
        taskInput.maxCategories = parseInt(options.maxCategories, 10);
      }

      const workflow = new Workflow();
      workflow.textClassification(taskInput);
      try {
        const graphResult = await runTasks(workflow);
        const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;
        await writeOutput(result, options.outFile, "json");
      } catch (error) {
        console.error("Error running text classification task:", error);
      }
    });

  program
    .command("text-fill-mask")
    .description("Fill masked tokens in text")
    .argument("<text>", "text with mask token (e.g., 'Paris is the [MASK] of France')")
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .action(async (text, options) => {
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("text-fill-mask", options, program);
      } else {
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("TextFillMaskTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No fill mask model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const workflow = new Workflow();
      workflow.textFillMask({ model, text });
      try {
        const graphResult = await runTasks(workflow);
        const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;
        await writeOutput(result, options.outFile, "json");
      } catch (error) {
        console.error("Error running fill mask task:", error);
      }
    });

  program
    .command("text-ner")
    .description("Extract named entities from text")
    .argument("<text>", "text to extract entities from")
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .option("--block-list <types...>", "entity types to exclude (space-separated)")
    .action(async (text, options) => {
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("text-ner", options, program);
      } else {
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("TextNamedEntityRecognitionTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No named entity recognition model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const taskInput: any = { model, text };
      if (options.blockList) {
        taskInput.blockList = options.blockList;
      }

      const workflow = new Workflow();
      workflow.textNamedEntityRecognition(taskInput);
      try {
        const graphResult = await runTasks(workflow);
        const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;
        await writeOutput(result, options.outFile, "json");
      } catch (error) {
        console.error("Error running named entity recognition task:", error);
      }
    });

  program
    .command("text-qa")
    .description("Answer questions based on context")
    .argument("<question>", "question to answer")
    .argument("<context>", "context for the question")
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .option("--stream", "enable streaming output")
    .action(async (question, context, options) => {
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("text-qa", options, program);
      } else {
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("TextQuestionAnswerTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No question answering model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const workflow = new Workflow();
      workflow.textQuestionAnswer({ model, question, context });
      try {
        const graphResult = await runTasks(workflow);
        const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;
        await writeOutput(result, options.outFile, "json");
      } catch (error) {
        console.error("Error running question answering task:", error);
      }
    });

  program
    .command("json")
    .description("run based on json input")
    .argument("[json]", "json text")
    .option("--file <path>", "read JSON from file")
    .action(async (jsonArg, options) => {
      registerBaseTasks();
      registerCommonTasks();
      registerAiTasks();
      let json = jsonArg;
      if (!json && options.file) {
        json = (await readFile(options.file, "utf-8")).trim();
      } else if (!json && !process.stdin.isTTY) {
        json = await readTextInput();
      }
      if (!json) {
        const exampleJson: JsonTaskItem[] = [
          {
            id: "1",
            type: "DownloadModelTask",
            title: "Download Model",
            defaults: {
              model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
            },
          },
          {
            id: "2",
            type: "TextRewriterTask",
            title: "Rewrite Text",
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
      const task = new JsonTask({ json }, { title: "JSON Task Example" });
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
    .command("delay")
    .description("delay for a given number of seconds")
    .option("--seconds <seconds>", "time to delay")
    .action(async (options) => {
      const task = new DelayTask({}, { delay: parseInt(options.seconds) || 2000 });
      try {
        await runTasks(task);
      } catch (error) {
        console.error("Error running delay task:", error);
      }
    });

  program
    .command("image-background-removal")
    .description("Remove background from an image")
    .option("--file <path>", "input image file (or use stdin)")
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .action(async (options) => {
      const image = await readImageInput(options.file);
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("image-background-removal", options, program);
      } else {
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("BackgroundRemovalTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No background removal model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const workflow = new Workflow();
      workflow.backgroundRemoval({ model, image });
      const graphResult = await runTasks(workflow);
      const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;

      await writeOutput(result.image, options.outFile, "image");
    });

  program
    .command("image-object-detection")
    .description("Detect objects in an image")
    .option("--file <path>", "input image file (or use stdin)")
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .option("--labels <labels...>", "list of object labels to detect (space-separated)")
    .option("--threshold <number>", "threshold for filtering detections by score", "0.5")
    .action(async (options) => {
      const image = await readImageInput(options.file);
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("image-object-detection", options, program);
      } else {
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("ObjectDetectionTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No object detection model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const taskInput: any = { model, image };
      if (options.labels) {
        taskInput.labels = options.labels;
      }
      if (options.threshold) {
        taskInput.threshold = parseFloat(options.threshold);
      }

      const workflow = new Workflow();
      workflow.objectDetection(taskInput);
      const graphResult = await runTasks(workflow);
      const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;

      await writeOutput(result, options.outFile, "json");
    });

  program
    .command("image-classification")
    .description("Classify an image into categories")
    .option("--file <path>", "input image file (or use stdin)")
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .option("--categories <categories...>", "list of candidate categories (space-separated)")
    .option("--max-categories <number>", "maximum number of categories to return", "5")
    .action(async (options) => {
      const image = await readImageInput(options.file);
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("image-classification", options, program);
      } else {
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("ImageClassificationTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No image classification model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const taskInput: any = { model, image };
      if (options.categories) {
        taskInput.categories = options.categories;
      }
      if (options.maxCategories) {
        taskInput.maxCategories = parseInt(options.maxCategories, 10);
      }

      const workflow = new Workflow();
      workflow.imageClassification(taskInput);
      const graphResult = await runTasks(workflow);
      const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;

      await writeOutput(result, options.outFile, "json");
    });

  program
    .command("image-embedding")
    .description("Generate embeddings from an image")
    .option("--file <path>", "input image file (or use stdin)")
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .option("--model-dimensions <number>", "model embedding dimensions ")
    .action(async (options) => {
      const image = await readImageInput(options.file);
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("image-embedding", options, program, true);
      } else {
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("ImageEmbeddingTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No image embedding model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const workflow = new Workflow();
      workflow.imageEmbedding({ model, image });
      const graphResult = await runTasks(workflow);
      const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;

      await writeOutput(result, options.outFile, "json");
    });

  program
    .command("image-segmentation")
    .description("Segment an image into regions")
    .option("--file <path>", "input image file (or use stdin)")
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .option("--threshold <number>", "threshold for filtering masks by score", "0.5")
    .option("--mask-threshold <number>", "threshold for turning masks into binary values", "0.5")
    .action(async (options) => {
      const image = await readImageInput(options.file);
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("image-segmentation", options, program);
      } else {
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("ImageSegmentationTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No image segmentation model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const taskInput: any = { model, image };
      if (options.threshold) {
        taskInput.threshold = parseFloat(options.threshold);
      }
      if (options.maskThreshold) {
        taskInput.maskThreshold = parseFloat(options.maskThreshold);
      }

      const workflow = new Workflow();
      workflow.imageSegmentation(taskInput);
      const graphResult = await runTasks(workflow);
      const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;

      await writeOutput(result, options.outFile, "json");
    });

  program
    .command("image-to-text")
    .description("Generate text description from an image")
    .option("--file <path>", "input image file (or use stdin)")
    .option("--out-file <path>", "output file (or use stdout)")
    .option("--model <name>", "model to use")
    .option("--model-provider <provider>", "model provider (e.g., HF_TRANSFORMERS_ONNX)")
    .option("--model-path <path>", "model path or URI")
    .option("--model-dtype <dtype>", "model dtype (default: auto)")
    .option("--model-pipeline <pipeline>", "override inferred pipeline type")
    .option("--max-tokens <number>", "maximum number of tokens to generate")
    .action(async (options) => {
      const image = await readImageInput(options.file);
      let model: string | ModelConfig;

      if (options.model || options.modelProvider) {
        model = await resolveModelFromOptions("image-to-text", options, program);
      } else {
        const foundModel = (
          await getGlobalModelRepository().findModelsByTask("ImageToTextTask")
        )?.map((m) => m.model_id)?.[0];

        if (!foundModel) {
          program.error(
            "No image-to-text model found. Please specify --model or model provider options."
          );
        }
        model = foundModel;
      }

      const taskInput: any = { model, image };
      if (options.maxTokens) {
        taskInput.maxTokens = parseInt(options.maxTokens, 10);
      }

      const workflow = new Workflow();
      workflow.imageToText(taskInput);
      const graphResult = await runTasks(workflow);
      const result = Array.isArray(graphResult) ? graphResult[0]?.data : graphResult;

      await writeOutput(result, options.outFile, "json");
    });
}
