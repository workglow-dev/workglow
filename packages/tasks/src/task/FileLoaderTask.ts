/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteContext,
  JobQueueTaskConfig,
  Task,
  TaskAbortedError,
  TaskRegistry,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { parse } from "csv-parse/sync";
import { FetchUrlTask, FetchUrlTaskOutput } from "./FetchUrlTask";

const inputSchema = {
  type: "object",
  properties: {
    url: {
      type: "string",
      title: "URL",
      description: "URL to load document from (http://, https://)",
      format: "uri",
    },
    format: {
      type: "string",
      enum: ["text", "markdown", "json", "csv", "pdf", "image", "html", "auto"],
      title: "Format",
      description: "File format (auto-detected from URL if 'auto')",
      default: "auto",
    },
  },
  required: ["url"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Text content (for text, markdown, html formats)",
    },
    json: {
      title: "JSON",
      description: "Parsed JSON object or array",
    },
    csv: {
      type: "array",
      title: "CSV",
      description: "Parsed CSV data as array of objects",
    },
    image: {
      type: "string",
      title: "Image",
      description: "Base64 data URL for image files",
      format: "image:data-uri",
    },
    pdf: {
      type: "string",
      title: "PDF",
      description: "Base64 data URL for PDF files",
    },
    metadata: {
      type: "object",
      properties: {
        url: { type: "string" },
        format: { type: "string" },
        size: { type: "number" },
        title: { type: "string" },
        mimeType: { type: "string" },
      },
      additionalProperties: false,
      title: "Metadata",
      description: "File metadata",
    },
  },
  required: ["metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type FileLoaderTaskInput = FromSchema<typeof inputSchema>;
export type FileLoaderTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Task for loading documents from URLs (including file:// URLs).
 * Works in all environments (browser, Node.js, Bun) by using fetch API.
 * For server-only filesystem path access, see FileLoaderServerTask.
 */
export class FileLoaderTask extends Task<
  FileLoaderTaskInput,
  FileLoaderTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "FileLoaderTask";
  public static category = "Document";
  public static title = "File Loader";
  public static description = "Load documents from URLs (http://, https://)";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async execute(
    input: FileLoaderTaskInput,
    context: IExecuteContext
  ): Promise<FileLoaderTaskOutput> {
    const { url, format = "auto" } = input;

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(0, "Detecting file format");

    const detectedFormat = this.detectFormat(url, format);
    const responseType = this.detectResponseType(detectedFormat);

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(10, `Fetching ${detectedFormat} file from ${url}`);

    const fetchTask = context.own(
      new FetchUrlTask({
        url,
        response_type: responseType,
        queue: false, // Run directly
      })
    );
    const response = await fetchTask.run();

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(60, "Parsing file content");

    const title = url.split("/").pop() || url;
    const { text, json, csv, image, pdf, size, mimeType } = await this.parseResponse(
      response,
      url,
      detectedFormat
    );

    if (context.signal.aborted) {
      throw new TaskAbortedError("Task aborted");
    }
    await context.updateProgress(100, "File loaded successfully");

    return {
      text,
      json,
      csv,
      image,
      pdf,
      metadata: {
        url,
        format: detectedFormat,
        size,
        title,
        mimeType,
      },
    };
  }

  /**
   * Parse JSON content
   */
  protected parseJsonContent(content: string): unknown {
    return JSON.parse(content);
  }

  /**
   * Parse CSV content into array of objects
   */
  protected parseCsvContent(content: string): Array<Record<string, string>> {
    try {
      return parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (error) {
      throw new Error(`Failed to parse CSV: ${error}`);
    }
  }

  /**
   * Parse the fetch response into typed outputs
   */
  protected async parseResponse(
    response: FetchUrlTaskOutput,
    url: string,
    detectedFormat: "text" | "markdown" | "json" | "csv" | "pdf" | "image" | "html"
  ): Promise<{
    readonly text: string | undefined;
    readonly json: unknown | undefined;
    readonly csv: Array<Record<string, string>> | undefined;
    readonly image: string | undefined;
    readonly pdf: string | undefined;
    readonly size: number;
    readonly mimeType: string;
  }> {
    const responseMimeType = response.metadata?.contentType || "";

    if (detectedFormat === "json") {
      if (!response.json) {
        throw new Error(`Failed to load JSON from ${url}`);
      }
      const jsonData = response.json;
      const content = JSON.stringify(jsonData, null, 2);
      return {
        text: undefined,
        json: jsonData,
        csv: undefined,
        image: undefined,
        pdf: undefined,
        size: content.length,
        mimeType: responseMimeType || "application/json",
      };
    }

    if (detectedFormat === "csv") {
      const content = response.text || "";
      if (!content) {
        throw new Error(`Failed to load CSV from ${url}`);
      }
      const csvData = this.parseCsvContent(content);
      return {
        text: undefined,
        json: undefined,
        csv: csvData,
        image: undefined,
        pdf: undefined,
        size: content.length,
        mimeType: responseMimeType || "text/csv",
      };
    }

    if (detectedFormat === "image") {
      if (!response.blob) {
        throw new Error(`Failed to load image from ${url}`);
      }
      const blob = response.blob as Blob;
      const mimeType =
        responseMimeType ||
        (blob.type && blob.type !== "" ? blob.type : this.getImageMimeType(url));
      const imageData = await this.blobToBase64DataURL(blob, mimeType);
      return {
        text: undefined,
        json: undefined,
        csv: undefined,
        image: imageData,
        pdf: undefined,
        size: blob.size,
        mimeType,
      };
    }

    if (detectedFormat === "pdf") {
      if (!response.blob) {
        throw new Error(`Failed to load PDF from ${url}`);
      }
      const blob = response.blob as Blob;
      const mimeType = responseMimeType || "application/pdf";
      const pdfData = await this.blobToBase64DataURL(blob, mimeType);
      return {
        text: undefined,
        json: undefined,
        csv: undefined,
        image: undefined,
        pdf: pdfData,
        size: blob.size,
        mimeType,
      };
    }

    // text, markdown, or html
    const content = response.text || "";
    if (!content) {
      throw new Error(`Failed to load content from ${url}`);
    }
    const mimeType =
      responseMimeType ||
      (detectedFormat === "markdown"
        ? "text/markdown"
        : detectedFormat === "html"
          ? "text/html"
          : "text/plain");
    return {
      text: content,
      json: undefined,
      csv: undefined,
      image: undefined,
      pdf: undefined,
      size: content.length,
      mimeType,
    };
  }

  /**
   * Detect the appropriate response type for fetching based on the detected format
   * @param detectedFormat - The detected format
   * @returns The appropriate response type
   */
  protected detectResponseType(detectedFormat: string): "text" | "json" | "blob" | "arraybuffer" {
    // Determine appropriate response type for fetching
    let responseType: "text" | "json" | "blob" | "arraybuffer" = "text";
    if (detectedFormat === "json") {
      responseType = "json";
    } else if (detectedFormat === "image" || detectedFormat === "pdf") {
      responseType = "blob";
    } else if (
      detectedFormat === "csv" ||
      detectedFormat === "text" ||
      detectedFormat === "markdown" ||
      detectedFormat === "html"
    ) {
      responseType = "text";
    }
    return responseType;
  }

  /**
   *
   * @param url - The URL to detect the format from
   * @param format - The format (assuming "auto" if not provided)
   * @returns
   */
  protected detectFormat(
    url: string,
    format: "text" | "markdown" | "json" | "csv" | "pdf" | "image" | "html" | "auto"
  ): "text" | "markdown" | "json" | "csv" | "pdf" | "image" | "html" {
    if (format === "auto") {
      const urlLower = url.toLowerCase();
      if (urlLower.endsWith(".md") || urlLower.endsWith(".markdown")) {
        return "markdown";
      } else if (urlLower.endsWith(".json")) {
        return "json";
      } else if (urlLower.endsWith(".csv")) {
        return "csv";
      } else if (urlLower.endsWith(".pdf")) {
        return "pdf";
      } else if (urlLower.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg|ico)$/)) {
        return "image";
      } else if (urlLower.endsWith(".html") || urlLower.endsWith(".htm")) {
        return "html";
      } else {
        return "text";
      }
    }
    return format;
  }

  /**
   * Get image MIME type based on URL extension
   */
  protected getImageMimeType(url: string): string {
    const urlLower = url.toLowerCase();
    if (urlLower.endsWith(".png")) return "image/png";
    if (urlLower.endsWith(".jpg") || urlLower.endsWith(".jpeg")) return "image/jpeg";
    if (urlLower.endsWith(".gif")) return "image/gif";
    if (urlLower.endsWith(".webp")) return "image/webp";
    if (urlLower.endsWith(".bmp")) return "image/bmp";
    if (urlLower.endsWith(".svg")) return "image/svg+xml";
    if (urlLower.endsWith(".ico")) return "image/x-icon";
    return "image/jpeg"; // default
  }

  /**
   * Convert Blob to base64 data URL
   */
  protected async blobToBase64DataURL(blob: Blob, mimeType: string): Promise<string> {
    // For Node.js/Bun environments
    if (typeof Buffer !== "undefined") {
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return `data:${mimeType};base64,${buffer.toString("base64")}`;
    }

    // For browser environments
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // If blob had no type, replace empty type with provided mimeType
        const result = reader.result as string;
        if (result.startsWith("data:;base64,")) {
          resolve(`data:${mimeType};base64,${result.substring(13)}`);
        } else {
          resolve(result);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

TaskRegistry.registerTask(FileLoaderTask);

export const fileLoader = (input: FileLoaderTaskInput, config?: JobQueueTaskConfig) => {
  return new FileLoaderTask({}, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    fileLoader: CreateWorkflow<FileLoaderTaskInput, FileLoaderTaskOutput, JobQueueTaskConfig>;
  }
}

Workflow.prototype.fileLoader = CreateWorkflow(FileLoaderTask);
