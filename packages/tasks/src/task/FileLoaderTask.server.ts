/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteContext,
  JobQueueTaskConfig,
  TaskAbortedError,
  TaskRegistry,
  Workflow,
} from "@workglow/task-graph";
import { readFile } from "node:fs/promises";

import {
  FileLoaderTask as BaseFileLoaderTask,
  FileLoaderTaskInput,
  FileLoaderTaskOutput,
} from "./FileLoaderTask";

/**
 * Server-only task for loading documents from the filesystem.
 * Uses Node.js/Bun file APIs directly for better performance.
 * Only available in Node.js and Bun environments.
 *
 * For cross-platform document loading (including browser), use FileLoaderTask with URLs.
 */
export class FileLoaderTask extends BaseFileLoaderTask {
  async execute(
    input: FileLoaderTaskInput,
    context: IExecuteContext
  ): Promise<FileLoaderTaskOutput> {
    let { url, format = "auto" } = input;

    // Delegate HTTP/HTTPS URLs to parent class
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return super.execute(input, context);
    }

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(0, "Detecting file format");

    // Handle file:// URLs by stripping the protocol
    if (url.startsWith("file://")) {
      url = url.slice(7);
    }

    const detectedFormat = this.detectFormat(url, format);
    const title = url.split("/").pop() || url;

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(10, `Reading ${detectedFormat} file from filesystem`);

    // Read file content based on format
    if (detectedFormat === "json") {
      const fileContent = await readFile(url, { encoding: "utf-8" });
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(50, "Parsing JSON content");
      const jsonData = this.parseJsonContent(fileContent);
      const content = JSON.stringify(jsonData, null, 2);
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(100, "File loaded successfully");
      return {
        text: undefined,
        json: jsonData,
        csv: undefined,
        image: undefined,
        pdf: undefined,
        metadata: {
          url,
          format: detectedFormat,
          size: content.length,
          title,
          mimeType: "application/json",
        },
      };
    }

    if (detectedFormat === "csv") {
      const fileContent = await readFile(url, { encoding: "utf-8" });
      if (!fileContent) {
        throw new Error(`Failed to load CSV from ${url}`);
      }
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(50, "Parsing CSV content");
      const csvData = this.parseCsvContent(fileContent);
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(100, "File loaded successfully");
      return {
        text: undefined,
        json: undefined,
        csv: csvData,
        image: undefined,
        pdf: undefined,
        metadata: {
          url,
          format: detectedFormat,
          size: fileContent.length,
          title,
          mimeType: "text/csv",
        },
      };
    }

    if (detectedFormat === "image") {
      const fileBuffer = await readFile(url);
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(50, "Converting image to base64");
      const mimeType = this.getImageMimeType(url);
      const blob = new Blob([fileBuffer], { type: mimeType });
      const imageData = await this.blobToBase64DataURL(blob, mimeType);
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(100, "File loaded successfully");
      return {
        text: undefined,
        json: undefined,
        csv: undefined,
        image: imageData,
        pdf: undefined,
        metadata: {
          url,
          format: detectedFormat,
          size: fileBuffer.length,
          title,
          mimeType,
        },
      };
    }

    if (detectedFormat === "pdf") {
      const fileBuffer = await readFile(url);
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(50, "Converting PDF to base64");
      const mimeType = "application/pdf";
      const blob = new Blob([fileBuffer], { type: mimeType });
      const pdfData = await this.blobToBase64DataURL(blob, mimeType);
      if (context.signal.aborted) {
        throw new TaskAbortedError("Task aborted");
      }
      await context.updateProgress(100, "File loaded successfully");
      return {
        text: undefined,
        json: undefined,
        csv: undefined,
        image: undefined,
        pdf: pdfData,
        metadata: {
          url,
          format: detectedFormat,
          size: fileBuffer.length,
          title,
          mimeType,
        },
      };
    }

    // text, markdown, or html
    const fileContent = await readFile(url, { encoding: "utf-8" });
    if (!fileContent) {
      throw new Error(`Failed to load content from ${url}`);
    }
    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(50, `Parsing ${detectedFormat} content`);
    const mimeType =
      detectedFormat === "markdown"
        ? "text/markdown"
        : detectedFormat === "html"
          ? "text/html"
          : "text/plain";
    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(100, "File loaded successfully");
    return {
      text: fileContent,
      json: undefined,
      csv: undefined,
      image: undefined,
      pdf: undefined,
      metadata: {
        url,
        format: detectedFormat,
        size: fileContent.length,
        title,
        mimeType,
      },
    };
  }
}

// override the base registration
TaskRegistry.registerTask(FileLoaderTask);

export const fileLoader = (input: FileLoaderTaskInput, config?: JobQueueTaskConfig) => {
  return new FileLoaderTask(input, config).run();
};

declare module "@workglow/task-graph" {
  interface Workflow {
    fileLoaderServer: CreateWorkflow<FileLoaderTaskInput, FileLoaderTaskOutput, JobQueueTaskConfig>;
  }
}

Workflow.prototype.fileLoaderServer = CreateWorkflow(FileLoaderTask);
