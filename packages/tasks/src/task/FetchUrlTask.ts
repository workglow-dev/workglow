/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AbortSignalJobError,
  IJobExecuteContext,
  Job,
  PermanentJobError,
  RetryableJobError,
} from "@workglow/job-queue";
import {
  CreateWorkflow,
  JobQueueTask,
  JobQueueTaskConfig,
  TaskConfigurationError,
  TaskInvalidInputError,
  TaskRegistry,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    url: {
      type: "string",
      title: "URL",
      description: "The URL to fetch from",
      format: "uri",
    },
    method: {
      enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      title: "Method",
      description: "The HTTP method to use",
      default: "GET",
    },
    headers: {
      type: "object",
      additionalProperties: {
        type: "string",
      },
      title: "Headers",
      description: "The headers to send with the request",
    },
    body: {
      type: "string",
      title: "Body",
      description: "The body of the request",
    },
    response_type: {
      anyOf: [{ type: "null" }, { enum: ["json", "text", "blob", "arraybuffer"] }],
      title: "Response Type",
      description:
        "The forced type of response to return. If null, the response type is inferred from the Content-Type header.",
      default: null,
    },
    timeout: {
      type: "number",
      title: "Timeout",
      description: "Request timeout in milliseconds",
    },
    queue: {
      oneOf: [{ type: "boolean" }, { type: "string" }],
      description: "Queue handling: false=run inline, true=use default, string=explicit queue name",
      default: true,
      "x-ui-hidden": true,
    },
  },
  required: ["url"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    json: {
      title: "JSON",
      description: "The JSON response",
    },
    text: {
      type: "string",
      title: "Text",
      description: "The text response",
    },
    blob: {
      title: "Blob",
      description: "The blob response",
    },
    arraybuffer: {
      title: "ArrayBuffer",
      description: "The arraybuffer response",
    },
    metadata: {
      type: "object",
      properties: {
        contentType: { type: "string" },
        headers: { type: "object", additionalProperties: { type: "string" } },
      },
      additionalProperties: false,
      title: "Response Metadata",
      description: "HTTP response metadata including content type and headers",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type FetchUrlTaskInput = FromSchema<typeof inputSchema>;
export type FetchUrlTaskOutput = FromSchema<typeof outputSchema>;

export type FetchUrlTaskConfig = JobQueueTaskConfig;

async function fetchWithProgress(
  url: string,
  options: RequestInit = {},
  onProgress?: (progress: number) => Promise<void>
): Promise<Response> {
  if (!options.signal) {
    throw new TaskConfigurationError("An AbortSignal must be provided.");
  }

  const response = await globalThis.fetch(url, options);
  if (!response.body) {
    throw new Error("ReadableStream not supported in this environment.");
  }

  const contentLength = response.headers.get("Content-Length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  let receivedBytes = 0;
  const reader = response.body.getReader();

  // Create a new ReadableStream that supports progress updates
  const stream = new ReadableStream({
    start(controller) {
      async function push() {
        try {
          while (true) {
            // Check if the request was aborted
            if (options.signal?.aborted) {
              controller.error(new AbortSignalJobError("Fetch aborted"));
              reader.cancel();
              return;
            }

            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              break;
            }
            controller.enqueue(value);
            receivedBytes += value.length;
            if (onProgress && totalBytes) {
              await onProgress((receivedBytes / totalBytes) * 100);
            }
          }
        } catch (error) {
          controller.error(error);
        }
      }
      push();
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * Extends the base Job class to provide custom execution functionality
 * through a provided function.
 */
export class FetchUrlJob<
  Input extends FetchUrlTaskInput = FetchUrlTaskInput,
  Output = FetchUrlTaskOutput,
> extends Job<Input, Output> {
  constructor(config: JobQueueTaskConfig & { input: Input } = { input: {} as Input }) {
    super(config);
  }
  static readonly type: string = "FetchUrlJob";
  /**
   * Executes the job using the provided function.
   */
  async execute(input: Input, context: IJobExecuteContext): Promise<Output> {
    const response = await fetchWithProgress(
      input.url!,
      {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: context.signal,
      },
      async (progress: number) => await context.updateProgress(progress)
    );

    if (response.ok) {
      // Extract metadata from response
      const contentType = response.headers.get("content-type") ?? "";
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const metadata = {
        contentType,
        headers,
      };

      // Infer response type from response headers if not specified
      let responseType = input.response_type;
      if (!responseType) {
        if (contentType.includes("application/json")) {
          responseType = "json";
        } else if (contentType.includes("text/")) {
          responseType = "text";
        } else if (contentType.includes("application/octet-stream")) {
          responseType = "arraybuffer";
        } else if (
          contentType.includes("application/pdf") ||
          contentType.includes("image/") ||
          contentType.includes("application/zip")
        ) {
          responseType = "blob";
        } else {
          responseType = "json"; // Default fallback
        }
        input.response_type = responseType;
      }
      if (responseType === "json") {
        return { json: await response.json(), metadata } as Output;
      } else if (responseType === "text") {
        return { text: await response.text(), metadata } as Output;
      } else if (responseType === "blob") {
        return { blob: await response.blob(), metadata } as Output;
      } else if (responseType === "arraybuffer") {
        return { arraybuffer: await response.arrayBuffer(), metadata } as Output;
      }
      throw new TaskInvalidInputError(`Invalid response type: ${responseType}`);
    } else {
      if (
        response.status === 429 ||
        response.status === 503 ||
        response.headers.get("Retry-After")
      ) {
        let retryDate: Date | undefined;
        const retryAfterStr = response.headers.get("Retry-After");
        if (retryAfterStr) {
          // Try parsing as HTTP date first
          const parsedDate = new Date(retryAfterStr);
          if (!isNaN(parsedDate.getTime()) && parsedDate > new Date()) {
            // Only use the date if it's in the future
            retryDate = parsedDate;
          } else {
            // If not a valid future date, treat as seconds
            const retryAfterSeconds = parseInt(retryAfterStr) * 1000;
            if (!isNaN(retryAfterSeconds)) {
              retryDate = new Date(Date.now() + retryAfterSeconds);
            }
          }
        }

        throw new RetryableJobError(
          `Failed to fetch ${input.url}: ${response.status} ${response.statusText}`,
          retryDate
        );
      } else {
        throw new PermanentJobError(
          `Failed to fetch ${input.url}: ${response.status} ${response.statusText}`
        );
      }
    }
  }
}

/**
 * FetchUrlTask provides a task for fetching data from a URL.
 */
export class FetchUrlTask<
  Input extends FetchUrlTaskInput = FetchUrlTaskInput,
  Output extends FetchUrlTaskOutput = FetchUrlTaskOutput,
  Config extends FetchUrlTaskConfig = FetchUrlTaskConfig,
> extends JobQueueTask<Input, Output, Config> {
  public static type = "FetchUrlTask";
  public static category = "Input";
  public static title = "Fetch";
  public static description =
    "Fetches data from a URL with progress tracking and automatic retry handling";
  public static hasDynamicSchemas: boolean = true;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  /**
   * Override outputSchema to compute it dynamically based on the current response_type value.
   * If response_type is null, all output types are available.
   * If response_type is a specific value (e.g., "json"), only that output type is available.
   */
  public override outputSchema(): DataPortSchema {
    // Get the current response_type value from runInputData (if set) or defaults
    // runInputData takes precedence as it contains the most recent input values
    const responseType = this.runInputData?.response_type ?? this.defaults?.response_type ?? null;

    // If response_type is null or undefined, return all output types (static schema)
    if (responseType === null || responseType === undefined) {
      return (this.constructor as typeof FetchUrlTask).outputSchema();
    }

    // If response_type is a specific value, return only that output type
    const staticSchema = (this.constructor as typeof FetchUrlTask).outputSchema();
    if (typeof staticSchema === "boolean") {
      return staticSchema;
    }

    if (!staticSchema.properties) {
      return staticSchema;
    }

    // Build properties object with only the selected response type
    const properties: Record<string, any> = {};
    if (responseType === "json" && staticSchema.properties.json) {
      properties.json = staticSchema.properties.json;
    } else if (responseType === "text" && staticSchema.properties.text) {
      properties.text = staticSchema.properties.text;
    } else if (responseType === "blob" && staticSchema.properties.blob) {
      properties.blob = staticSchema.properties.blob;
    } else if (responseType === "arraybuffer" && staticSchema.properties.arraybuffer) {
      properties.arraybuffer = staticSchema.properties.arraybuffer;
    }

    // Always include metadata
    if (staticSchema.properties.metadata) {
      properties.metadata = staticSchema.properties.metadata;
    }

    // If no properties were added (shouldn't happen with valid responseType), return static schema
    if (Object.keys(properties).length === 0) {
      return staticSchema;
    }

    return {
      type: "object",
      properties,
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  constructor(input: Partial<Input> = {} as Input, config: Config = {} as Config) {
    config.queue = input?.queue ?? config.queue;
    if (config.queue === undefined) {
      config.queue = false; // change default to false to run directly
    }
    super(input, config);
    this.jobClass = FetchUrlJob;
  }

  /**
   * Override setInput to detect when response_type changes and emit schemaChange event.
   * This ensures that consumers of the task are notified when the output schema changes.
   */
  public override setInput(input: Record<string, any>): void {
    // Only check for changes if response_type is being set
    if (!("response_type" in input)) {
      super.setInput(input);
      return;
    }

    // Get the current response_type before updating
    // Check runInputData first (most recent), then defaults, then null
    const getCurrentResponseType = () => {
      return this.runInputData?.response_type ?? this.defaults?.response_type ?? null;
    };

    const previousResponseType = getCurrentResponseType();

    // Call parent to update the input
    super.setInput(input);

    // Get the new response_type after updating (from runInputData, which is what setInput updates)
    const newResponseType = getCurrentResponseType();

    // If response_type changed, emit schemaChange event
    // Compare using strict equality (handles null/undefined correctly)
    if (previousResponseType !== newResponseType) {
      this.emitSchemaChange();
    }
  }

  protected override async getDefaultQueueName(input: Input): Promise<string | undefined> {
    if (!input.url) {
      return `fetch:${this.type}`;
    }
    try {
      const hostname = new URL(input.url).hostname.toLowerCase();
      const parts = hostname.split(".").filter(Boolean);
      if (parts.length === 0) {
        return `fetch:${this.type}`;
      }
      const domain = parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
      return `fetch:${domain}`;
    } catch {
      return `fetch:${this.type}`;
    }
  }
}

TaskRegistry.registerTask(FetchUrlTask);

export const fetchUrl = async (
  input: FetchUrlTaskInput,
  config: FetchUrlTaskConfig = {}
): Promise<FetchUrlTaskOutput> => {
  const result = await new FetchUrlTask({}, config).run(input);
  return result as FetchUrlTaskOutput;
};

declare module "@workglow/task-graph" {
  interface Workflow {
    fetch: CreateWorkflow<FetchUrlTaskInput, FetchUrlTaskOutput, FetchUrlTaskConfig>;
  }
}

Workflow.prototype.fetch = CreateWorkflow(FetchUrlTask);
